// GET /stats — free, read-only diagnostics endpoint (like /health, not under
// /api and not x402-protected). Reports how many 402 Payment Required
// responses ("probes") and how many successful payments each endpoint saw,
// plus the USDC amount collected (global and per endpoint, 24h/7d/all-time)
// — no sensitive data (no IPs, no payer addresses, no transaction hashes;
// see sondage-log.js and payment-log.js).
import { computeStats } from "../lib/stats.js";

export const path = "/stats";
export const method = "GET";
export const price = null;
export const description =
  "Usage stats per endpoint: count of 402 Payment Required responses (probes) vs. successful payments, and " +
  "USDC amount collected, over the last 24h, 7d, and all-time. No sensitive data (no IPs, addresses, or " +
  "transaction hashes). Free, no parameters.";

export async function handler(req, res) {
  // CORS open for GET /stats ONLY: free/anonymized data, meant to be pulled
  // directly from a browser (e.g. the Jarvis PWA's "Crypto x402" panel).
  // Scoped to this single route on purpose — never a blanket app-wide cors().
  res.set("Access-Control-Allow-Origin", "*");
  res.json(await computeStats());
}
