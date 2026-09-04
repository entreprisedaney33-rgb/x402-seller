// lib/stats-apify.js — computes GET /stats/apify: estimated USD revenue
// from Mathéo's own Apify Actors monetized via pay-per-event (currently
// eu-vat-siren-check), separate from and unrelated to this server's own
// x402 revenue (GET /stats, /stats/daily). Protected by the same
// STATS_KEY gate as /stats/daily — revenue, never public.
//
// ============================================================================
// WHY THIS IS AN ESTIMATE, NOT AN AUDITED FIGURE (read before trusting a
// number from this file) — verified against the official Apify API docs
// (docs.apify.com/api/v2, consulted 2026-09-04), see README/session report
// for the full citation trail:
//
// 1. There is NO Apify API endpoint that returns a dollar revenue figure
//    for Actor monetization. The Console's "Actors > Insights >
//    Monetization" dashboard has no documented API equivalent — confirmed
//    by the fact that every third-party "Apify revenue tracker" community
//    tool found during research resorts to the SAME estimate this file
//    uses (successful runs x current pay-per-event price), not a real
//    figure, because none exists to read.
// 2. GET /v2/actor-runs (account-wide run list) only returns runs where
//    THIS account is the caller — a customer running a published,
//    monetized Actor does so under THEIR OWN account, invisible to this
//    endpoint. It is therefore useless for tracking third-party usage of
//    a published Actor and is not used here.
// 3. GET /v2/users/me/usage/monthly is platform USAGE/COST (compute units,
//    proxy, storage — what the account SPENDS running Actors), not
//    monetization REVENUE (what it EARNS from others running its
//    published Actors). A different thing entirely; not used here either.
// 4. The only actor-owner-visible, cross-customer aggregate is the Actor
//    object's own `stats` (GET /v2/actors/{id}), specifically
//    `stats.publicActorRunStats30Days` (a 30-day rolling window — SUCCEEDED
//    count used here, not TOTAL, since failed/aborted runs don't charge
//    events) and `stats.totalRuns` (all-time, all statuses combined — no
//    all-time SUCCEEDED-only figure is exposed, so the all-time estimate
//    is very slightly optimistic by including some failed runs). NEITHER
//    has any granularity below 30 days: there is no daily or 7-day run
//    count anywhere in the public API. "Today" / "last 7 days" / "month
//    to date" below are therefore NOT measured — they are the 30-day
//    figure divided evenly across those 30 days (a linear daily average),
//    never a real per-day count.
// 5. A "successful run" is not the same thing as a "charged event": this
//    Actor's own billing model (see ../../apify-actors/eu-vat-siren-check)
//    charges ONE `company-record` event PER INPUT IDENTIFIER, and a single
//    run can process many identifiers at once — so runs x price
//    UNDERCOUNTS revenue for any run that charged more than one event.
//    Apify's public API exposes true per-run `chargedEventCounts` only on
//    runs THIS account itself made (see point 2) — unreachable for
//    customer runs, so this undercount cannot be corrected via the API.
//
// In short: treat every number in this response as "the best estimate
// achievable from Apify's public API today", not as a bank statement.
// ============================================================================

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import config from "../config.js";

const APIFY_API_BASE = "https://api.apify.com/v2";
const CACHE_FILE = join(config.dataDir, "apify-revenue-cache.json");
const CACHE_TTL_MS = 15 * 60 * 1000; // "au moins 15 minutes" — see mission.
const FETCH_TIMEOUT_MS = 10_000;

const ESTIMATION_NOTE =
  "Estimated, not audited: Apify's public API exposes no dollar revenue " +
  "figure, no per-customer-run charged-event breakdown, and no daily/" +
  "weekly run counts (only a 30-day rolling window and an all-time total). " +
  "today/last_7d/month_to_date are a 30-day figure divided evenly across " +
  "days, not measured counts. Computed as (succeeded runs) x (current " +
  "pay-per-event price) — undercounts any run that charged more than one " +
  "event (this Actor charges one event PER INPUT IDENTIFIER, and a run " +
  "can carry several). See this file's header comment for the full " +
  "sourcing and reasoning.";

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

