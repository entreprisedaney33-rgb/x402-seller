// lib/defi.js — small shared helpers for endpoints/price-*.js, all backed by
// the same DefiLlama sources already used by endpoints/defi-price.js and
// endpoints/defi-stablecoins.js (see the licensing note in defi-price.js).
import { fetchJson } from "./http.js";

// fetchCoinPrice(coingeckoId) -> { price, symbol, confidence } | null
export async function fetchCoinPrice(coingeckoId) {
  const data = await fetchJson(`https://coins.llama.fi/prices/current/coingecko:${coingeckoId}`);
  const entry = data.coins?.[`coingecko:${coingeckoId}`];
  if (!entry) return null;
  return { price: entry.price, symbol: entry.symbol, confidence: entry.confidence };
}

// fetchUsdcSupply() -> { circulating_usd } | null — total USDC circulating
// supply across all chains, from the same stablecoins index used by
// GET /api/defi/stablecoins.
export async function fetchUsdcSupply() {
  const data = await fetchJson("https://stablecoins.llama.fi/stablecoins?includePrices=false");
  const usdc = (data.peggedAssets || []).find((s) => s.symbol === "USDC");
  if (!usdc || typeof usdc.circulating?.peggedUSD !== "number") return null;
  return { circulating_usd: usdc.circulating.peggedUSD };
}
