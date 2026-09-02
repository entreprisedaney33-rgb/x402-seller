// GET /api/defi/yields/top?limit=10&min_tvl=10000000 — endpoint payant (0,005 $).
// Meilleurs rendements DeFi tous criteres confondus (toute chaine, tout
// projet), tries par APY decroissant — dedie a la recherche d'agent
// "best yields right now", complementaire du generique /api/defi/yields.
//
// ATTENTION LICENCE : voir endpoints/defi-price.js pour le detail des CGU
// DefiLlama (usage commercial non couvert par l'API gratuite) — risque
// accepte explicitement par l'operateur de ce service.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { fetchJson } from "../lib/http.js";
import { cached } from "../lib/cache.js";

export const path = "/api/defi/yields/top";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Top DeFi yields (APY) across ALL chains and protocols, highest first, source DefiLlama — for an agent " +
  "hunting the single best yield opportunity right now, with no chain/token filter. " +
  "Optional parameters: ?limit=<n> (1-100, default 10), ?min_tvl=<usd> (minimum pool TVL, default 0).";

export const discovery = declareDiscoveryExtension({
  input: { limit: 10, min_tvl: 10000000 },
  inputSchema: {
    properties: {
      limit: { type: "integer", description: "Number of pools to return (1-100, default 10)." },
      min_tvl: { type: "number", description: "Minimum pool TVL in USD. Optional, default 0." },
    },
    required: [],
  },
  output: {
    example: {
      pools: [{ chain: "Base", project: "aave-v3", symbol: "USDC", tvlUsd: 85000000, apy: 4.2 }],
      count: 10,
      source: "https://yields.llama.fi/pools",
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

export async function handler(req, res) {
  let limit = Number.parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit)) limit = 10;
  if (limit < 1 || limit > 100) {
    res.status(400).json({ error: "Invalid 'limit' parameter (integer between 1 and 100 expected)." });
    return;
  }

  let minTvl = 0;
  if (req.query.min_tvl !== undefined) {
    minTvl = Number(req.query.min_tvl);
    if (!Number.isFinite(minTvl) || minTvl < 0) {
      res.status(400).json({ error: "Invalid 'min_tvl' parameter (positive number expected)." });
      return;
    }
  }

  const data = await cached("defi-yields:pools", 60_000, () => fetchJson("https://yields.llama.fi/pools"));
  const pools = data.data || [];

  const top = pools
    .filter((p) => typeof p.apy === "number")
    .filter((p) => (p.tvlUsd || 0) >= minTvl)
    .sort((a, b) => b.apy - a.apy)
    .slice(0, limit)
    .map((p) => ({ chain: p.chain, project: p.project, symbol: p.symbol, tvlUsd: p.tvlUsd, apy: p.apy }));

  res.json({
    pools: top,
    count: top.length,
    source: "https://yields.llama.fi/pools",
    fetched_at: new Date().toISOString(),
  });
}
