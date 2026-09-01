// GET /api/defi/yields?chain=base&min_tvl=1000000 — endpoint payant (0,005 $).
// Meilleurs rendements de pools DeFi, source DefiLlama (yields.llama.fi).
//
// ATTENTION LICENCE : voir endpoints/defi-price.js pour le detail des CGU
// DefiLlama (usage commercial non couvert par l'API gratuite) — risque
// accepte explicitement par l'operateur de ce service.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { fetchJson } from "../lib/http.js";
import { cached } from "../lib/cache.js";

export const path = "/api/defi/yields";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Best DeFi yields (APY) across lending/liquidity pools, highest first, source DefiLlama. " +
  "Optional parameters: ?chain=<slug> (e.g. base), ?min_tvl=<usd> (minimum pool TVL), ?limit=<n> (default 20, max 100).";

export const discovery = declareDiscoveryExtension({
  input: { chain: "base", min_tvl: 1000000 },
  inputSchema: {
    properties: {
      chain: { type: "string", description: "Filter by chain name (e.g. base, ethereum). Optional." },
      min_tvl: { type: "number", description: "Minimum pool TVL in USD. Optional." },
      limit: { type: "integer", description: "Number of pools to return (1-100, default 20)." },
    },
    required: [],
  },
  output: {
    example: {
      pools: [
        { project: "aave-v3", chain: "Base", symbol: "USDC", apy: 4.2, tvl_usd: 85000000, stablecoin: true },
      ],
      count: 20,
      source: "https://yields.llama.fi/pools",
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

export async function handler(req, res) {
  const chainFilter = req.query.chain ? String(req.query.chain).toLowerCase() : null;

  let minTvl = 0;
  if (req.query.min_tvl !== undefined) {
    minTvl = Number(req.query.min_tvl);
    if (!Number.isFinite(minTvl) || minTvl < 0) {
      res.status(400).json({ error: "Invalid 'min_tvl' parameter (positive number expected)." });
      return;
    }
  }

  let limit = Number.parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit)) limit = 20;
  if (limit < 1 || limit > 100) {
    res.status(400).json({ error: "Invalid 'limit' parameter (integer between 1 and 100 expected)." });
    return;
  }

  const data = await cached("defi-yields:pools", 60_000, () => fetchJson("https://yields.llama.fi/pools"));
  const pools = data.data || [];

  const filtered = pools
    .filter((p) => (chainFilter ? String(p.chain || "").toLowerCase() === chainFilter : true))
    .filter((p) => (p.tvlUsd || 0) >= minTvl)
    .filter((p) => typeof p.apy === "number")
    .sort((a, b) => b.apy - a.apy)
    .slice(0, limit)
    .map((p) => ({
      project: p.project,
      chain: p.chain,
      symbol: p.symbol,
      apy: p.apy,
      tvl_usd: p.tvlUsd,
      stablecoin: !!p.stablecoin,
    }));

  res.json({
    pools: filtered,
    count: filtered.length,
    source: "https://yields.llama.fi/pools",
    fetched_at: new Date().toISOString(),
  });
}
