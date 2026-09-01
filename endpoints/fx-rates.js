// GET /api/fx/rates?base=EUR — endpoint payant (0,005 $).
// Taux de change de reference BCE, source Frankfurter (api.frankfurter.app,
// MIT, donnees BCE ouvertes, reutilisation commerciale explicitement admise).
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { fetchJson } from "../lib/http.js";
import { cached } from "../lib/cache.js";

export const path = "/api/fx/rates";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Taux de change de reference (Banque Centrale Europeenne) pour une devise de base, source Frankfurter. " +
  "Parametre: ?base=<code ISO 4217> (defaut EUR, ex: USD, GBP, JPY).";

export const discovery = declareDiscoveryExtension({
  input: { base: "EUR" },
  inputSchema: {
    properties: {
      base: { type: "string", description: "Code devise ISO 4217 de base (ex: EUR, USD)." },
    },
    required: [],
  },
  output: {
    example: {
      base: "EUR",
      date: "2026-09-01",
      rates: { USD: 1.159, GBP: 0.8566 },
      source: "https://api.frankfurter.app",
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

export async function handler(req, res) {
  const base = String(req.query.base || "EUR").toUpperCase();
  if (!/^[A-Z]{3}$/.test(base)) {
    res.status(400).json({ error: "Parametre 'base' invalide (code devise ISO 4217 sur 3 lettres attendu, ex: EUR)." });
    return;
  }

  const data = await cached(`fx-rates:${base}`, 60_000, () =>
    fetchJson(`https://api.frankfurter.app/latest?base=${base}`)
  );

  if (!data.rates) {
    res.status(400).json({ error: `Devise de base inconnue: "${base}".` });
    return;
  }

  res.json({
    base: data.base,
    date: data.date,
    rates: data.rates,
    source: "https://api.frankfurter.app",
    fetched_at: new Date().toISOString(),
  });
}
