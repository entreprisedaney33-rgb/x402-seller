// GET /api/defi/protocols?limit=20 — endpoint payant (0,005 $).
// Top protocoles DeFi classes par TVL, source DefiLlama.
//
// ATTENTION LICENCE : voir endpoints/defi-price.js pour le detail des CGU
// DefiLlama (usage commercial non couvert par l'API gratuite) — risque
// accepte explicitement par l'operateur de ce service.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { fetchJson } from "../lib/http.js";
import { cached } from "../lib/cache.js";

export const path = "/api/defi/protocols";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Liste des protocoles DeFi tries par TVL decroissante, source DefiLlama. " +
  "Parametre optionnel: ?limit=<n> (1 a 100, defaut 20).";

export const discovery = declareDiscoveryExtension({
  input: { limit: 20 },
  inputSchema: {
    properties: {
      limit: { type: "integer", description: "Nombre de protocoles a renvoyer (1-100, defaut 20)." },
    },
    required: [],
  },
  output: {
    example: {
      protocols: [
        { name: "Binance CEX", symbol: "BNB", category: "CEX", chain: "Multi-Chain", tvl_usd: 120000000000 },
      ],
      count: 20,
      source: "https://api.llama.fi/protocols",
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

export async function handler(req, res) {
  let limit = Number.parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit)) limit = 20;
  if (limit < 1 || limit > 100) {
    res.status(400).json({ error: "Parametre 'limit' invalide (entier entre 1 et 100 attendu)." });
    return;
  }

  const all = await cached("defi-protocols:all", 60_000, () => fetchJson("https://api.llama.fi/protocols"));

  const sorted = [...all]
    .filter((p) => typeof p.tvl === "number")
    .sort((a, b) => b.tvl - a.tvl)
    .slice(0, limit)
    .map((p) => ({
      name: p.name,
      symbol: p.symbol || null,
      category: p.category || null,
      chain: p.chain || null,
      tvl_usd: p.tvl,
    }));

  res.json({
    protocols: sorted,
    count: sorted.length,
    source: "https://api.llama.fi/protocols",
    fetched_at: new Date().toISOString(),
  });
}
