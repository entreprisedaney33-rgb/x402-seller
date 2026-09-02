// POST /api/web/scrape {url} — paid endpoint ($0.02).
// Page extraction to clean Markdown via Tavily Extract — a second, distinct
// engine from our own POST /api/web/read (lib/web.js's readability
// extraction), for pages where the lightweight in-house reader falls
// short. See lib/tavily.js and README "Premium reseller" for the
// resale-compliance basis.
//
// Positioning verified against real pages before writing the description
// below (never promise untested capability):
//   - JS-heavy page (quotes.toscrape.com/js/, content rendered client-side
//     only) -> PASS, real content extracted.
//   - Standard news article (a live BBC News article) -> PASS, real
//     article text extracted, but noisier than /api/web/read's
//     Readability-based output (sidebar/image boilerplate mixed in — this
//     endpoint does a fuller page dump, not a focused article extraction).
//   - Cloudflare-protected sites: first tried nowsecure.nl (FAIL, "Failed
//     to fetch url") — but a follow-up check found that target no longer
//     reliably presents an active Cloudflare challenge at all (plain curl:
//     200, no challenge header), so that result was discarded as a bad
//     test target, not real evidence. Re-tested against 3 sites with a
//     CONFIRMED active Cloudflare challenge (verified via curl immediately
//     before each Tavily call): discogs.com, glassdoor.com, upwork.com —
//     all 3 PASS, substantial real page content extracted (30k-46k chars
//     each). Conclusion: Tavily Extract DOES handle actively bot-protected
//     sites, at least these 3 real cases — not every site is guaranteed,
//     but this is a positive, verified capability, not a caveat to hide.
// Re-run an equivalent check before changing this text again.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { tavilyExtract, TAVILY_CREDIT_COST_USD } from "../lib/tavily.js";
import { logCoutAmont } from "../lib/couts-log.js";
import { cached } from "../lib/cache.js";
import { UpstreamError } from "../lib/http.js";

export const path = "/api/web/scrape";
export const method = "POST";
export const price = "$0.02";
export const description =
  "Page-to-Markdown extraction for hard sites — pages that need JavaScript rendering to show their real content, " +
  "or that are behind an active bot-challenge (e.g. Cloudflare) — a second engine alongside /api/web/read for " +
  "pages where the lightweight in-house reader falls short. Not every site is guaranteed to succeed, and this " +
  "returns a fuller page dump (nav/related-links included) rather than a focused single-article extraction — " +
  "for a clean single article on an easy site, try /api/web/read first. " +
  "JSON body: {url: string (http/https, publicly reachable)}.";

export const discovery = declareDiscoveryExtension({
  method: "POST",
  bodyType: "json",
  input: { url: "https://en.wikipedia.org/wiki/HTTP_402" },
  inputSchema: {
    properties: {
      url: { type: "string", description: "Public http(s) URL of the page to extract." },
    },
    required: ["url"],
  },
  output: {
    example: {
      url: "https://en.wikipedia.org/wiki/HTTP_402",
      text_markdown: "# HTTP 402\n\nThe **402 Payment Required**...",
      fetched_at: "2026-09-02T12:00:00.000Z",
    },
  },
});

export async function handler(req, res) {
  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  if (!url) {
    res.status(400).json({ error: "Field 'url' is required (a public http(s) URL)." });
    return;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid 'url' (must be a well-formed http(s) URL)." });
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    res.status(400).json({ error: "Invalid 'url' (only http:// and https:// are allowed)." });
    return;
  }

  // The failure check happens INSIDE the cached callback, not after: Tavily
  // reports a per-URL extraction failure as a normal 200 response
  // ({failed_results: [...]}), not a thrown error — if that were returned
  // as-is to be cached by cached() below, a single transient Tavily-side
  // hiccup would get "stuck" as a cached failure for the full 60s TTL, even
  // after the real issue clears. Throwing here instead means cached()
  // never stores it (see lib/cache.js — a thrown fn() never reaches
  // store.set), so the next identical request gets a fresh attempt.
  // Confirmed real during testing: en.wikipedia.org/wiki/HTTP_402 failed
  // twice via this endpoint (cached failure) but succeeded when called
  // directly moments later, bypassing the cache.
  let result;
  try {
    result = await cached(`web-scrape:${url}`, 60_000, async () => {
      const data = await tavilyExtract({ url });
      // Logged regardless of outcome: Tavily bills the attempt whether or
      // not extraction actually succeeds for this URL (confirmed during
      // testing — a failed extraction still consumed a credit).
      await logCoutAmont({ endpoint: path, provider: "tavily", cout_usd: TAVILY_CREDIT_COST_USD });

      const failed = (data.failed_results || [])[0];
      if (failed) {
        throw new UpstreamError(`Could not extract this page: ${failed.error || "unknown upstream error"}.`, {
          status: 502,
        });
      }
      const found = (data.results || [])[0];
      if (!found) {
        throw new UpstreamError("Upstream extraction returned no result.", { status: 502 });
      }
      return found;
    });
  } catch (err) {
    if (err instanceof UpstreamError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }

  res.json({
    url: result.url,
    text_markdown: result.raw_content || "",
    fetched_at: new Date().toISOString(),
  });
}
