// lib/stats-daily.js — computes GET /stats/daily (protected, revenue-level
// detail) from the two append-only logs (<DATA_DIR>/sondages.jsonl,
// <DATA_DIR>/paiements.jsonl — see config.js). Unlike lib/stats.js (free,
// anonymized), this one surfaces amounts and payer addresses — hence the
// STATS_KEY gate in server.js. Payer addresses and tx hashes are already
// public on-chain (same reasoning as payment-log.js), so listing them here
// is not a new leak, but the *aggregated business view* (revenue, top
// endpoints, who's paying) is worth keeping behind a key rather than fully
// public.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cached } from "./cache.js";
import config from "../config.js";

const sondagesFile = join(config.dataDir, "sondages.jsonl");
const paiementsFile = join(config.dataDir, "paiements.jsonl");

async function readJsonl(fileUrl) {
  let text;
  try {
    text = await readFile(fileUrl, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return []; // no event logged yet
    throw err;
  }
  const entries = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // a malformed line (e.g. truncated by a crash mid-write) is skipped,
      // never fatal to the whole stats computation
    }
  }
  return entries;
}

// "$0.005" -> 0.005 ; anything unparseable -> 0 (never NaN in a sum).
function parseMontant(montant) {
  const n = parseFloat(String(montant ?? "").replace(/^\$/, ""));
  return Number.isFinite(n) ? n : 0;
}

function utcDayBounds(daysAgo) {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo);
  const end = start + 24 * 60 * 60 * 1000;
  return { start, end, label: new Date(start).toISOString().slice(0, 10) };
}

function withinWindow(entries, startMs, endMs) {
  return entries.filter((e) => {
    const t = Date.parse(e.date);
    return Number.isFinite(t) && t >= startMs && t < endMs;
  });
}

// Groups a slice of sondages (402 probes) by User-Agent — the "who's
// actually knocking" view. A UA that hits many DIFFERENT endpoints in a
// short window is the signature of a catalog crawler (an x402 directory
// re-validating its listing, a "seller trust" tool auditing the whole
// origin) rather than a human/agent evaluating one specific endpoint.
function summarizeUserAgents(sondagesSlice) {
  const parUa = new Map();
  for (const s of sondagesSlice) {
    const ua = s.user_agent || "(inconnu)";
    const cur = parUa.get(ua) || { user_agent: ua, sondages: 0, endpoints: new Set() };
    cur.sondages += 1;
    if (s.endpoint) cur.endpoints.add(s.endpoint);
    parUa.set(ua, cur);
  }
  return [...parUa.values()]
    .sort((a, b) => b.sondages - a.sondages)
    .slice(0, 10)
    .map((u) => ({ user_agent: u.user_agent, sondages: u.sondages, endpoints_distincts: u.endpoints.size }));
}

// Aggregates one period (a slice of sondages + a slice of paiements) into
// the compact shape described in the mission: counts, revenue, top-5
// endpoints, distinct payers excluding the test wallet, and a top-10
// User-Agent breakdown of who's actually probing (see summarizeUserAgents).
function summarizePeriod(sondagesSlice, paiementsSlice, testWallet) {
  const montantTotal = paiementsSlice.reduce((sum, p) => sum + parseMontant(p.montant), 0);

  const parEndpoint = new Map();
  for (const p of paiementsSlice) {
    const ep = p.endpoint || "(inconnu)";
    const cur = parEndpoint.get(ep) || { endpoint: ep, paiements: 0, montant_usdc: 0 };
    cur.paiements += 1;
    cur.montant_usdc += parseMontant(p.montant);
    parEndpoint.set(ep, cur);
  }
  const top_endpoints = [...parEndpoint.values()]
    .sort((a, b) => b.paiements - a.paiements)
    .slice(0, 5)
    .map((e) => ({ ...e, montant_usdc: round(e.montant_usdc) }));

  const testWalletLower = (testWallet || "").toLowerCase();
  const payersSet = new Set();
  for (const p of paiementsSlice) {
    if (!p.payer) continue;
    if (p.payer.toLowerCase() === testWalletLower) continue;
    payersSet.add(p.payer);
  }

  return {
    sondages_402: sondagesSlice.length,
    paiements: paiementsSlice.length,
    montant_usdc: round(montantTotal),
    top_endpoints,
    payers_inconnus: { count: payersSet.size, liste: [...payersSet] },
    top_user_agents: summarizeUserAgents(sondagesSlice),
  };
}

function round(n) {
  return Math.round(n * 1e6) / 1e6; // 6 decimals: enough for USDC-priced ($0.005) sums
}

// Shared with lib/stats.js via config.js (config.testWalletAddress) — a
// single source of truth, so the two never silently disagree on which
// address counts as "test". See config.js for the full rationale.
const TEST_WALLET = config.testWalletAddress;

async function computeDailyStatsUncached() {
  const [sondages, paiements] = await Promise.all([readJsonl(sondagesFile), readJsonl(paiementsFile)]);

  const today = utcDayBounds(0);
  const yesterday = utcDayBounds(1);
  const sevenDaysStart = today.end - 7 * 24 * 60 * 60 * 1000;

  return {
    generated_at: new Date().toISOString(),
    test_wallet_exclu: TEST_WALLET,
    periodes: {
      hier: { date_utc: yesterday.label, ...summarizePeriod(
        withinWindow(sondages, yesterday.start, yesterday.end),
        withinWindow(paiements, yesterday.start, yesterday.end),
        TEST_WALLET
      ) },
      aujourd_hui: { date_utc: today.label, ...summarizePeriod(
        withinWindow(sondages, today.start, today.end),
        withinWindow(paiements, today.start, today.end),
        TEST_WALLET
      ) },
      "7_jours": { depuis_utc: new Date(sevenDaysStart).toISOString(), ...summarizePeriod(
        withinWindow(sondages, sevenDaysStart, today.end),
        withinWindow(paiements, sevenDaysStart, today.end),
        TEST_WALLET
      ) },
    },
  };
}

// Cached 60s: same rationale as lib/stats.js — avoids re-parsing the whole
// log on every call (this route will mostly be hit once/day by a cron, but
// costs nothing to protect against accidental hammering).
export function computeDailyStats() {
  return cached("stats-daily", 60_000, computeDailyStatsUncached);
}
