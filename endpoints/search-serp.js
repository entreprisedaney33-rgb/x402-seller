// POST /api/search/serp {query, country} — paid endpoint ($0.005).
// Structured Google search results via Serper.dev — see lib/serper.js and
// README "Premium reseller" for the resale-compliance basis. ⚠️ Serper's
// ToS is SILENT (not explicit) on reselling API output — this handler
// deliberately restructures the response (never a raw passthrough) to stay
// clear of the one relevant restriction ("mirror... as-is with
// no-value-added"). Do not change that without re-reading lib/serper.js's
// compliance note.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { serperSearch, SERPER_CREDIT_COST_USD } from "../lib/serper.js";
import { logCoutAmont } from "../lib/couts-log.js";
import { cached } from "../lib/cache.js";

export const path = "/api/search/serp";
export const method = "POST";
export const price = "$0.005";
export const description =
  "Structured Google search results (organic listings, direct answer box, related questions) — for an agent " +
  "that needs to know what Google actually ranks for a query (competitive research, SEO/brand monitoring, " +
  "fact-checking search visibility). " +
  "JSON body: {query: string, country?: 2-letter ISO code (default 'us')}.";

export const discovery = declareDiscoveryExtension({
  method: "POST",
  bodyType: "json",
  input: { query: "best crypto payment protocols 2026", country: "us" },
  inputSchema: {
    properties: {
      query: { type: "string", description: "Search query." },
      country: { type: "string", description: "2-letter ISO country code to localize results (default 'us')." },
    },
    required: ["query"],
  },
  output: {
    example: {
      query: "best crypto payment protocols 2026",
      country: "us",
      answer: null,
      results: [
        { position: 1, title: "x402 Protocol", url: "https://x402.gitbook.io/x402", snippet: "..." },
      ],
      related_questions: ["What is the x402 protocol?"],
      fetched_at: "2026-09-02T12:00:00.000Z",
    },
  },
});

export async function handler(req, res) {
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  if (!query) {
    res.status(400).json({ error: "Field 'query' is required (non-empty string)." });
    return;
  }
  if (query.length > 400) {
    res.status(400).json({ error: "Field 'query' too long (max 400 chars)." });
    return;
  }

  let country = typeof req.body?.country === "string" ? req.body.country.trim().toLowerCase() : "us";
  if (!country) country = "us";
  if (!/^[a-z]{2}$/.test(country)) {
    res.status(400).json({ error: "Invalid 'country' (2-letter ISO code expected, e.g. us, fr, gb)." });
    return;
  }

  const data = await cached(`search-serp:${query}:${country}`, 60_000, async () => {
    const result = await serperSearch({ query, country });
    await logCoutAmont({ endpoint: path, provider: "serper", cout_usd: SERPER_CREDIT_COST_USD });
    return result;
  });

  // Deliberately restructured, not a raw passthrough of Serper's JSON (see
  // lib/serper.js's compliance note): fields renamed/trimmed, and the 3
  // separate Serper sections (answerBox/organic/peopleAlsoAsk) merged into
  // one coherent shape — never remove this transformation.
  res.json({
    query,
    country,
    answer: data.answerBox?.answer || data.answerBox?.snippet || null,
    results: (data.organic || []).map((r) => ({
      position: r.position,
      title: r.title,
      url: r.link,
      snippet: r.snippet,
    })),
    related_questions: (data.peopleAlsoAsk || []).map((q) => q.question).filter(Boolean),
    fetched_at: new Date().toISOString(),
  });
}
