// scripts/lib/seed-core.js — shared dynamic-discovery seeding logic, used by
// scripts/seed-bazaar.js (CLI, manual/on-demand, --only supported, no retry)
// and scripts/seed-hebdo.js (automated weekly run, full mode, 1 retry per
// endpoint). Discovers paid endpoints from a live server's own
// GET /.well-known/x402.json (never a hardcoded endpoint list) and pays
// each one for real via @x402/fetch, using the EXAMPLES table below for how
// to call each known path (the only hardcoded part — an endpoint without
// an example is skipped, never called blind).
//
// Deliberately does NOT import ../../config.js: this module (and anything
// that only needs it) works from just a targetUrl + an already-built viem
// account, so a caller that has no use for the SELLER-side config fields
// (PAY_TO_ADDRESS, CDP keys) never has to supply them just to import this
// file. scripts/seed-bazaar.js still imports config.js itself, for its own
// CLI needs (BUYER_PRIVATE_KEY) — unchanged from before this refactor.
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";

const HEALTH_TIMEOUT_MS = 90_000;
const DISCOVERY_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 2000;

// Table d'exemples valides, indexee par CHEMIN SANS query string. C'est la
// SEULE liste codee en dur de ce module — tout le reste (quels endpoints
// existent, leur methode, leur prix) vient de .well-known/x402.json.
//   - GET  : { query: "a=b&c=d" }  (query string a coller telle quelle ;
//            omise ou vide = endpoint sans parametre)
//   - POST : { body: {...} }        (corps JSON)
export const EXAMPLES = {
  "/api/defi/tvl": { query: "protocol=aave" },
  "/api/defi/price": { query: "coins=ethereum,bitcoin" },
  "/api/defi/tvl-chain": { query: "chain=base" },
  "/api/defi/protocols": { query: "limit=3" },
  "/api/defi/yields": { query: "chain=base&min_tvl=1000000&limit=3" },
  "/api/defi/yields/top": { query: "limit=3&min_tvl=10000000" },
  "/api/defi/yields/by-token": { query: "symbol=USDC&limit=3" },
  "/api/defi/yields/by-chain": { query: "chain=base&limit=3" },
  "/api/defi/yields/pool": { query: "pool=89bc7c4c-d71c-435c-ab28-56c803d51320" },
  "/api/defi/stablecoins": { query: "limit=3" },
  "/api/search/web": { body: { query: "latest developments in the x402 protocol", num_results: 3 } },
  "/api/search/serp": { body: { query: "best crypto payment protocols 2026", country: "us" } },
  // NOT en.wikipedia.org/wiki/HTTP_402 (used elsewhere in this table, fine
  // for /api/web/read and /api/web/extract) — confirmed 2026-09-02 that
  // Tavily's Extract API specifically 404s on that exact URL right now
  // (Wikipedia itself is reachable, HTTP 200 via plain curl — this is a
  // Tavily-side crawl issue, unrelated to this server's code). x402.org is
  // simple, stable, and already confirmed working against this endpoint.
  "/api/web/scrape": { body: { url: "https://x402.org/" } },
  "/api/chain/gas": { query: "chain=base" },
  "/api/chain/block": { query: "chain=base" },
  "/api/gas/base": {},
  "/api/gas/ethereum": {},
  "/api/price/eth-usd": {},
  "/api/price/btc-usd": {},
  "/api/price/sol-usd": {},
  "/api/price/usdc-supply": {},
  "/api/fx/rates": { query: "base=EUR" },
  "/api/github/repo": { query: "full_name=expressjs/express" },
  "/api/npm/package": { query: "name=express" },
  "/api/hn/top": { query: "limit=3" },
  "/api/wiki/summary": { query: "title=Bitcoin&lang=en" },
  "/api/dns/lookup": { query: "domain=example.com" },
  "/api/rdap/domain": { query: "domain=example.com" },
  "/api/web/read": { body: { url: "https://en.wikipedia.org/wiki/HTTP_402" } },
  "/api/web/extract": {
    body: {
      url: "https://en.wikipedia.org/wiki/HTTP_402",
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          first_paragraph: { type: "string" },
        },
      },
    },
  },
  "/api/ai/summarize": {
    body: {
      text:
        "L'entreprise Nordev Solutions a annonce aujourd'hui les resultats de son troisieme trimestre, marques par une croissance de 18% du chiffre d'affaires par rapport a l'annee precedente. Cette progression s'explique principalement par l'expansion de son offre de services cloud aupres des petites et moyennes entreprises, ainsi que par l'ouverture de deux nouveaux bureaux regionaux a Lyon et Toulouse. Le directeur general, Marc Bertillon, a souligne que cette dynamique s'accompagne d'un investissement accru dans la recherche et developpement, avec un budget qui a double sur les douze derniers mois.\n\nMalgre ce contexte favorable, l'entreprise fait face a des defis importants sur le plan du recrutement. Le secteur technologique connait actuellement une penurie de profils qualifies, en particulier dans les domaines de la cybersecurite et de l'intelligence artificielle. Pour y remedier, Nordev Solutions a lance un partenariat avec trois ecoles d'ingenieurs afin de former directement les futurs talents selon ses besoins specifiques, et a egalement mis en place un programme de mobilite interne pour retenir ses employes actuels.\n\nPour le dernier trimestre de l'annee, la direction reste prudente mais optimiste. Elle table sur une poursuite de la croissance, tout en restant attentive a l'evolution du contexte economique general et aux eventuelles tensions sur les couts d'approvisionnement en materiel informatique. Un point d'etape complet sera presente lors de l'assemblee generale prevue en fevrier prochain.",
      max_sentences: 3,
    },
  },
  "/api/ai/classify": {
    body: {
      text:
        "Bonjour, je vous ecris car le produit que j'ai recu la semaine derniere presente un defaut de fabrication sur le boitier, et il ne s'allume plus depuis hier. J'aimerais savoir comment proceder pour un remboursement ou un echange, car ce n'est clairement pas normal pour un article recu il y a a peine dix jours. Merci de me repondre rapidement. Cordialement, Sophie Marchand.",
      labels: ["devis", "reclamation", "autre"],
    },
  },
  "/api/ai/translate": {
    body: {
      text: "Notre equipe technique a corrige le probleme et le service devrait fonctionner normalement d'ici la fin de la journee.",
      target_lang: "English",
    },
  },
  "/api/ai/extract": {
    body: {
      text:
        "Facture etablie par la SARL Menuiserie Dubreuil, 14 rue des Artisans, 69003 Lyon, le 12 aout 2026. Prestation : fabrication et pose d'une porte d'entree sur mesure en chene massif, y compris ferrures et finitions. Montant total HT : 2 150,00 euros. TVA a 20% : 430,00 euros. Montant total TTC a regler : 2 580,00 euros, payable a 30 jours a compter de la reception de la facture.",
      schema: {
        type: "object",
        properties: {
          fournisseur: { type: "string", description: "Nom de l'entreprise qui emet la facture" },
          montant_ttc: { type: "number", description: "Montant total TTC en euros, sans le symbole" },
          date: { type: "string", description: "Date de la facture au format AAAA-MM-JJ" },
        },
      },
    },
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// wakeServer(targetUrl) -> { ms, status } — GET /health, throws on failure
// (non-2xx or unreachable), caller decides what to do with that.
export async function wakeServer(targetUrl) {
  const start = Date.now();
  let response;
  try {
    response = await fetch(`${targetUrl}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
  } catch (err) {
    const ms = Date.now() - start;
    throw new Error(`/health injoignable apres ${(ms / 1000).toFixed(1)}s : ${err?.message || err}`);
  }
  const ms = Date.now() - start;
  if (!response.ok) {
    throw new Error(`/health a repondu HTTP ${response.status} apres ${(ms / 1000).toFixed(1)}s.`);
  }
  return { ms, status: response.status };
}

// discoverEndpoints(targetUrl) -> [{path, method, price}] — reads
// GET /.well-known/x402.json, throws on failure. Never returns free
// endpoints: that document only ever lists paid resources (see
// discovery.js's buildDiscoveryDocument, which filters on price != null).
export async function discoverEndpoints(targetUrl) {
  let response;
  try {
    response = await fetch(`${targetUrl}/.well-known/x402.json`, { signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) });
  } catch (err) {
    throw new Error(`.well-known/x402.json injoignable ou illisible : ${err?.message || err}`);
  }
  if (!response.ok) {
    throw new Error(`.well-known/x402.json a repondu HTTP ${response.status}.`);
  }
  const doc = await response.json();
  const resources = Array.isArray(doc.resources) ? doc.resources : [];
  return resources.map((r) => {
    const url = new URL(r.url);
    const priceRaw = r.accepts?.[0]?.price;
    return {
      path: url.pathname,
      method: (r.method || "GET").toUpperCase(),
      price: typeof priceRaw === "string" ? Number(priceRaw.replace(/^\$/, "")) : Number(priceRaw) || 0,
    };
  });
}

// callOnce(targetUrl, fetchWithPayment, ep) -> { httpStatus, hash, paid, error }
async function callOnce(targetUrl, fetchWithPayment, ep) {
  const url = ep.query ? `${targetUrl}${ep.path}?${ep.query}` : `${targetUrl}${ep.path}`;
  const fetchOptions = { method: ep.method };
  if (ep.body) {
    fetchOptions.body = JSON.stringify(ep.body);
    fetchOptions.headers = { "Content-Type": "application/json" };
  }

  try {
    const response = await fetchWithPayment(url, fetchOptions);
    const httpStatus = response.status;
    const paymentHeader = response.headers.get("PAYMENT-RESPONSE");
    if (!paymentHeader) return { httpStatus, hash: null, paid: false, error: null };
    const receipt = decodePaymentResponseHeader(paymentHeader);
    if (!receipt?.success) return { httpStatus, hash: null, paid: false, error: null };
    return { httpStatus, hash: receipt.transaction || null, paid: true, error: null };
  } catch (err) {
    return { httpStatus: "ERREUR", hash: null, paid: false, error: err?.message || String(err) };
  }
}

// runSeed({ targetUrl, account, only, pauseMs, retryOnFail, onStart, onResult })
//   -> { discoveredCount, skippedNoExample, skippedNotFound, results, totalSpent }
//
// only          : Set<string> of exact paths to restrict to, or null/undefined
//                 for every discovered paid endpoint (full mode).
// retryOnFail   : if true, a failed endpoint (paid === false, for any reason —
//                 non-2xx, unreachable, or a settled-but-unsuccessful receipt)
//                 is retried exactly ONCE more, after a short pause. Default
//                 false (matches the original seed-bazaar.js behavior).
// onStart(i, total, ep)              : optional, called right before each call.
// onResult(i, total, ep, result)     : optional, called right after each call
//                                       resolves (result = the pushed result
//                                       object, see below), before the
//                                       inter-call pause.
// onDiscovered({discoveredCount, skippedNoExample, skippedNotFound, toCallCount})
//   : optional, called once right after discovery+filtering, before the
//     payment loop starts — lets a caller print a discovery summary at the
//     right point in time instead of only after every call has resolved.
export async function runSeed({
  targetUrl,
  account,
  only = null,
  pauseMs = 2000,
  retryOnFail = false,
  onStart,
  onResult,
  onDiscovered,
}) {
  const discovered = await discoverEndpoints(targetUrl);

  let toSeed = discovered;
  const skippedNotFound = [];
  if (only) {
    const foundPaths = new Set(discovered.map((e) => e.path));
    for (const wanted of only) {
      if (!foundPaths.has(wanted)) skippedNotFound.push(wanted);
    }
    toSeed = discovered.filter((e) => only.has(e.path));
  }

  const skippedNoExample = [];
  const withExamples = [];
  for (const ep of toSeed) {
    const example = EXAMPLES[ep.path];
    if (!example) {
      skippedNoExample.push(`${ep.method} ${ep.path}`);
      continue;
    }
    withExamples.push({ ...ep, ...example });
  }

  onDiscovered?.({
    discoveredCount: discovered.length,
    skippedNoExample,
    skippedNotFound,
    toCallCount: withExamples.length,
  });

  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: "eip155:*", client: new ExactEvmScheme(account) }],
  });

  const results = [];
  let totalSpent = 0;

  for (let i = 0; i < withExamples.length; i++) {
    const ep = withExamples[i];
    onStart?.(i, withExamples.length, ep);

    const maxAttempts = retryOnFail ? 2 : 1;
    let attempt = 0;
    let outcome = { httpStatus: null, hash: null, paid: false, error: null };
    let retried = false;

    while (attempt < maxAttempts) {
      attempt++;
      outcome = await callOnce(targetUrl, fetchWithPayment, ep);
      if (outcome.paid || attempt >= maxAttempts) break;
      retried = true;
      await sleep(RETRY_DELAY_MS);
    }

    if (outcome.paid) totalSpent += ep.price;

    const result = {
      endpoint: `${ep.method} ${ep.path}`,
      method: ep.method,
      path: ep.path,
      httpStatus: outcome.httpStatus,
      hash: outcome.hash,
      paid: outcome.paid,
      price: ep.price,
      error: outcome.error,
      retried,
    };
    results.push(result);
    onResult?.(i, withExamples.length, ep, result);

    if (i < withExamples.length - 1) await sleep(pauseMs);
  }

  return {
    discoveredCount: discovered.length,
    skippedNoExample,
    skippedNotFound,
    results,
    totalSpent,
  };
}
