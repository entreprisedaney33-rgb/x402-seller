// lib/stats.js — computes GET /stats from the two append-only logs
// (<DATA_DIR>/sondages.jsonl, <DATA_DIR>/paiements.jsonl — see config.js).
// Read-only. Reports counts AND revenue (montant_usdc, global + per
// endpoint, 24h/7d/all-time) — no sensitive fields surfaced (no payer
// address, no ip, no tx hash: only the "montant" price string is summed).
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

function round(n) {
  return Math.round(n * 1e6) / 1e6; // 6 decimals: enough for USDC-priced ($0.005) sums
}

const HOUR_24 = 24 * 60 * 60 * 1000;
const DAY_7 = 7 * HOUR_24;

async function computeStatsUncached() {
  const [sondages, paiements] = await Promise.all([readJsonl(sondagesFile), readJsonl(paiementsFile)]);

  const http402 = { last_24h: countByEndpointSince(sondages, HOUR_24), last_7d: countByEndpointSince(sondages, DAY_7) };
  const payments = { last_24h: countByEndpointSince(paiements, HOUR_24), last_7d: countByEndpointSince(paiements, DAY_7) };
  const montantUsdc = {
    last_24h: sumMontantByEndpointSince(paiements, HOUR_24),
    last_7d: sumMontantByEndpointSince(paiements, DAY_7),
    all_time: sumMontantByEndpointSince(paiements, null),
  };

  const endpoints = new Set([
    ...Object.keys(http402.last_7d),
    ...Object.keys(payments.last_7d),
    ...Object.keys(montantUsdc.all_time),
  ]);

  const byEndpoint = {};
  for (const ep of endpoints) {
    byEndpoint[ep] = {
      http_402: { last_24h: http402.last_24h[ep] || 0, last_7d: http402.last_7d[ep] || 0 },
      payments: { last_24h: payments.last_24h[ep] || 0, last_7d: payments.last_7d[ep] || 0 },
      montant_usdc: {
        last_24h: round(montantUsdc.last_24h[ep] || 0),
        last_7d: round(montantUsdc.last_7d[ep] || 0),
        all_time: round(montantUsdc.all_time[ep] || 0),
      },
    };
  }

  return {
    generated_at: new Date().toISOString(),
    totals: {
      http_402: { last_24h: sumValues(http402.last_24h), last_7d: sumValues(http402.last_7d) },
      payments: { last_24h: sumValues(payments.last_24h), last_7d: sumValues(payments.last_7d) },
      montant_usdc: {
        last_24h: round(sumValues(montantUsdc.last_24h)),
        last_7d: round(sumValues(montantUsdc.last_7d)),
        all_time: round(sumValues(montantUsdc.all_time)),
      },
    },
    endpoints: byEndpoint,
  };
}

function sumValues(obj) {
  return Object.values(obj).reduce((a, b) => a + b, 0);
}

// Cached 60s: /stats is free and could otherwise be hammered into re-parsing
// the whole log on every call.
export function computeStats() {
  return cached("stats", 60_000, computeStatsUncached);
}
