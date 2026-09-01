// GET /api/defi/tvl-chain?chain=base — endpoint payant (0,005 $).
// TVL (total value locked) courant d'une blockchaine entiere, source DefiLlama.
//
// ATTENTION LICENCE : voir endpoints/defi-price.js pour le detail des CGU
// DefiLlama (usage commercial non couvert par l'API gratuite) — risque
// accepte explicitement par l'operateur de ce service.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { fetchJson } from "../lib/http.js";
import { cached } from "../lib/cache.js";

export const path = "/api/defi/tvl-chain";
export const method = "GET";
export const price = "$0.005";
export const description =
  "TVL (total value locked) courant d'une blockchaine entiere (tous protocoles confondus), " +
  "source DefiLlama. Parametre: ?chain=<slug> (ex: base, ethereum, arbitrum, solana).";

export const discovery = declareDiscoveryExtension({
  input: { chain: "base" },
  inputSchema: {
    properties: {
      chain: { type: "string", description: "Slug de chaine DefiLlama (ex: base, ethereum, arbitrum)" },
    },
    required: ["chain"],
  },
  output: {
    example: {
      chain: "base",
      tvl_usd: 5500000000,
      as_of: "2026-09-01T00:00:00.000Z",
      source: "https://api.llama.fi/v2/historicalChainTvl/base",
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

export async function handler(req, res) {
  const chain = String(req.query.chain || "").toLowerCase();
  if (!/^[a-z0-9-]{1,50}$/.test(chain)) {
    res.status(400).json({ error: "Parametre 'chain' invalide (slug attendu, ex: base)." });
    return;
  }

  const source = `https://api.llama.fi/v2/historicalChainTvl/${chain}`;
  const series = await cached(`tvl-chain:${chain}`, 60_000, () => fetchJson(source));

  if (!Array.isArray(series) || series.length === 0) {
    res.status(404).json({ error: `Chaine inconnue chez DefiLlama: "${chain}".` });
    return;
  }

  const last = series[series.length - 1];
  res.json({
    chain,
    tvl_usd: last.tvl,
    as_of: new Date(last.date * 1000).toISOString(),
    source,
    fetched_at: new Date().toISOString(),
  });
}
