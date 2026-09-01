// lib/http.js — fetch JSON/texte avec timeout et erreurs normalisees, pour
// tous les endpoints qui appellent une source externe.
//
// UpstreamError porte un statut HTTP pret a renvoyer au client : ne fuit
// jamais la pile d'erreur brute d'une source externe.
import config from "../config.js";

export class UpstreamError extends Error {
  constructor(message, { status = 502 } = {}) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
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
        ? `Source injoignable (delai depasse apres ${timeoutMs / 1000}s).`
        : `Source injoignable : ${err.message}`,
      { status: 502 }
    );
  }
  if (!res.ok) {
    throw new UpstreamError(`La source a repondu HTTP ${res.status}.`, {
      status: res.status === 404 ? 404 : 502,
    });
  }
  return res;
}

export async function fetchJson(url, opts) {
  const res = await doFetch(url, opts);
  try {
    return await res.json();
  } catch {
    throw new UpstreamError("Reponse de la source illisible (JSON invalide).", { status: 502 });
  }
}

export async function fetchText(url, opts) {
  const res = await doFetch(url, opts);
  return res.text();
}

// safeHandler(fn) : enrobe un handler Express pour garantir qu'aucune
// erreur ne remonte en 500 brut (page HTML par defaut d'Express) — toujours
// un JSON propre, avec le bon code 4xx/5xx.
export function safeHandler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof UpstreamError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      console.error("Erreur interne endpoint:", err);
      res.status(500).json({ error: "Erreur interne, reessaie dans un instant." });
    }
  };
}
