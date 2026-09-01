// GET /api/defi/price?coins=ethereum,bitcoin — endpoint payant (0,005 $).
// Prix courants via DefiLlama (coins.llama.fi), gratuit et sans cle.
//
// ATTENTION LICENCE : les CGU DefiLlama (defillama.com/terms, clause 7 +
// 8.10) restreignent l'API gratuite a un usage personnel non-commercial et
// interdisent l'exploitation commerciale des donnees sans accord ecrit.
// Utilisee ici quand meme sur decision explicite et informee de l'operateur
// de ce service (risque accepte) — a reconsiderer si DefiLlama en fait la
// demande, ou en passant sur leur API Pro (pro-api.llama.fi) le cas echeant.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { fetchJson } from "../lib/http.js";
import { cached } from "../lib/cache.js";

export const path = "/api/defi/price";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Prix courant en USD d'une ou plusieurs cryptomonnaies, source DefiLlama. " +
  "Parametre: ?coins=ethereum,bitcoin (identifiants CoinGecko separes par des virgules, ou " +
  "'chaine:adresse' pour un token specifique, ex: ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7).";

export const discovery = declareDiscoveryExtension({
  input: { coins: "ethereum,bitcoin" },
  inputSchema: {
    properties: {
      coins: {
        type: "string",
        description: "Liste d'identifiants separes par des virgules (ex: ethereum,bitcoin ou base:0x...).",
      },
    },
    required: ["coins"],
  },
  output: {
    example: {
      prices: {
        ethereum: { price: 2400.5, symbol: "ETH", confidence: 0.99 },
        bitcoin: { price: 65000.12, symbol: "BTC", confidence: 0.99 },
      },
      currency: "USD",
      source: "https://coins.llama.fi",
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

const ID_RE = /^[a-zA-Z0-9_-]+(:[a-zA-Z0-9_-]+)?$/;

export async function handler(req, res) {
  const raw = String(req.query.coins || "").trim();
  if (!raw) {
    res.status(400).json({ error: "Parametre 'coins' requis (ex: ?coins=ethereum,bitcoin)." });
    return;
  }

  const requested = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (requested.length === 0 || requested.length > 20) {
    res.status(400).json({ error: "Fournis entre 1 et 20 identifiants dans 'coins'." });
    return;
  }
  if (!requested.every((id) => ID_RE.test(id))) {
    res.status(400).json({
      error: "Identifiant invalide dans 'coins' (attendu: lettres/chiffres/tirets, optionnellement 'chaine:adresse').",
    });
    return;
  }

  // DefiLlama adresse un coin connu via 'coingecko:<id>' ; un identifiant
  // deja de la forme 'chaine:adresse' est transmis tel quel.
  const llamaIds = requested.map((id) => (id.includes(":") ? id : `coingecko:${id}`));
  const cacheKey = `defi-price:${llamaIds.join(",")}`;

  const data = await cached(cacheKey, 60_000, () =>
    fetchJson(`https://coins.llama.fi/prices/current/${llamaIds.join(",")}`)
  );

  const prices = {};
  for (let i = 0; i < requested.length; i++) {
    const entry = data.coins?.[llamaIds[i]];
    if (entry) {
      prices[requested[i]] = {
        price: entry.price,
        symbol: entry.symbol,
        confidence: entry.confidence,
      };
    }
  }

  if (Object.keys(prices).length === 0) {
    res.status(404).json({ error: "Aucun prix trouve pour les identifiants fournis." });
    return;
  }

  res.json({
    prices,
    currency: "USD",
    source: "https://coins.llama.fi",
    fetched_at: new Date().toISOString(),
  });
}
