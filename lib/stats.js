// lib/stats.js — computes GET /stats from the two append-only logs
// (<DATA_DIR>/sondages.jsonl, <DATA_DIR>/paiements.jsonl — see config.js).
// Read-only. Reports counts AND revenue (montant_usdc, global + per
// endpoint, 24h/7d/all-time) — no sensitive fields surfaced (no payer
// address, no ip, no tx hash: payer identity is used ONLY to classify a
// payment as "tiers" (real third-party) vs "total" (every payer, including
// our own test wallet and the weekly seed cron), never itself exposed).
//
// Every payments/montant_usdc figure below comes in two flavors:
//   - tiers: excludes config.testWalletAddress — the number a human should
//     actually trust as "did a real customer pay for this".
//   - total: every settled payment, test wallet included — kept alongside
//     tiers (never instead of it) so nothing is hidden, just correctly
//     labeled.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cached } from "./cache.js";
import config from "../config.js";

const sondagesFile = join(config.dataDir, "sondages.jsonl");
const paiementsFile = join(config.dataDir, "paiements.jsonl");

const TEST_WALLET_LOWER = (config.testWalletAddress || "").toLowerCase();

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

function isTestWallet(payer) {
  return typeof payer === "string" && payer.toLowerCase() === TEST_WALLET_LOWER;
}

// tiersOnly(paiements) -> only the entries NOT from the test wallet. A
// payment with no payer recorded at all (shouldn't happen, but the field
// is optional in payment-log.js's shape) is treated as non-test — safer to
// over-count as "real" than to silently hide a payment with a data gap.
function tiersOnly(paiements) {
  return paiements.filter((p) => !isTestWallet(p.payer));
}

function countByEndpointSince(entries, sinceMs) {
  const counts = {};
  const cutoff = Date.now() - sinceMs;
  for (const e of entries) {
    const t = Date.parse(e.date);
    if (!Number.isFinite(t) || t < cutoff) continue;
    const ep = e.endpoint || "(unknown)";
    counts[ep] = (counts[ep] || 0) + 1;
  }
  return counts;
}

// "$0.005" -> 0.005 ; anything unparseable -> 0 (never NaN in a sum).
function parseMontant(montant) {
  const n = parseFloat(String(montant ?? "").replace(/^\$/, ""));
  return Number.isFinite(n) ? n : 0;
}

// sinceMs === null -> no cutoff (all-time, since the log began). Payer
// addresses are never read/exposed here, only the "montant" field (a price
// string like "$0.005", never a signed payload or identity).
function sumMontantByEndpointSince(entries, sinceMs) {
  const sums = {};
  const cutoff = sinceMs == null ? -Infinity : Date.now() - sinceMs;
  for (const e of entries) {
    const t = Date.parse(e.date);
    if (!Number.isFinite(t) || t < cutoff) continue;
    const ep = e.endpoint || "(unknown)";
    sums[ep] = (sums[ep] || 0) + parseMontant(e.montant);
  }
  return sums;
}

// distinctPayersSince(paiements, sinceMs) -> count of distinct non-test
// payer addresses within the window. Only a COUNT is ever returned — no
// address, list, or anything else that could identify who paid (that
// level of detail lives behind GET /stats/daily, protected by STATS_KEY).
function distinctPayersSince(paiements, sinceMs) {
  const cutoff = Date.now() - sinceMs;
  const seen = new Set();
  for (const p of paiements) {
    if (isTestWallet(p.payer) || !p.payer) continue;
    const t = Date.parse(p.date);
    if (!Number.isFinite(t) || t < cutoff) continue;
    seen.add(p.payer.toLowerCase());
  }
  return seen.size;
}

function round(n) {
  return Math.round(n * 1e6) / 1e6; // 6 decimals: enough for USDC-priced ($0.005) sums
}

function sumValues(obj) {
  return Object.values(obj).reduce((a, b) => a + b, 0);
}

const HOUR_24 = 24 * 60 * 60 * 1000;
const DAY_7 = 7 * HOUR_24;