async function ensureDataDir() {
  await mkdir(config.dataDir, { recursive: true });
}

async function readCacheFile() {
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null; // absent, unreadable, or corrupt -> treated as "no cache yet"
  }
}

async function writeCacheFile(entry) {
  try {
    await ensureDataDir();
    await writeFile(CACHE_FILE, JSON.stringify(entry, null, 2), "utf8");
  } catch (err) {
    // A cache write failure must never break the response we already have
    // — same principle as payment-log.js's own write failures.
    console.error(`Impossible d'ecrire ${CACHE_FILE} :`, err.message);
  }
}

async function apifyGet(path) {
  const res = await fetch(`${APIFY_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${config.apifyToken}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Apify API a repondu HTTP ${res.status} sur ${path}.`);
  }
  const body = await res.json();
  return body.data;
}

// Picks the single representative price-per-charged-event for an Actor's
// CURRENT pay-per-event pricing (the most recently started PAY_PER_EVENT
// entry in pricingInfos — that array keeps historical entries too). If the
// Actor charges more than one distinct event name, this takes the largest
// non-zero one (the "main" billable event, e.g. company-record) rather
// than summing them — summing would assume every run charges every event
// type once, which is not how PPE works.
function currentEventPriceUsd(pricingInfos) {
  if (!Array.isArray(pricingInfos) || pricingInfos.length === 0) return null;
  const ppeEntries = pricingInfos
    .filter((p) => p.pricingModel === "PAY_PER_EVENT" && p.pricingPerEvent?.actorChargeEvents)
    .sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
  if (ppeEntries.length === 0) return null;
  const events = Object.values(ppeEntries[0].pricingPerEvent.actorChargeEvents);
  const prices = events.map((e) => Number(e.eventPriceUsd) || 0).filter((p) => p > 0);
  if (prices.length === 0) return null;
  return {
    priceUsd: Math.max(...prices),
    apifyMarginPercentage: typeof ppeEntries[0].apifyMarginPercentage === "number" ? ppeEntries[0].apifyMarginPercentage : null,
  };
}

async function fetchLiveApifyRevenue() {
  const { items: actors } = await apifyGet("/actors?my=1&limit=1000");

  let succeededRuns30d = 0;
  let allTimeRuns = 0;
  let grossRevenue30dUsd = 0;
  let grossRevenueAllTimeUsd = 0;
  let netRevenue30dUsd = 0;
  let netRevenueAllTimeUsd = 0;
  let monetizedActorsCount = 0;
  const byActor = [];

  for (const actorSummary of actors) {
    // pricingInfos is only present on the single-actor GET, not the list —
    // one extra call per actor, acceptable at this account's actor count
    // and bounded further by the 15-minute cache above this function.
    let actorDetail;
    try {
      actorDetail = await apifyGet(`/actors/${actorSummary.id}`);
    } catch (err) {
      console.error(`Apify: impossible de lire l'actor ${actorSummary.id} (${actorSummary.name}) :`, err.message);
      continue;
    }

    const pricing = currentEventPriceUsd(actorDetail.pricingInfos);
    const stats = actorDetail.stats || {};
    const succeeded30d = stats.publicActorRunStats30Days?.SUCCEEDED || 0;
    const totalRuns = stats.totalRuns || 0;

    succeededRuns30d += succeeded30d;
    allTimeRuns += totalRuns;

    if (!pricing) continue; // not monetized via PPE (or no active PAY_PER_EVENT entry) -> no revenue to estimate
    monetizedActorsCount += 1;

    const gross30d = succeeded30d * pricing.priceUsd;
    const grossAllTime = totalRuns * pricing.priceUsd;
    const marginFactor = pricing.apifyMarginPercentage != null ? 1 - pricing.apifyMarginPercentage : null;
    const net30d = marginFactor != null ? gross30d * marginFactor : null;
    const netAllTime = marginFactor != null ? grossAllTime * marginFactor : null;

    grossRevenue30dUsd += gross30d;
    grossRevenueAllTimeUsd += grossAllTime;
    if (net30d != null) netRevenue30dUsd += net30d;
    if (netAllTime != null) netRevenueAllTimeUsd += netAllTime;

    byActor.push({
      id: actorSummary.id,
      name: actorSummary.name,
      price_per_event_usd: pricing.priceUsd,
      apify_margin_percentage: pricing.apifyMarginPercentage,
      succeeded_runs_30d: succeeded30d,
      runs_all_time: totalRuns,
      estimated_gross_revenue_30d_usd: round(gross30d),
      estimated_gross_revenue_all_time_usd: round(grossAllTime),
    });
  }

  // No daily/weekly granularity exists upstream (see file header point 4)
  // — apportioned linearly from the 30-day figure. now/monthStart use
  // UTC calendar days, consistent with the rest of this server (see
  // lib/stats-daily.js's utcDayBounds).
  const now = new Date();
  const daysElapsedThisMonthUtc = now.getUTCDate(); // 1..31, today counted
  const dailyAvgGross = grossRevenue30dUsd / 30;
  const dailyAvgNet = netRevenue30dUsd / 30;

  return {
    generated_at: now.toISOString(),
    freshness: "live",
    apify_last_fetched_at: now.toISOString(),
    monetized_actors_count: monetizedActorsCount,
    revenue_estimated_gross_usd: {
      today: round(dailyAvgGross),
      last_7d: round(dailyAvgGross * 7),
      month_to_date: round(dailyAvgGross * daysElapsedThisMonthUtc),
      all_time: round(grossRevenueAllTimeUsd),
    },
    revenue_estimated_net_usd: {
      today: round(dailyAvgNet),
      last_7d: round(dailyAvgNet * 7),
      month_to_date: round(dailyAvgNet * daysElapsedThisMonthUtc),
      all_time: round(netRevenueAllTimeUsd),
    },
    succeeded_runs_30d: succeededRuns30d,
    runs_all_time: allTimeRuns,
    by_actor: byActor,
    estimation_note: ESTIMATION_NOTE,
  };
}

