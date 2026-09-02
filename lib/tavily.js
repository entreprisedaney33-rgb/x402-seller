// lib/tavily.js — shared Tavily API client for POST /api/search/web
// (Tavily Search) and POST /api/web/scrape (Tavily Extract).
//
// Compliance note (see README "Premium reseller" for the full writeup):
// Tavily's Terms of Service (tavily.com/terms) explicitly permit exactly
// this architecture — §3.2 bans reselling/sublicensing the Services EXCEPT
// "integration of the Services in Customer Applications", and a "Customer
// Application" is defined (§1.2) to include serving end users who are
// third parties, provided (§3.5, Acceptable Use Policy §4) our own paying
// customers never receive the Tavily API key or call Tavily directly.
// Both endpoints below only ever call Tavily server-side and only ever
// return already-transformed JSON to the buyer — never the raw key, never
// a redirect straight to Tavily.
import { UpstreamError } from "./http.js";
import config from "../config.js";

const TAVILY_BASE = "https://api.tavily.com";
const TIMEOUT_MS = 15_000;

// Real per-call upstream cost at Tavily's pay-as-you-go rate ($0.008 per
// credit — tavily.com/pricing) — basic search and a single-URL basic
// extract both cost exactly 1 credit. Used only for our own cost logging
// (logs/couts.jsonl), never charged to the buyer directly (the endpoint's
// fixed x402 price is what the buyer actually pays, set independently in
// endpoints/search-web.js / endpoints/web-scrape.js).
export const TAVILY_CREDIT_COST_USD = 0.008;

// unavailable(detail) -> UpstreamError(503). Every failure mode below
// (missing key, network error, any non-2xx upstream response — including
// exhausted credit balance) collapses to the SAME clean 503, never a 500
// and never a leaked provider error message.
function unavailable(detail) {
  return new UpstreamError(`This endpoint is temporarily unavailable (${detail}).`, { status: 503 });
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
    throw unavailable("upstream provider unreachable");
  }

  if (!response.ok) throw unavailable("upstream provider issue");

  try {
    return await response.json();
  } catch {
    throw unavailable("upstream provider issue");
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

// tavilyExtract({url}) -> Tavily's raw /extract response
// ({results:[{url,raw_content,...}], failed_results:[...]}).
export async function tavilyExtract({ url }) {
  return callTavily("/extract", {
    urls: url,
    extract_depth: "basic", // 1 credit for up to 5 URLs — we only ever send 1
    format: "markdown",
  });
}
