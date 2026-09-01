// GET /api/rdap/domain?domain=x — endpoint payant (0,005 $).
// Donnees RDAP (successeur normalise du WHOIS) via rdap.org, qui redirige
// automatiquement vers le serveur RDAP autoritaire du bon TLD.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { fetchJson, UpstreamError } from "../lib/http.js";
import { cached } from "../lib/cache.js";

export const path = "/api/rdap/domain";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Donnees RDAP d'un domaine (statut, dates de creation/expiration, registrar, serveurs de noms) via rdap.org. " +
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
      status: ["client delete prohibited"],
      registrar: "Reserved-Internet Assigned Numbers Authority",
      nameservers: ["a.iana-servers.net"],
      events: { registration: "1995-08-14T04:00:00Z", expiration: "2027-08-13T04:00:00Z" },
      source: "https://rdap.org",
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

const DOMAIN_RE = /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;

export async function handler(req, res) {
  const domain = String(req.query.domain || "").trim().toLowerCase();
  if (!DOMAIN_RE.test(domain)) {
    res.status(400).json({ error: "Parametre 'domain' invalide (nom de domaine attendu, ex: example.com)." });
    return;
  }

  let data;
  try {
    data = await cached(`rdap:${domain}`, 60_000, () =>
      fetchJson(`https://rdap.org/domain/${domain}`, {
        headers: { Accept: "application/rdap+json" },
      })
    );
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 404) {
      res.status(404).json({ error: `Aucune donnee RDAP trouvee pour "${domain}" (domaine inconnu ou non delegue).` });
      return;
    }
    throw err;
  }

  const registrarEntity = (data.entities || []).find((e) => (e.roles || []).includes("registrar"));
  const registrarName = registrarEntity?.vcardArray?.[1]?.find((v) => v[0] === "fn")?.[3] || registrarEntity?.handle || null;

  const events = {};
  for (const ev of data.events || []) {
    if (ev.eventAction === "registration") events.registration = ev.eventDate;
    if (ev.eventAction === "expiration") events.expiration = ev.eventDate;
    if (ev.eventAction === "last changed") events.last_changed = ev.eventDate;
  }

  res.json({
    domain,
    status: data.status || [],
    registrar: registrarName,
    nameservers: (data.nameservers || []).map((ns) => ns.ldhName).filter(Boolean),
    events,
    source: "https://rdap.org",
    fetched_at: new Date().toISOString(),
  });
}
