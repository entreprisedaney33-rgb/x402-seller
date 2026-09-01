// GET /stats — free, read-only diagnostics endpoint (like /health, not under
// /api and not x402-protected). Reports how many 402 Payment Required
// responses ("probes") and how many successful payments each endpoint saw
// in the last 24h and 7d — no sensitive data (no IPs, no payer addresses,
// no transaction hashes; see sondage-log.js and payment-log.js).
import { computeStats } from "../lib/stats.js";

export const path = "/stats";
export const method = "GET";
export const price = null;
export const description =
  "Usage stats per endpoint over the last 24h and 7d: count of 402 Payment Required responses (probes) vs. " +
  "successful payments. No sensitive data (no IPs, addresses, or transaction hashes). Free, no parameters.";

export async function handler(req, res) {
  res.json(await computeStats());
}
