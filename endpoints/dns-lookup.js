// GET /api/dns/lookup?domain=x — endpoint payant (0,005 $).
// Enregistrements A, AAAA, MX, TXT, NS via le module dns natif de Node
// (resolution DNS directe, aucune API tierce).
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { resolve4, resolve6, resolveMx, resolveTxt, resolveNs } from "node:dns/promises";
import { cached } from "../lib/cache.js";

export const path = "/api/dns/lookup";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Enregistrements DNS d'un domaine : A, AAAA, MX, TXT, NS. Absence d'un type de champ = tableau vide, pas une erreur. " +
  "Parametre: ?domain=<nom de domaine> (ex: example.com).";

export const discovery = declareDiscoveryExtension({
  input: { domain: "example.com" },
  inputSchema: {
    properties: {
      domain: { type: "string", description: "Nom de domaine a interroger (ex: example.com)." },
    },
    required: ["domain"],
  },
  output: {
    example: {
      domain: "example.com",
      A: ["104.20.23.154"],
      AAAA: [],
      MX: [{ exchange: "mail.example.com", priority: 10 }],
      TXT: [["v=spf1 -all"]],
      NS: ["a.iana-servers.net"],
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

const DOMAIN_RE = /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

// Une resolution DNS qui echoue (type absent, NXDOMAIN sur ce type precis)
// n'est pas une erreur globale — juste un tableau vide pour ce champ.
async function safeResolve(fn, domain) {
  try {
    return await withTimeout(fn(domain), 10_000);
  } catch {
    return [];
  }
}

export async function handler(req, res) {
  const domain = String(req.query.domain || "").trim().toLowerCase();
  if (!DOMAIN_RE.test(domain)) {
    res.status(400).json({ error: "Parametre 'domain' invalide (nom de domaine attendu, ex: example.com)." });
    return;
  }

  const result = await cached(`dns:${domain}`, 60_000, async () => {
    const [a, aaaa, mx, txt, ns] = await Promise.all([
      safeResolve(resolve4, domain),
      safeResolve(resolve6, domain),
      safeResolve(resolveMx, domain),
      safeResolve(resolveTxt, domain),
      safeResolve(resolveNs, domain),
    ]);
    return { A: a, AAAA: aaaa, MX: mx, TXT: txt, NS: ns };
  });

  const anyRecord = Object.values(result).some((arr) => arr.length > 0);
  if (!anyRecord) {
    res.status(404).json({ error: `Aucun enregistrement DNS trouve pour "${domain}".` });
    return;
  }

  res.json({ domain, ...result, fetched_at: new Date().toISOString() });
}
