// GET /api/defi/stablecoins — endpoint payant (0,005 $).
// Capitalisations des principaux stablecoins, source DefiLlama.
//
// ATTENTION LICENCE : voir endpoints/defi-price.js pour le detail des CGU
// DefiLlama (usage commercial non couvert par l'API gratuite) — risque
// accepte explicitement par l'operateur de ce service.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { fetchJson } from "../lib/http.js";
import { cached } from "../lib/cache.js";

export const path = "/api/defi/stablecoins";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Capitalisation en circulation des principaux stablecoins, triee decroissante, source DefiLlama. " +
  "Parametre optionnel: ?limit=<n> (1-100, defaut 20).";

export const discovery = declareDiscoveryExtension({
  input: {},
  inputSchema: {
    properties: {
      limit: { type: "integer", description: "Nombre de stablecoins a renvoyer (1-100, defaut 20)." },
    },
    required: [],
  },
  output: {
    example: {
      stablecoins: [
        { name: "Tether", symbol: "USDT", peg: "peggedUSD", mechanism: "fiat-backed", circulating_usd: 183000000000 },
      ],
      count: 20,
      source: "https://stablecoins.llama.fi/stablecoins",
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

  const data = await cached("defi-stablecoins:all", 60_000, () =>
    fetchJson("https://stablecoins.llama.fi/stablecoins?includePrices=false")
  );

  const sorted = [...(data.peggedAssets || [])]
    .filter((s) => typeof s.circulating?.peggedUSD === "number")
    .sort((a, b) => b.circulating.peggedUSD - a.circulating.peggedUSD)
    .slice(0, limit)
    .map((s) => ({
      name: s.name,
      symbol: s.symbol,
      peg: s.pegType,
      mechanism: s.pegMechanism,
      circulating_usd: s.circulating.peggedUSD,
    }));

  res.json({
    stablecoins: sorted,
    count: sorted.length,
    source: "https://stablecoins.llama.fi/stablecoins",
    fetched_at: new Date().toISOString(),
  });
}
