// lib/stats-echecs.js — computes GET /stats/echecs (protected, same
// STATS_KEY as /stats/daily): the last 100 lines of logs/echecs.jsonl
// (see echecs-log.js — settlement_failed from server.js's onAfterSettle,
// upstream_error from lib/http.js's safeHandler), plus 24h/7d counters
// by type. Rolling windows, same convention as lib/stats.js/stats-probes.js.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cached } from "./cache.js";
import config from "../config.js";

const echecsFile = join(config.dataDir, "echecs.jsonl");

async function readJsonl(fileUrl) {
  let text;
  try {
    text = await readFile(fileUrl, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const entries = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // a malformed line (e.g. truncated by a crash mid-write) is skipped
    }
  }
  return entries;
}

const HOUR_24 = 24 * 60 * 60 * 1000;
const DAY_7 = 7 * HOUR_24;

function countByTypeSince(entries, sinceMs) {
  const cutoff = Date.now() - sinceMs;
  const counts = {};
  for (const e of entries) {
    const t = Date.parse(e.date);
    if (!Number.isFinite(t) || t < cutoff) continue;
    const type = e.type || "(inconnu)";
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

async function computeEchecsStatsUncached() {
  const echecs = await readJsonl(echecsFile);
  return {
    generated_at: new Date().toISOString(),
    compteurs: {
      last_24h: countByTypeSince(echecs, HOUR_24),
      last_7d: countByTypeSince(echecs, DAY_7),
    },
    // Les 100 plus recentes en tete (le journal lui-meme est ecrit du plus
    // ancien au plus recent, append-only).
    dernieres_lignes: echecs.slice(-100).reverse(),
  };
}

// Cached 60s: same rationale as the other /stats* routes.
export function computeEchecsStats() {
  return cached("stats-echecs", 60_000, computeEchecsStatsUncached);
}
