// GET /api/price/sol-usd — paid endpoint ($0.005).
// Current SOL price in USD, source DefiLlama (same source as GET /api/defi/price).
// Dedicated route so agents searching for "SOL price USD" can find and call
// it directly, without knowing the generic /api/defi/price?coins= shape.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { fetchCoinPrice } from "../lib/defi.js";
import { cached } from "../lib/cache.js";

export const path = "/api/price/sol-usd";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Current SOL (Solana) price in USD, source DefiLlama. No parameters.";

export const discovery = declareDiscoveryExtension({
  input: {},
  inputSchema: { properties: {}, required: [] },
  output: {
    example: {
      symbol: "SOL",
      price_usd: 145.32,
      confidence: 0.99,
      source: "https://coins.llama.fi",
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

export async function handler(req, res) {
  const data = await cached("price-sol-usd", 60_000, () => fetchCoinPrice("solana"));
  if (!data) {
    res.status(502).json({ error: "SOL price not found." });
    return;
  }
  res.json({
    symbol: data.symbol || "SOL",
    price_usd: data.price,
    confidence: data.confidence,
    source: "https://coins.llama.fi",
    fetched_at: new Date().toISOString(),
  });
}
