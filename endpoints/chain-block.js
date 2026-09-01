// GET /api/chain/block?chain=base — endpoint payant (0,005 $).
// Dernier bloc et son horodatage, via RPC public (viem).
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { getPublicClient, SUPPORTED_CHAINS } from "../lib/chains.js";
import { cached } from "../lib/cache.js";
import { UpstreamError } from "../lib/http.js";

export const path = "/api/chain/block";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Dernier bloc connu (numero, horodatage, hash) d'une blockchaine EVM, lu en direct via RPC public (viem). " +
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
      block_number: 21500000,
      block_hash: "0xabc...",
      timestamp: "2026-09-01T12:00:00.000Z",
      fetched_at: "2026-09-01T12:00:05.000Z",
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

  const block = await cached(`chain-block:${chainName}`, 60_000, async () => {
    try {
      return await client.getBlock();
    } catch (err) {
      throw new UpstreamError(`RPC ${chainName} injoignable : ${err.message}`, { status: 502 });
    }
  });

  res.json({
    chain: chainName,
    block_number: Number(block.number),
    block_hash: block.hash,
    timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
    fetched_at: new Date().toISOString(),
  });
}
