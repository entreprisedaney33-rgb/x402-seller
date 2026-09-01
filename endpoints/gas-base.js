// GET /api/gas/base — paid endpoint ($0.005).
// Current gas price on Base mainnet, read live via a public RPC (viem).
// Dedicated route (in addition to the generic GET /api/chain/gas?chain=base)
// so agents searching for "gas price Base" can find and call it directly.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { getGasPrice } from "../lib/chains.js";
import { cached } from "../lib/cache.js";

export const path = "/api/gas/base";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Current gas price on Base (Ethereum L2), read live via a public RPC endpoint — no API key, no aggregator. " +
  "No parameters.";

export const discovery = declareDiscoveryExtension({
  input: {},
  inputSchema: { properties: {}, required: [] },
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
  const gasPriceWei = await cached("gas-base", 60_000, () => getGasPrice("base"));
  res.json({
    chain: "base",
    gas_price_wei: gasPriceWei.toString(),
    gas_price_gwei: Number(gasPriceWei) / 1e9,
    fetched_at: new Date().toISOString(),
  });
}