// Builds the {last_24h, last_7d[, all_time]} shape for either payments
// counts or montant_usdc sums, from a given slice of paiements (already
// filtered to tiers-only or left as the full total by the caller).
function buildPaymentStats(paiements, { withAllTime }) {
  const countsByEp = { last_24h: countByEndpointSince(paiements, HOUR_24), last_7d: countByEndpointSince(paiements, DAY_7) };
  const sumsByEp = {
    last_24h: sumMontantByEndpointSince(paiements, HOUR_24),
    last_7d: sumMontantByEndpointSince(paiements, DAY_7),
    ...(withAllTime ? { all_time: sumMontantByEndpointSince(paiements, null) } : {}),
  };
  return { countsByEp, sumsByEp };
}

async function computeStatsUncached() {
  const [sondages, paiements] = await Promise.all([readJsonl(sondagesFile), readJsonl(paiementsFile)]);
  const paiementsTiers = tiersOnly(paiements);

  const http402 = { last_24h: countByEndpointSince(sondages, HOUR_24), last_7d: countByEndpointSince(sondages, DAY_7) };

  const tiersStats = buildPaymentStats(paiementsTiers, { withAllTime: true });
  const totalStats = buildPaymentStats(paiements, { withAllTime: true });

  const endpoints = new Set([
    ...Object.keys(http402.last_7d),
    ...Object.keys(totalStats.countsByEp.last_7d),
    ...Object.keys(totalStats.sumsByEp.all_time),
  ]);

  const byEndpoint = {};
  for (const ep of endpoints) {
    byEndpoint[ep] = {
      http_402: { last_24h: http402.last_24h[ep] || 0, last_7d: http402.last_7d[ep] || 0 },
      payments: {
        tiers: { last_24h: tiersStats.countsByEp.last_24h[ep] || 0, last_7d: tiersStats.countsByEp.last_7d[ep] || 0 },
        total: { last_24h: totalStats.countsByEp.last_24h[ep] || 0, last_7d: totalStats.countsByEp.last_7d[ep] || 0 },
      },
      montant_usdc: {
        tiers: {
          last_24h: round(tiersStats.sumsByEp.last_24h[ep] || 0),
          last_7d: round(tiersStats.sumsByEp.last_7d[ep] || 0),
          all_time: round(tiersStats.sumsByEp.all_time[ep] || 0),
        },
        total: {
          last_24h: round(totalStats.sumsByEp.last_24h[ep] || 0),
          last_7d: round(totalStats.sumsByEp.last_7d[ep] || 0),
          all_time: round(totalStats.sumsByEp.all_time[ep] || 0),
        },
      },
    };
  }

  return {
    generated_at: new Date().toISOString(),
    totals: {
      http_402: { last_24h: sumValues(http402.last_24h), last_7d: sumValues(http402.last_7d) },
      payments: {
        tiers: { last_24h: sumValues(tiersStats.countsByEp.last_24h), last_7d: sumValues(tiersStats.countsByEp.last_7d) },
        total: { last_24h: sumValues(totalStats.countsByEp.last_24h), last_7d: sumValues(totalStats.countsByEp.last_7d) },
      },
      montant_usdc: {
        tiers: {
          last_24h: round(sumValues(tiersStats.sumsByEp.last_24h)),
          last_7d: round(sumValues(tiersStats.sumsByEp.last_7d)),
          all_time: round(sumValues(tiersStats.sumsByEp.all_time)),
        },
        total: {
          last_24h: round(sumValues(totalStats.sumsByEp.last_24h)),
          last_7d: round(sumValues(totalStats.sumsByEp.last_7d)),
          all_time: round(sumValues(totalStats.sumsByEp.all_time)),
        },
      },
      payeurs_distincts_tiers: {
        last_24h: distinctPayersSince(paiements, HOUR_24),
        last_7d: distinctPayersSince(paiements, DAY_7),
      },
    },
    endpoints: byEndpoint,
  };
}

// Cached 60s: /stats is free and could otherwise be hammered into re-parsing
// the whole log on every call.
export function computeStats() {
  return cached("stats", 60_000, computeStatsUncached);
}
