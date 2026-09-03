// lib/tavily.js — shared Tavily API client for POST /api/search/web
// (Tavily Search).
//
// Compliance note (see README "Premium reseller" for the full writeup):
// Tavily's Terms of Service (tavily.com/terms) explicitly permit exactly
// this architecture — §3.2 bans reselling/sublicensing the Services EXCEPT
// "integration of the Services in Customer Applications", and a "Customer
// Application" is defined (§1.2) to include serving end users who are
// third parties, provided (§3.5, Acceptable Use Policy §4) our own paying
// customers never receive the Tavily API key or call Tavily directly.
// endpoints/search-web.js only ever calls Tavily server-side and only ever
// returns already-transformed JSON to the buyer — never the raw key, never
// a redirect straight to Tavily.
//
// 2026-09-03: this file used to also back POST /api/web/scrape (Tavily
// Extract, tavilyExtract()) — retired after a real 6-page comparative test
// against our own /api/web/read found the in-house extractor matched or
// beat Tavily Extract on 5/6 pages, with Tavily's only reproducible edge
// being bot-detection bypass on the 6th (see README "Premium reseller" and
// docs/RAPPORT-P1-PREMIUM.md for the full test). tavilyExtract() and
// TAVILY_EXTRACT_COST_USD removed as dead code along with it.
import { UpstreamError } from "./http.js";
import config from "../config.js";

const TAVILY_BASE = "https://api.tavily.com";
const TIMEOUT_MS = 15_000;

// Real per-call upstream cost at Tavily's pay-as-you-go rate — $0.008 per
// credit (tavily.com/pricing). Used only for our own cost logging
// (logs/couts.jsonl), never charged to the buyer directly (the endpoint's
// fixed x402 price is what the buyer actually pays, set independently in
// endpoints/search-web.js). Basic Search costs exactly 1 credit/request
// (docs.tavily.com/documentation/api-credits) — this constant applies
// directly, no per-endpoint conversion needed (unlike Extract used to
// require, see the note above).
export const TAVILY_CREDIT_COST_USD = 0.008;

// unavailable(detail, upstreamStatus?) -> UpstreamError(503). Every
// failure mode below (missing key, network error, any non-2xx upstream
// response — including exhausted credit balance) collapses to the SAME
// clean 503 message for the CLIENT, never a 500 and never a leaked
// provider error message. `upstreamStatus` (Tavily's real HTTP code, when
// one was actually received) rides along ONLY for our own internal
// logs/echecs.jsonl (see lib/http.js's UpstreamError/safeHandler) — never
// surfaced to the buyer, so this changes no client-visible behavior.
function unavailable(detail, upstreamStatus = null) {
  return new UpstreamError(`This endpoint is temporarily unavailable (${detail}).`, {
    status: 503,
    upstreamStatus,
  });
}

async function callTavily(path, body) {
  if (!config.tavilyApiKey) throw unavailable("upstream provider not configured");

  let response;
  try {
    response = await fetch(`${TAVILY_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.tavilyApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw unavailable("upstream provider unreachable"); // no response received: upstreamStatus stays null
  }

  if (!response.ok) throw unavailable("upstream provider issue", response.status);

  try {
    return await response.json();
  } catch {
    throw unavailable("upstream provider issue", response.status);
  }
}

// tavilySearch({query, maxResults}) -> Tavily's raw /search response
// ({query, answer, results:[{title,url,content,score}], ...}).
export async function tavilySearch({ query, maxResults }) {
  return callTavily("/search", {
    query,
    search_depth: "basic", // 1 credit — the "advanced" depth costs more and isn't needed for a structured-results endpoint
    max_results: maxResults,
  });
}
