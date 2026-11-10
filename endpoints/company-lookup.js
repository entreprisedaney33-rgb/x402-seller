// GET /api/company/lookup — endpoint payant (0,02 $). Ajoute le 10/11/2026.
//
// Fiche entreprise FR/UE prete a l'emploi pour un agent :
//   ?id=<TVA UE | SIREN | SIRET> -> TVA verifiee dans VIES (registre officiel
//        de la Commission europeenne) + fiche officielle francaise : raison
//        sociale, adresse, NAF, statut, dirigeants, CA/resultat, effectif,
//        date de creation, labels (bio, RGE...).
//   ?name=<raison sociale>[&postal_code=75015] -> jusqu'a 5 entreprises
//        francaises candidates (pour retrouver le SIREN a partir d'un nom).
//
// Logique TVA/SIREN reprise de l'Actor Apify eu-vat-siren-check (labo-ia,
// produits/apify-actors) — voir lib/company/. Sources : VIES et
// recherche-entreprises.api.gouv.fr (donnees INSEE/INPI/DGFiP, Licence
// Ouverte Etalab, reutilisation commerciale autorisee).
//
// Donnees personnelles : jamais de date de naissance des dirigeants ; noms
// des dirigeants personnes physiques retires si l'entreprise est marquee
// opposee a la diffusion commerciale ou non diffusible.
//
// Facturation : x402 ne regle QUE les reponses < 400. Toute panne amont
// (VIES et API entreprises injoignables) -> 503, donc jamais facturee.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { classifyIdentifier } from "../lib/company/identifier.js";
import { buildRecord } from "../lib/company/record.js";
import { lookupSirenOrSiret } from "../lib/company/sirene.js";
import { cached } from "../lib/cache.js";

export const path = "/api/company/lookup";
export const method = "GET";
export const price = "$0.02";
export const description =
  "EU company check (KYB): EU VAT validated live in VIES + official French record (name, address, NAF, status, " +
  "executives, revenue, headcount). ?id=<EU VAT | SIREN | SIRET> or ?name=<company>[&postal_code=]. " +
  "Registry outage -> 503, not charged.";

export const discovery = declareDiscoveryExtension({
  input: { id: "FR39356000000" },
  inputSchema: {
    properties: {
      id: {
        type: "string",
        description: "EU VAT number with country prefix (e.g. DE123456789, FR39356000000), or a French SIREN/SIRET.",
      },
      name: { type: "string", description: "Company name to search (France), used when no id is known." },
      postal_code: { type: "string", description: "Optional French postal code to narrow a name search." },
    },
  },
  output: {
    example: {
      input: "FR39356000000",
      vat: { country_code: "FR", number: "39356000000", valid: true, source: "VIES", checked_at: "2026-11-10T12:00:00.000Z" },
      company: {
        legal_name: "LA POSTE",
        siren: "356000000",
        siret: "35600000000048",
        address: "9 RUE DU COLONEL PIERRE AVIA 75015 PARIS",
        naf: "53.10Z",
        status: "active",
        created_on: "1991-01-01",
        category: "GE",
        headcount_band: "53",
        executives: [{ name: "Jane DOE", role: "Président du conseil d'administration", type: "person" }],
        finances: { year: "2025", revenue_eur: 26700000000, net_income_eur: 1474000000 },
      },
      sources: ["https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number", "https://recherche-entreprises.api.gouv.fr/search"],
      fetched_at: "2026-11-10T12:00:00.000Z",
    },
  },
});

const SEARCH_URL = "https://recherche-entreprises.api.gouv.fr/search";

function statusFromRaw(code) {
  if (code === "A") return "active";
  if (code) return "closed";
  return null;
}

// Diffusion des noms de dirigeants personnes physiques : seulement si la
// fiche est diffusible ("O") et sans opposition a la diffusion commerciale.
function peopleAllowed(raw) {
  return raw.statut_diffusion === "O" && raw.opposition_diffusion_commerciale !== true;
}

function executivesFrom(raw) {
  const list = Array.isArray(raw.dirigeants) ? raw.dirigeants : [];
  const allowPeople = peopleAllowed(raw);
  const out = [];
  for (const d of list.slice(0, 15)) {
    if (d.type_dirigeant === "personne morale") {
      out.push({ name: d.denomination || null, siren: d.siren || null, role: d.qualite || null, type: "company" });
    } else if (allowPeople) {
      const name = [d.prenoms, d.nom].filter(Boolean).join(" ") || null;
      out.push({ name, role: d.qualite || null, type: "person" }); // jamais de date de naissance
    }
  }
  return out;
}

function latestFinances(raw) {
  const f = raw.finances;
  if (!f || typeof f !== "object") return null;
  const year = Object.keys(f).sort().pop();
  if (!year) return null;
  return { year, revenue_eur: f[year]?.ca ?? null, net_income_eur: f[year]?.resultat_net ?? null };
}

