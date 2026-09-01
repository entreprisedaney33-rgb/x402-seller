// GET /api/price/usdc-supply — paid endpoint ($0.005).
// Total circulating USDC supply (all chains combined) in USD, source
// DefiLlama (same source as GET /api/defi/stablecoins).
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { fetchUsdcSupply } from "../lib/defi.js";
import { cached } from "../lib/cache.js";

export const path = "/api/price/usdc-supply";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Total USDC circulating supply (all chains combined), in USD, source DefiLlama. No parameters.";

export const discovery = declareDiscoveryExtension({
  input: {},
  inputSchema: { properties: {}, required: [] },
  output: {
    example: {
      symbol: "USDC",
      circulating_usd: 62000000000,
      source: "https://stablecoins.llama.fi/stablecoins",
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

export async function handler(req, res) {
  const data = await cached("price-usdc-supply", 60_000, fetchUsdcSupply);
  if (!data) {
    res.status(502).json({ error: "USDC supply not found." });
    return;
  }
  res.json({
    symbol: "USDC",
    circulating_usd: data.circulating_usd,
    source: "https://stablecoins.llama.fi/stablecoins",
    fetched_at: new Date().toISOString(),
  });
}
