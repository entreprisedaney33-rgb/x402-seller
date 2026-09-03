// lib/stats-probes.js — computes GET /stats/probes (protected, same
// STATS_KEY as /stats/daily): the FULL long-tail breakdown of who's
// probing this server — by User-Agent AND by truncated IP (sondage-log.js
// already zeroes the last IPv4 octet / trims IPv6 at write time, so no
// exact client address is ever stored or read here) — for a rolling 24h
// and 7d window (same convention as lib/stats.js's totals, not the
// UTC-calendar-day buckets lib/stats-daily.js uses for "hier"/"aujourd'hui").
//
// Unlike lib/stats-daily.js's top_user_agents (capped at 10, for a quick
// dashboard glance), this NEVER truncates — the whole point is to see the
// low-volume long tail that a top-10 view hides, since a genuine
// interested agent (not a catalog scanner) is exactly the kind of entry
// that would otherwise never make a top-10 cut.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cached } from "./cache.js";
import config from "../config.js";

const sondagesFile = join(config.dataDir, "sondages.jsonl");

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

// >=10 endpoints distincts touches dans la fenetre = signature d'un scan
// systematique du catalogue (voir la mission du 03/09 : sur echantillon
// reel, TOUT le top 10 par volume tapait 18 a 34 des 34 endpoints, jamais
// 1-2) ; en dessous, cible potentielle a examiner au cas par cas.
const SEUIL_SCANNER = 10;

function withinWindow(entries, sinceMs) {
  const cutoff = Date.now() - sinceMs;
  return entries.filter((e) => {
    const t = Date.parse(e.date);
    return Number.isFinite(t) && t >= cutoff;
  });
}

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
    .map((u) => ({
      user_agent: u.user_agent,
      sondages: u.sondages,
      endpoints_distincts: u.endpoints.size,
      profil: u.endpoints.size >= SEUIL_SCANNER ? "scanner" : "cible",
    }));
}

function summarizeIps(sondagesSlice) {
  const parIp = new Map();
  for (const s of sondagesSlice) {
    const ip = s.ip || "(inconnu)";
    const cur = parIp.get(ip) || { ip, sondages: 0, endpoints: new Set() };
    cur.sondages += 1;
    if (s.endpoint) cur.endpoints.add(s.endpoint);
    parIp.set(ip, cur);
  }
  return [...parIp.values()]
    .sort((a, b) => b.sondages - a.sondages)
    .map((u) => ({ ip: u.ip, sondages: u.sondages, endpoints_distincts: u.endpoints.size }));
}

function summarizePeriod(sondagesSlice) {
  const user_agents = summarizeUserAgents(sondagesSlice);
  const ips = summarizeIps(sondagesSlice);
  return {
    total_sondages: sondagesSlice.length,
    nb_user_agents_distincts: user_agents.length,
    nb_ips_distincts: ips.length,
    user_agents,
    ips,
  };
}

async function computeProbesStatsUncached() {
  const sondages = await readJsonl(sondagesFile);
  return {
    generated_at: new Date().toISOString(),
    seuil_scanner_endpoints_distincts: SEUIL_SCANNER,
    periodes: {
      "24h": summarizePeriod(withinWindow(sondages, HOUR_24)),
      "7j": summarizePeriod(withinWindow(sondages, DAY_7)),
    },
  };
}

// Cached 60s: same rationale as lib/stats.js / lib/stats-daily.js.
export function computeProbesStats() {
  return cached("stats-probes", 60_000, computeProbesStatsUncached);
}
