// GET /health — endpoint gratuit de verification de vie du serveur.
// price: null => l'endpoint n'est PAS protege par le middleware x402.

export const path = "/health";
export const method = "GET";
export const price = null;
export const description = "Verification de vie du serveur (gratuit).";

export async function handler(req, res) {
  res.json({ ok: true });
}
