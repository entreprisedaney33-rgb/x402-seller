// GET /api/defi/yields/by-token?symbol=USDC&limit=10 — endpoint payant (0,05 $).
// Meilleurs rendements DeFi pour un jeton donne (toute chaine, tout
// projet), tries par APY decroissant — dedie a la recherche d'agent
// "best yield for token X", complementaire du generique /api/defi/yields.
//
// ATTENTION LICENCE : voir endpoints/defi-price.js pour le detail des CGU
// DefiLlama (usage commercial non couvert par l'API gratuite) — risque
// accepte explicitement par l'operateur de ce service.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { fetchJson } from "../lib/http.js";
import { cached } from "../lib/cache.js";

export const path = "/api/defi/yields/by-token";
export const method = "GET";
export const price = "$0.05";
export const description =
  "Best DeFi yields (APY) for a given token symbol, across all chains and protocols, highest first, source " +
  "DefiLlama — for an agent asking 'where's the best yield for my USDC/ETH/...?'. " +
  "Parameter: ?symbol=<token symbol> (e.g. USDC, required). Optional: ?limit=<n> (1-100, default 10).";

export const discovery = declareDiscoveryExtension({
  input: { symbol: "USDC", limit: 10 },
  inputSchema: {
    properties: {
      symbol: { type: "string", description: "Token symbol to match against pool holdings (e.g. USDC, WETH)." },
      limit: { type: "integer", description: "Number of pools to return (1-100, default 10)." },
    },
    required: ["symbol"],
  },
  output: {
    example: {
      symbol: "USDC",
      pools: [{ chain: "Base", project: "aave-v3", symbol: "USDC", tvlUsd: 85000000, apy: 4.2 }],
      count: 10,
      source: "https://yields.llama.fi/pools",
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

export async function handler(req, res) {
  const symbol = String(req.query.symbol || "").trim();
  if (!symbol) {
    res.status(400).json({ error: "Missing 'symbol' parameter (e.g. ?symbol=USDC)." });
    return;
  }

  let limit = Number.parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit)) limit = 10;
  if (limit < 1 || limit > 100) {
    res.status(400).json({ error: "Invalid 'limit' parameter (integer between 1 and 100 expected)." });
    return;
  }

  const symbolUpper = symbol.toUpperCase();
  const data = await cached("defi-yields:pools", 60_000, () => fetchJson("https://yields.llama.fi/pools"));
  const pools = data.data || [];

  const matches = pools
    .filter((p) => typeof p.apy === "number")
    .filter((p) => String(p.symbol || "").toUpperCase().includes(symbolUpper))
    .sort((a, b) => b.apy - a.apy)
    .slice(0, limit)
    .map((p) => ({ chain: p.chain, project: p.project, symbol: p.symbol, tvlUsd: p.tvlUsd, apy: p.apy }));

  res.json({
    symbol: symbolUpper,
    pools: matches,
    count: matches.length,
    source: "https://yields.llama.fi/pools",
    fetched_at: new Date().toISOString(),
  });
}
