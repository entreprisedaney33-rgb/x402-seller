// lib/chains.js — resolution du parametre ?chain= vers un client viem
// (RPC public par defaut de la chaine, fourni par viem/chains).
import { createPublicClient, http } from "viem";
import { base, mainnet } from "viem/chains";

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