function labelsFrom(raw) {
  const c = raw.complements || {};
  const map = {
    est_bio: "organic",
    est_rge: "rge",
    est_ess: "social_economy",
    est_societe_mission: "mission_company",
    est_qualiopi: "qualiopi",
    est_association: "association",
    est_service_public: "public_service",
    est_entrepreneur_individuel: "sole_proprietor",
  };
  return Object.entries(map).filter(([k]) => c[k] === true).map(([, v]) => v);
}

function summaryFrom(raw) {
  return {
    legal_name: raw.nom_complet || raw.nom_raison_sociale || null,
    siren: raw.siren || null,
    address: raw.siege?.adresse || null,
    naf: raw.activite_principale || null,
    status: statusFromRaw(raw.etat_administratif),
    created_on: raw.date_creation || null,
  };
}

async function handleId(rawId, res) {
  const classified = classifyIdentifier(rawId);
  if (classified.type === "malformed") {
    res.status(400).json({ error: `Invalid 'id': ${classified.reason}` });
    return;
  }

  // Seules les verifications reussies sont mises en cache (une panne amont
  // ne doit pas etre resservie pendant 10 min) : cached() ne stocke rien
  // quand la fonction leve une erreur.
  let record;
  try {
    record = await cached(`company:${classified.input}`, 10 * 60_000, async () => {
      const r = await buildRecord(classified, true);
      if (!r.charged) throw Object.assign(new Error("verification incomplete"), { record: r });
      return r;
    });
  } catch (err) {
    if (!err.record) throw err;
    record = err.record;
  }
  if (!record.charged) {
    // Aucune verification menee a bien (VIES et/ou API entreprises en panne).
    res.status(503).json({ error: "Official registries temporarily unavailable, retry later (not charged)." });
    return;
  }

  let raw = null;
  if (record.siren && record.activeStatus !== "not_found") {
    const r = await lookupSirenOrSiret(record.siren); // en cache (lib/company/sirene.js)
    if (r.ok && r.found) raw = r.record;
  }

  res.json({
    input: record.input,
    vat: record.vatNumber
      ? {
          country_code: record.countryCode,
          number: record.vatNumber,
          valid: record.vatValid, // null = VIES n'a pas repondu (jamais deduit d'une autre source)
          source: record.vatValidationSource, // "VIES" | "DGFIP_FALLBACK" | null
          dgfip_list_match: record.dgfipVatMatch,
          checked_at: record.vatCheckedAt,
        }
      : null,
    company:
      record.activeStatus === "not_found"
        ? { status: "not_found", siren: record.siren, siret: record.siret }
        : record.siren || record.legalName
        ? {
            legal_name: record.legalName,
            siren: record.siren,
            siret: record.siret,
            address: record.address,
            naf: record.naf,
            status: record.activeStatus,
            ...(raw
              ? {
                  created_on: raw.date_creation || null,
                  closed_on: raw.date_fermeture || null,
                  category: raw.categorie_entreprise || null,
                  legal_form_code: raw.nature_juridique || null,
                  headcount_band: raw.tranche_effectif_salarie || null,
                  open_establishments: raw.nombre_etablissements_ouverts ?? null,
                  executives: executivesFrom(raw),
                  finances: latestFinances(raw),
                  labels: labelsFrom(raw),
                }
              : {}),
          }
        : null,
    sources: record.sources,
    fetched_at: new Date().toISOString(),
  });
}

async function handleName(name, postalCode, res) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", name);
  url.searchParams.set("per_page", "5");
  if (postalCode) url.searchParams.set("code_postal", postalCode);

  let body;
  try {
    body = await cached(`company-search:${name}:${postalCode}`, 10 * 60_000, async () => {
      const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  } catch (err) {
    console.warn(`[entreprise] recherche par nom en echec : ${err.message}`);
    res.status(503).json({ error: "Official company registry temporarily unavailable, retry later (not charged)." });
    return;
  }

  const results = Array.isArray(body?.results) ? body.results : [];
  res.json({
    query: { name, postal_code: postalCode || null },
    matches: results.map(summaryFrom),
    total_found: body?.total_results ?? results.length,
    hint: "Call again with ?id=<siren> for the full verified record.",
    sources: [SEARCH_URL],
    fetched_at: new Date().toISOString(),
  });
}

export async function handler(req, res) {
  const id = String(req.query.id || "").trim();
  const name = String(req.query.name || "").trim();
  const postalCode = String(req.query.postal_code || "").trim();

  if (id) {
    if (id.length > 40) {
      res.status(400).json({ error: "Field 'id' too long." });
      return;
    }
    return handleId(id, res);
  }
  if (name) {
    if (name.length < 3 || name.length > 120) {
      res.status(400).json({ error: "Field 'name' must be 3-120 characters." });
      return;
    }
    if (postalCode && !/^\d{5}$/.test(postalCode)) {
      res.status(400).json({ error: "Invalid 'postal_code' (5 digits expected)." });
      return;
    }
    return handleName(name, postalCode, res);
  }
  res.status(400).json({ error: "Provide ?id=<EU VAT | SIREN | SIRET> or ?name=<company name>." });
}
