// GET /api/defi/tvl?protocol=aave — endpoint payant (0,005 $ en USDC via x402).
// Interroge l'API publique DefiLlama et renvoie le TVL courant du protocole.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

export const path = "/api/defi/tvl";
export const method = "GET";
export const price = "$0.005";
export const description =
  "TVL (total value locked) courant d'un protocole DeFi, source DefiLlama. Parametre: ?protocol=<slug> (defaut: aave).";

// Metadonnees de decouverte Bazaar : decrivent aux agents acheteurs comment
// appeler l'endpoint (parametres d'entree + exemple de sortie).
export const discovery = declareDiscoveryExtension({
  input: { protocol: "aave" },
  inputSchema: {
    properties: {
      protocol: {
        type: "string",
        description: "Slug DefiLlama du protocole (ex: aave, lido, uniswap)",
      },
    },
    required: [],
  },
  output: {
    example: {
      protocol: "aave",
      tvl_usd: 21000000000,
      currency: "USD",
      source: "https://api.llama.fi/tvl/aave",
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

export async function handler(req, res) {
  const protocol = String(req.query.protocol || "aave").toLowerCase();

  // Les slugs DefiLlama sont alphanumeriques avec tirets — on refuse le reste
  // pour ne jamais injecter n'importe quoi dans l'URL amont.
  if (!/^[a-z0-9-]{1,100}$/.test(protocol)) {
    res.status(400).json({ error: "Parametre 'protocol' invalide (slug DefiLlama attendu, ex: aave)." });
    return;
  }

  const source = `https://api.llama.fi/tvl/${protocol}`;

  let upstream;
  try {
    upstream = await fetch(source, { signal: AbortSignal.timeout(10_000) });
  } catch {
    res.status(502).json({ error: "DefiLlama injoignable, reessaie dans un instant." });
    return;
  }

  if (!upstream.ok) {
    res.status(404).json({ error: `Protocole inconnu chez DefiLlama: "${protocol}".` });
    return;
  }

  // L'endpoint /tvl/{protocol} de DefiLlama renvoie un nombre brut (TVL en USD).
  const tvl = Number(await upstream.text());
  if (!Number.isFinite(tvl)) {
    res.status(502).json({ error: "Reponse DefiLlama illisible." });
    return;
  }

  res.json({
    protocol,
    tvl_usd: tvl,
    currency: "USD",
    source,
    fetched_at: new Date().toISOString(),
  });
}
