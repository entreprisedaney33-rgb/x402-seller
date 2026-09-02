// POST /api/search/web {query, num_results} — paid endpoint ($0.01).
// Semantic web search via Tavily (tavily.com) — see lib/tavily.js and
// README "Premium reseller" for the resale-compliance basis (Tavily's ToS
// explicitly permits this architecture, unlike Exa's, which forbids it —
// that's why Tavily was picked here instead).
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { tavilySearch, TAVILY_CREDIT_COST_USD } from "../lib/tavily.js";
import { logCoutAmont } from "../lib/couts-log.js";
import { cached } from "../lib/cache.js";

export const path = "/api/search/web";
export const method = "POST";
export const price = "$0.01";
export const description =
  "Semantic web search (understands intent, not just keyword matching) — for an agent that needs current " +
  "information, facts, or sources beyond its training data. Returns ranked results (title/url/content snippet) " +
  "plus an optional AI-generated direct answer, via Tavily. " +
  "JSON body: {query: string, num_results?: integer 1-10 (default 5)}.";

export const discovery = declareDiscoveryExtension({
  method: "POST",
  bodyType: "json",
  input: { query: "latest developments in the x402 protocol", num_results: 5 },
  inputSchema: {
    properties: {
      query: { type: "string", description: "Search query." },
      num_results: { type: "integer", description: "Number of results to return (1-10, default 5)." },
    },
    required: ["query"],
  },
  output: {
    example: {
      query: "latest developments in the x402 protocol",
      answer: "x402 is an emerging micropayment protocol built on HTTP 402...",
      results: [
        {
          title: "x402 Protocol Documentation",
          url: "https://x402.gitbook.io/x402",
          content: "x402 is a payment protocol...",
          score: 0.95,
        },
      ],
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

  let numResults = Number.parseInt(req.body?.num_results, 10);
  if (!Number.isFinite(numResults)) numResults = 5;
  if (numResults < 1 || numResults > 10) {
    res.status(400).json({ error: "Invalid 'num_results' (integer between 1 and 10 expected)." });
    return;
  }

  // Cached 60s per (query, num_results): an identical repeated query within
  // that window costs us nothing extra upstream, same convention as the
  // rest of this server's data endpoints (see lib/cache.js).
  const data = await cached(`search-web:${query}:${numResults}`, 60_000, async () => {
    const result = await tavilySearch({ query, maxResults: numResults });
    await logCoutAmont({ endpoint: path, provider: "tavily", cout_usd: TAVILY_CREDIT_COST_USD });
    return result;
  });

  res.json({
    query,
    answer: data.answer || null,
    results: (data.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
    })),
    fetched_at: new Date().toISOString(),
  });
}
