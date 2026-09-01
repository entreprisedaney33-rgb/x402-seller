// GET /health — free liveness check endpoint.
// price: null => this endpoint is NOT protected by the x402 middleware.

export const path = "/health";
export const method = "GET";
export const price = null;
export const description = "Server liveness check (free).";

export async function handler(req, res) {
  res.json({ ok: true });
}
