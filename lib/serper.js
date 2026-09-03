// lib/serper.js — shared Serper.dev API client for POST /api/search/serp.
//
// ⚠️ Compliance note (see README "Premium reseller" for the full writeup):
// Serper's Terms of Service (serper.dev/terms) are SILENT on reselling API
// output through a paid product — neither explicitly permitted nor
// forbidden. The one clause that matters bans mirroring "the materials on
// any other server as-is with no-value-added". This endpoint deliberately
// RESTRUCTURES Serper's raw JSON (renamed/trimmed fields, 3 sections
// merged into one shape — see endpoints/search-serp.js) rather than
// passing it through verbatim, to stay clearly on the value-added side of
// that clause. Never turn this into a raw passthrough without re-reading
// that clause first.
import { UpstreamError } from "./http.js";
import config from "../config.js";

const SERPER_URL = "https://google.serper.dev/search";
const TIMEOUT_MS = 15_000;

// Real per-call upstream cost at Serper's cheapest prepaid tier (Starter:
// $50 / 50,000 credits = $0.001/credit, 1 credit per query — serper.dev).
// Used only for our own cost logging (logs/couts.jsonl), never charged to
// the buyer directly.
export const SERPER_CREDIT_COST_USD = 0.001;

// unavailable(detail, upstreamStatus?) -> UpstreamError(503). Every
// failure mode (missing key, network error, any non-2xx upstream
// response — including exhausted credit balance) collapses to the SAME
// clean 503 message for the CLIENT, never a 500 and never a leaked
// provider error message. `upstreamStatus` (Serper's real HTTP code, when
// one was actually received) rides along ONLY for our own internal
// logs/echecs.jsonl (see lib/http.js's UpstreamError/safeHandler) — never
// surfaced to the buyer, so this changes no client-visible behavior.
function unavailable(detail, upstreamStatus = null) {
  return new UpstreamError(`This endpoint is temporarily unavailable (${detail}).`, {
    status: 503,
    upstreamStatus,
  });
}

// serperSearch({query, country}) -> Serper's raw /search response
// ({organic:[{position,title,link,snippet}], answerBox, peopleAlsoAsk, ...}).
export async function serperSearch({ query, country }) {
  if (!config.serperApiKey) throw unavailable("upstream provider not configured");

  let response;
  try {
    response = await fetch(SERPER_URL, {
      method: "POST",
      headers: {
        "X-API-KEY": config.serperApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, gl: country, num: 10 }),
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
