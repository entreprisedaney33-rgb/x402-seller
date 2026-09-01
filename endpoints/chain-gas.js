// GET /api/chain/gas?chain=base|ethereum — endpoint payant (0,005 $).
// Prix du gas courant via RPC public (viem), pas d'API tierce agregee.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { getPublicClient, SUPPORTED_CHAINS } from "../lib/chains.js";
import { cached } from "../lib/cache.js";
import { UpstreamError } from "../lib/http.js";

export const path = "/api/chain/gas";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Prix du gas courant sur une blockchaine EVM, lu en direct via RPC public (viem). " +
  `Parametre: ?chain=<${SUPPORTED_CHAINS.join("|")}>.`;

export const discovery = declareDiscoveryExtension({
  input: { chain: "base" },
  inputSchema: {
    properties: {
      chain: { type: "string", enum: SUPPORTED_CHAINS, description: "Chaine EVM interrogee." },
    },
    required: ["chain"],
  },
  output: {
    example: {
      chain: "base",
      gas_price_wei: "6000000",
      gas_price_gwei: 0.006,
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

export async function handler(req, res) {
  const chainName = String(req.query.chain || "").toLowerCase();
  const client = getPublicClient(chainName);
  if (!client) {
    res.status(400).json({ error: `Parametre 'chain' invalide. Valeurs acceptees: ${SUPPORTED_CHAINS.join(", ")}.` });
    return;
  }

  const gasPriceWei = await cached(`chain-gas:${chainName}`, 60_000, async () => {
    try {
      return await client.getGasPrice();
    } catch (err) {
      throw new UpstreamError(`RPC ${chainName} injoignable : ${err.message}`, { status: 502 });
    }
  });

  res.json({
    chain: chainName,
    gas_price_wei: gasPriceWei.toString(),
    gas_price_gwei: Number(gasPriceWei) / 1e9,
    fetched_at: new Date().toISOString(),
  });
}
