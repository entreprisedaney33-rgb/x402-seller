// GET /api/gas/ethereum — paid endpoint ($0.005).
// Current gas price on Ethereum mainnet, read live via a public RPC (viem).
// Dedicated route (in addition to the generic GET /api/chain/gas?chain=ethereum)
// so agents searching for "gas price Ethereum" can find and call it directly.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { getGasPrice } from "../lib/chains.js";
import { cached } from "../lib/cache.js";

export const path = "/api/gas/ethereum";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Current gas price on Ethereum mainnet, read live via a public RPC endpoint — no API key, no aggregator. " +
  "No parameters.";

export const discovery = declareDiscoveryExtension({
  input: {},
  inputSchema: { properties: {}, required: [] },
  output: {
    example: {
      chain: "ethereum",
      gas_price_wei: "8000000000",
      gas_price_gwei: 8,
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

export async function handler(req, res) {
  const gasPriceWei = await cached("gas-ethereum", 60_000, () => getGasPrice("ethereum"));
  res.json({
    chain: "ethereum",
    gas_price_wei: gasPriceWei.toString(),
    gas_price_gwei: Number(gasPriceWei) / 1e9,
    fetched_at: new Date().toISOString(),
  });
}
