// lib/http.js — fetch JSON/texte avec timeout et erreurs normalisees, pour
// tous les endpoints qui appellent une source externe.
//
// UpstreamError porte un statut HTTP pret a renvoyer au client : ne fuit
// jamais la pile d'erreur brute d'une source externe. `upstreamStatus`
// (optionnel, distinct de `status`) porte le VRAI code HTTP renvoye par la
// source externe quand on l'a reellement recu — jamais expose au client
// (le `status`/message publics restent inchanges), utilise uniquement pour
// le journal interne logs/echecs.jsonl (voir safeHandler plus bas). Reste
// `null` quand aucune reponse n'a ete recue (reseau/timeout) : un null
// honnete plutot qu'un code invente.
import config from "../config.js";
import { logEchecUpstream } from "../echecs-log.js";

export class UpstreamError extends Error {
  constructor(message, { status = 502, upstreamStatus = null } = {}) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.upstreamStatus = upstreamStatus;
  }
}

// Certaines sources (rdap.org derriere Cloudflare, Wikimedia) bloquent ou
// deconseillent les requetes sans User-Agent descriptif — envoye par
// defaut sur TOUS les appels sortants (constate en test reel sur RDAP :
// 403 sans UA, 200 avec).
function defaultHeaders() {
  return { "User-Agent": `x402-seller/1.0 (+${config.baseUrl})` };
}

async function doFetch(url, { timeoutMs = 10_000, headers, ...opts } = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...opts,
      headers: { ...defaultHeaders(), ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    throw new UpstreamError(
      timedOut
        ? `Source unreachable (timed out after ${timeoutMs / 1000}s).`
        : `Source unreachable: ${err.message}`,
      { status: 502 }
    );
  }
  if (!res.ok) {
    throw new UpstreamError(`Source responded with HTTP ${res.status}.`, {
      status: res.status === 404 ? 404 : 502,
      upstreamStatus: res.status,
    });
  }
  return res;
}

export async function fetchJson(url, opts) {
  const res = await doFetch(url, opts);
  try {
    return await res.json();
  } catch {
    throw new UpstreamError("Source response unreadable (invalid JSON).", { status: 502 });
  }
}

export async function fetchText(url, opts) {
  const res = await doFetch(url, opts);
  return res.text();
}

// Association endpoint -> vrai fournisseur amont, UNIQUEMENT pour le champ
// "provider" du journal logs/echecs.jsonl (aucun effet sur la reponse
// client). Construite en verifiant le vrai domaine appele par chaque
// fichier endpoints/*.js (jamais devinee) — /api/price/* et /api/defi/*
// appellent tous des sous-domaines *.llama.fi (DefiLlama). Repli : le
// chemin de l'endpoint lui-meme si non liste ci-dessous (reste
// exploitable). Note : les 4 endpoints /api/ai/* et /api/dns/lookup
// gerent leur propre erreur en interne (jamais un UpstreamError qui
// atteint safeHandler) — absents ici par construction, pas par oubli.
const PROVIDER_PAR_PREFIXE = [
  ["/api/search/web", "tavily"],
  ["/api/web/scrape", "tavily"],
  ["/api/search/serp", "serper"],
  ["/api/defi/", "defillama"],
  ["/api/price/", "defillama"],
  ["/api/chain/", "rpc"],
  ["/api/gas/", "rpc"],
  ["/api/github/", "github"],
  ["/api/npm/", "npm"],
  ["/api/hn/", "hackernews"],
  ["/api/wiki/", "wikipedia"],
  ["/api/fx/", "frankfurter"],
  ["/api/rdap/", "rdap"],
  ["/api/web/read", "web-fetch"],
];

function providerPourEndpoint(endpointPath) {
  if (!endpointPath) return "unknown";
  const hit = PROVIDER_PAR_PREFIXE.find(([prefix]) => endpointPath.startsWith(prefix));
  return hit ? hit[1] : endpointPath;
}

// safeHandler(fn) : enrobe un handler Express pour garantir qu'aucune
// erreur ne remonte en 500 brut (page HTML par defaut d'Express) — toujours
// un JSON propre, avec le bon code 4xx/5xx. Journalise aussi chaque
// UpstreamError dans logs/echecs.jsonl (type "upstream_error") pour combler
// le trou d'observabilite — en tache de fond (jamais attendu), pour ne
// jamais retarder ni casser la reponse deja prete a partir.
export function safeHandler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof UpstreamError) {
        logEchecUpstream({
          endpoint: req.path,
          provider: providerPourEndpoint(req.path),
          httpStatus: err.upstreamStatus,
          message: err.message,
        }).catch(() => {});
        res.status(err.status).json({ error: err.message });
        return;
      }
      console.error("Internal endpoint error:", err);
      res.status(500).json({ error: "Internal error, try again in a moment." });
    }
  };
}
