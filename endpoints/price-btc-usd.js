// GET /api/price/btc-usd — paid endpoint ($0.005).
// Current BTC price in USD, source DefiLlama (same source as GET /api/defi/price).
// Dedicated route so agents searching for "BTC price USD" can find and call
// it directly, without knowing the generic /api/defi/price?coins= shape.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { fetchCoinPrice } from "../lib/defi.js";
import { cached } from "../lib/cache.js";

export const path = "/api/price/btc-usd";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Current BTC (Bitcoin) price in USD, source DefiLlama. No parameters.";

export const discovery = declareDiscoveryExtension({
  input: {},
  inputSchema: { properties: {}, required: [] },
  output: {
    example: {
      symbol: "BTC",
      price_usd: 65000.12,
      confidence: 0.99,
      source: "https://coins.llama.fi",
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

export async function handler(req, res) {
  const data = await cached("price-btc-usd", 60_000, () => fetchCoinPrice("bitcoin"));
  if (!data) {
    res.status(502).json({ error: "BTC price not found." });
    return;
  }
  res.json({
    symbol: data.symbol || "BTC",
    price_usd: data.price,
    confidence: data.confidence,
    source: "https://coins.llama.fi",
    fetched_at: new Date().toISOString(),
  });
}
