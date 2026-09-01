// lib/chains.js — resolution du parametre ?chain= vers un client viem
// (RPC public par defaut de la chaine, fourni par viem/chains).
import { createPublicClient, http } from "viem";
import { base, mainnet } from "viem/chains";
import { UpstreamError } from "./http.js";

const CHAINS = {
  base,
  ethereum: mainnet,
};

export function getPublicClient(chainName) {
  const chain = CHAINS[chainName];
  if (!chain) return null;
  return createPublicClient({ chain, transport: http(undefined, { timeout: 10_000 }) });
}

export const SUPPORTED_CHAINS = Object.keys(CHAINS);

// getGasPrice(chainName) -> current gas price in wei (bigint), shared by
// GET /api/chain/gas and the dedicated GET /api/gas/<chain> endpoints.
export async function getGasPrice(chainName) {
  const client = getPublicClient(chainName);
  if (!client) return null;
  try {
    return await client.getGasPrice();
  } catch (err) {
    throw new UpstreamError(`RPC ${chainName} unreachable: ${err.message}`, { status: 502 });
  }
}
