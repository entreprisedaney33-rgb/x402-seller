// lib/stats-daily.js — computes GET /stats/daily (protected, revenue-level
// detail) from the two append-only logs (<DATA_DIR>/sondages.jsonl,
// <DATA_DIR>/paiements.jsonl — see config.js). Unlike lib/stats.js (free,
// anonymized), this one surfaces amounts and payer addresses — hence the
// STATS_KEY gate in server.js. Payer addresses and tx hashes are already
// public on-chain (same reasoning as payment-log.js), so listing them here
// is not a new leak, but the *aggregated business view* (revenue, top
// endpoints, who's paying) is worth keeping behind a key rather than fully
// public.
import { readJsonl } from "./jsonl.js";
import { readSondagesRecents } from "./sondages-recents.js";
import { join } from "node:path";
import { cached } from "./cache.js";
import config from "../config.js";

const paiementsFile = join(config.dataDir, "paiements.jsonl");


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
function summarizePeriod(sondagesSlice, paiementsSlice) {
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

  const payersSet = new Set();
  for (const p of paiementsSlice) {
    if (!p.payer) continue;
    if (config.ourWallets.has(p.payer.toLowerCase())) continue;
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

// Portefeuilles exclus : config.ourWallets (meme source que lib/stats.js,
// pour que les deux ne divergent jamais sur ce qui compte comme "nous").

// 10/11/2026 — liste COMPLETE des payeurs depuis le debut, pour reperer nos
// propres portefeuilles a ajouter dans OUR_WALLETS. `nous` = deja exclu ;
// `profil_catalogue` = a paye >= 10 endpoints differents, signature d'un
// seed/test qui balaie tout le catalogue (ou d'un crawler d'annuaire qui
// paie), rarement d'un vrai client — indice seulement, a confirmer a la main.
function payeursDepuisLeDebut(paiements) {
  const parPayeur = new Map();
  for (const p of paiements) {
    if (!p.payer) continue;
    const k = p.payer.toLowerCase();
    const cur = parPayeur.get(k) || { payer: p.payer, paiements: 0, montant_usdc: 0, endpoints: new Map(), premier: p.date, dernier: p.date };
    cur.paiements += 1;
    cur.montant_usdc += parseMontant(p.montant);
    const ep = p.endpoint || "(inconnu)";
    cur.endpoints.set(ep, (cur.endpoints.get(ep) || 0) + 1);
    if (p.date < cur.premier) cur.premier = p.date;
    if (p.date > cur.dernier) cur.dernier = p.date;
    parPayeur.set(k, cur);
  }
  return [...parPayeur.values()]
    .sort((a, b) => b.montant_usdc - a.montant_usdc)
    .map((c) => ({
      payer: c.payer,
      nous: config.ourWallets.has(c.payer.toLowerCase()),
      profil_catalogue: c.endpoints.size >= 10,
      paiements: c.paiements,
      montant_usdc: round(c.montant_usdc),
      endpoints_distincts: c.endpoints.size,
      top_endpoints: [...c.endpoints.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e, n]) => `${e} x${n}`),
      premier_paiement: c.premier,
      dernier_paiement: c.dernier,
    }));
}

async function computeDailyStatsUncached() {
  const [sondages, paiements] = await Promise.all([readSondagesRecents(), readJsonl(paiementsFile)]);

  const today = utcDayBounds(0);
  const yesterday = utcDayBounds(1);
  const sevenDaysStart = today.end - 7 * 24 * 60 * 60 * 1000;

  return {
    generated_at: new Date().toISOString(),
    portefeuilles_exclus: [...config.ourWallets],
    periodes: {
      hier: { date_utc: yesterday.label, ...summarizePeriod(
        withinWindow(sondages, yesterday.start, yesterday.end),
        withinWindow(paiements, yesterday.start, yesterday.end),
      ) },
      aujourd_hui: { date_utc: today.label, ...summarizePeriod(
        withinWindow(sondages, today.start, today.end),
        withinWindow(paiements, today.start, today.end),
      ) },
      "7_jours": { depuis_utc: new Date(sevenDaysStart).toISOString(), ...summarizePeriod(
        withinWindow(sondages, sevenDaysStart, today.end),
        withinWindow(paiements, sevenDaysStart, today.end),
      ) },
    },
    payeurs_depuis_le_debut: payeursDepuisLeDebut(paiements),
  };
}

// Cached 60s: same rationale as lib/stats.js — avoids re-parsing the whole
// log on every call (this route will mostly be hit once/day by a cron, but
// costs nothing to protect against accidental hammering).
export function computeDailyStats() {
  return cached("stats-daily", 60_000, computeDailyStatsUncached);
}
