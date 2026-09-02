// GET /api/defi/yields/pool?pool=<id> — endpoint payant (0,005 $).
// Detail + historique APY/TVL recent d'un pool DeFi precis, source
// DefiLlama — pour un agent qui a deja un pool id (depuis /pools,
// /api/defi/yields/top|by-token|by-chain) et veut verifier sa stabilite
// dans le temps avant d'y engager des fonds.
//
// Endpoint chart verifie en direct (pas suppose) contre la doc actuelle
// (api-docs.defillama.com/llms-free.txt) le 2026-09-02 : le texte de la
// doc donne "Base URL: https://api.llama.fi" pour /chart/{pool}, mais un
// test reel montre que SEUL https://yields.llama.fi/chart/{pool} repond
// (200, {status,data[]}) — https://api.llama.fi/chart/{pool} renvoie 404.
// On suit donc le comportement reel observe, pas le texte de la doc,
// cohérent avec le /pools deja utilise par endpoints/defi-yields.js
// (lui aussi sur yields.llama.fi, jamais api.llama.fi).
//
// ATTENTION LICENCE : voir endpoints/defi-price.js pour le detail des CGU
// DefiLlama (usage commercial non couvert par l'API gratuite) — risque
// accepte explicitement par l'operateur de ce service.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { fetchJson } from "../lib/http.js";
import { cached } from "../lib/cache.js";

export const path = "/api/defi/yields/pool";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Detail and recent APY/TVL history of one specific DeFi pool (identified by its DefiLlama pool id, as " +
  "returned by /api/defi/yields/top, /by-token, or /by-chain), source DefiLlama. " +
  "Parameter: ?pool=<pool id> (required, e.g. 747c1d2a-c668-4682-b9f9-296708a3dd90).";

export const discovery = declareDiscoveryExtension({
  input: { pool: "747c1d2a-c668-4682-b9f9-296708a3dd90" },
  inputSchema: {
    properties: {
      pool: { type: "string", description: "DefiLlama pool id (the 'pool' field from /pools or the sibling yields endpoints)." },
    },
    required: ["pool"],
  },
  output: {
    example: {
      pool: "747c1d2a-c668-4682-b9f9-296708a3dd90",
      chain: "Base",
      project: "aave-v3",
      symbol: "USDC",
      tvlUsd: 85000000,
      apy: 4.2,
      history: [{ date: "2026-08-30T00:00:00.000Z", tvlUsd: 84000000, apy: 4.1 }],
      source: "https://yields.llama.fi/chart/747c1d2a-c668-4682-b9f9-296708a3dd90",
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

const HISTORY_POINTS = 30;

export async function handler(req, res) {
  const poolId = String(req.query.pool || "").trim();
  if (!poolId) {
    res.status(400).json({ error: "Missing 'pool' parameter (a DefiLlama pool id, e.g. from /api/defi/yields/top)." });
    return;
  }

  const poolsData = await cached("defi-yields:pools", 60_000, () => fetchJson("https://yields.llama.fi/pools"));
  const match = (poolsData.data || []).find((p) => p.pool === poolId);

  if (!match) {
    res.status(404).json({ error: `Unknown pool id on DefiLlama: "${poolId}".` });
    return;
  }

  const source = `https://yields.llama.fi/chart/${encodeURIComponent(poolId)}`;
  const chart = await cached(`defi-yields:chart:${poolId}`, 60_000, () => fetchJson(source));

  const history = (chart.data || [])
    .slice(-HISTORY_POINTS)
    .map((point) => ({ date: point.timestamp, tvlUsd: point.tvlUsd, apy: point.apy }));

  res.json({
    pool: poolId,
    chain: match.chain,
    project: match.project,
    symbol: match.symbol,
    tvlUsd: match.tvlUsd,
    apy: match.apy,
    history,
    source,
    fetched_at: new Date().toISOString(),
  });
}
