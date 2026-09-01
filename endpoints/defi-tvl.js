// GET /api/defi/tvl?protocol=aave — endpoint payant (0,005 $ en USDC via x402).
// Interroge l'API publique DefiLlama et renvoie le TVL courant du protocole.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

export const path = "/api/defi/tvl";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Current TVL (total value locked) of a specific DeFi protocol, source DefiLlama. " +
  "Parameter: ?protocol=<slug> (default: aave).";

// Bazaar discovery metadata: describes to buyer agents how to call this
// endpoint (input parameters + an example output).
export const discovery = declareDiscoveryExtension({
  input: { protocol: "aave" },
  inputSchema: {
    properties: {
      protocol: {
        type: "string",
        description: "DefiLlama protocol slug (e.g. aave, lido, uniswap).",
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

  // DefiLlama slugs are alphanumeric with dashes — reject anything else so
  // we never inject arbitrary input into the upstream URL.
  if (!/^[a-z0-9-]{1,100}$/.test(protocol)) {
    res.status(400).json({ error: "Invalid 'protocol' parameter (DefiLlama slug expected, e.g. aave)." });
    return;
  }

  const source = `https://api.llama.fi/tvl/${protocol}`;

  let upstream;
  try {
    upstream = await fetch(source, { signal: AbortSignal.timeout(10_000) });
  } catch {
    res.status(502).json({ error: "DefiLlama unreachable, try again in a moment." });
    return;
  }

  if (!upstream.ok) {
    res.status(404).json({ error: `Unknown protocol on DefiLlama: "${protocol}".` });
    return;
  }

  // DefiLlama's /tvl/{protocol} endpoint returns a raw number (TVL in USD).
  const tvl = Number(await upstream.text());
  if (!Number.isFinite(tvl)) {
    res.status(502).json({ error: "Unreadable response from DefiLlama." });
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