export async function computeApifyStats() {
  const cached = await readCacheFile();
  const cacheAgeMs = cached ? Date.now() - new Date(cached.apify_last_fetched_at).getTime() : Infinity;

  if (cached && cacheAgeMs < CACHE_TTL_MS) {
    return { ...cached, freshness: "cached", generated_at: new Date().toISOString() };
  }

  if (!config.apifyToken) {
    if (cached) {
      return { ...cached, freshness: "stale_no_token", generated_at: new Date().toISOString() };
    }
    return {
      generated_at: new Date().toISOString(),
      freshness: "not_configured",
      apify_last_fetched_at: null,
      monetized_actors_count: 0,
      revenue_estimated_gross_usd: { today: null, last_7d: null, month_to_date: null, all_time: null },
      revenue_estimated_net_usd: { today: null, last_7d: null, month_to_date: null, all_time: null },
      succeeded_runs_30d: null,
      runs_all_time: null,
      by_actor: [],
      estimation_note: "APIFY_TOKEN is not configured on this server — no data has ever been fetched.",
    };
  }

  try {
    const fresh = await fetchLiveApifyRevenue();
    await writeCacheFile(fresh);
    return fresh;
  } catch (err) {
    console.error("Apify API injoignable pour /stats/apify :", err.message);
    if (cached) {
      // Last known value, honestly labeled as stale rather than a 500 —
      // the whole point of caching to DATA_DIR (mission requirement).
      return {
        ...cached,
        freshness: "stale",
        generated_at: new Date().toISOString(),
        stale_reason: err.message,
      };
    }
    // No cache has ever been written yet AND the live call failed: still
    // never a 500 — an honest "unavailable" shape with the same keys.
    return {
      generated_at: new Date().toISOString(),
      freshness: "unavailable",
      apify_last_fetched_at: null,
      monetized_actors_count: 0,
      revenue_estimated_gross_usd: { today: null, last_7d: null, month_to_date: null, all_time: null },
      revenue_estimated_net_usd: { today: null, last_7d: null, month_to_date: null, all_time: null },
      succeeded_runs_30d: null,
      runs_all_time: null,
      by_actor: [],
      estimation_note: ESTIMATION_NOTE,
      stale_reason: err.message,
    };
  }
}
