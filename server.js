// server.js — demarre Express et monte le middleware x402.
//
// Endpoints charges automatiquement depuis endpoints/ : chaque fichier exporte
// { path, price, description, handler } (+ method et discovery optionnels).
// price: null => endpoint gratuit ; price: "$0.005" => protege par x402.
import { readdir } from "node:fs/promises";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createFacilitatorConfig } from "@coinbase/x402";
import config from "./config.js";
import { buildDiscoveryDocument } from "./discovery.js";
import { buildOpenApiDocument } from "./openapi.js";
import { logPaiementReussi } from "./payment-log.js";
import { logSondage } from "./sondage-log.js";
import { logEchecSettlement } from "./echecs-log.js";
import { computeDailyStats } from "./lib/stats-daily.js";
import { computeProbesStats } from "./lib/stats-probes.js";
import { computeEchecsStats } from "./lib/stats-echecs.js";
import { computeApifyStats, computeApifyStatsPublic } from "./lib/stats-apify.js";
import { safeHandler } from "./lib/http.js";

// --- 1. Chargement automatique des endpoints -------------------------------

async function loadEndpoints() {
  const dirUrl = new URL("./endpoints/", import.meta.url);
  const files = (await readdir(dirUrl)).filter((f) => f.endsWith(".js")).sort();

  const endpoints = [];
  for (const file of files) {
    const mod = await import(new URL(file, dirUrl));
    const ep = mod.default ?? mod;
    if (!ep.path || typeof ep.handler !== "function") {
      throw new Error(`endpoints/${file}: exports { path, handler } requis.`);
    }
    endpoints.push({
      file,
      path: ep.path,
      method: (ep.method || "GET").toUpperCase(),
      price: ep.price ?? null,
      description: ep.description || "",
      discovery: ep.discovery,
      handler: ep.handler,
    });
  }
  return endpoints;
}

const endpoints = await loadEndpoints();

// --- 2. Facilitateur x402 --------------------------------------------------
// base-sepolia : facilitateur public de test, sans cle.
// base (prod)  : facilitateur CDP, authentifie par CDP_API_KEY_ID/SECRET.

const facilitatorConfig = config.isMainnet
  ? createFacilitatorConfig(config.cdpApiKeyId, config.cdpApiKeySecret)
  : { url: config.testnetFacilitatorUrl };

const facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig);

const resourceServer = new x402ResourceServer(facilitatorClient).register(
  config.caip2Network,
  new ExactEvmScheme()
);

// Journal des paiements reussis (logs/paiements.jsonl) — voir payment-log.js.
// ctx.transportContext.request.path est le chemin HTTP reellement appele
// (voir @x402/core, x402HTTPResourceServer.process : transportContext =
// { request: enrichedContext }, enrichedContext porte path/method).
//
// Echec de reglement (ctx.result.success === false) : x402 a bien VERIFIE
// le paiement mais le SETTLE cote facilitateur a echoue (fonds
// insuffisants au moment du reglement, nonce deja consomme, etc.) — jusque
// la, silencieusement ignore (aucune ligne nulle part). Journalise
// desormais dans logs/echecs.jsonl (voir echecs-log.js), type
// "settlement_failed" : jamais la cle/signature complete, seulement le
// motif fourni par le SDK (ctx.result.errorReason/errorMessage — types
// verifies dans node_modules/@x402/core, SettleResponseCoreSnapshot),
// l'adresse payeuse (deja publique) et le User-Agent (via
// ctx.transportContext.request.adapter.getUserAgent(), meme adaptateur
// HTTP que celui qui alimente deja ce hook).
resourceServer.onAfterSettle(async (ctx) => {
  const endpointPath = ctx.transportContext?.request?.path || ctx.paymentPayload?.resource?.url || null;
  const method = ctx.transportContext?.request?.method || null;

  if (!ctx.result?.success) {
    const userAgent = ctx.transportContext?.request?.adapter?.getUserAgent?.() || null;
    const motif = [ctx.result?.errorReason, ctx.result?.errorMessage].filter(Boolean).join(": ") || "unknown";
    await logEchecSettlement({
      endpoint: endpointPath,
      method,
      motif,
      payer: ctx.result?.payer || null,
      userAgent,
    });
    return;
  }

  const matchedEndpoint = endpoints.find((ep) => ep.path === endpointPath);

  // adapter.req is the raw Express request (see node_modules/@x402/express's
  // ExpressAdapter: `constructor(req) { this.req = req; }`) — same object
  // trust-proxy-aware .ip that sondage-log.js's caller already reads
  // (app.set("trust proxy", 1) above). Truncated by payment-log.js itself
  // (imports the exact same truncateIp as sondage-log.js), never the raw
  // address, before it ever touches the log file.
  const adapter = ctx.transportContext?.request?.adapter;

  await logPaiementReussi({
    endpoint: endpointPath,
    payer: ctx.result.payer || null,
    // Le prix declare pour la route est EXACTEMENT ce que le schema "exact"
    // fait payer (pas de negociation) — plus lisible qu'un montant atomique.
    montant: matchedEndpoint?.price || null,
    hash: ctx.result.transaction || null,
    ip: adapter?.req?.ip || null,
    userAgent: adapter?.getUserAgent?.() || null,
  });
});

// --- 3. Routes payantes pour le middleware ---------------------------------

const paidRoutes = {};
for (const ep of endpoints) {
  if (ep.price == null) continue;
  paidRoutes[`${ep.method} ${ep.path}`] = {
    accepts: {
      scheme: "exact",
      price: ep.price,
      network: config.caip2Network,
      payTo: config.payToAddress,
    },
    // Force l'URL de ressource annoncee (402, Bazaar) sur BASE_URL, jamais
    // deduite de l'hote de la requete entrante (jamais localhost en prod).
    resource: `${config.baseUrl}${ep.path}`,
    description: ep.description,
    mimeType: "application/json",
    ...(ep.discovery ? { extensions: ep.discovery } : {}),
  };
}

// --- 4. Application Express ------------------------------------------------

const app = express();

// Derriere le reverse proxy de Render, fait confiance au 1er X-Forwarded-For
// pour que req.ip refere le vrai client (indispensable pour le rate-limit
// par IP et pour un req.protocol/hostname corrects).
app.set("trust proxy", 1);

// Parse le corps JSON des requetes POST (endpoints /api/ai/*). N'affecte
// pas les routes GET (pas de corps a parser).
app.use(express.json({ limit: "1mb" }));

// Rate-limit simple par IP sur les routes payantes (/api/*) : 60 req/min.
const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Trop de requetes, reessaie dans une minute." },
});
app.use("/api", apiLimiter);

// Logs every 402 Payment Required response actually served (a "probe" — an
// agent discovering/testing an endpoint without paying yet), in addition to
// (never instead of) the successful-payment log above — see sondage-log.js
// and GET /stats. Wraps res.end() BEFORE paymentMiddleware runs so it can
// observe the final status code paymentMiddleware sets, whichever route
// eventually sends the response.
app.use("/api", (req, res, next) => {
  // req.path is relative to the "/api" mount point here (Express sub-router
  // rule) — req.baseUrl restores the "/api" prefix so the logged endpoint
  // matches what paymentMiddleware/payment-log.js record (e.g. "/api/defi/price").
  const endpointPath = req.baseUrl + req.path;
  const originalEnd = res.end;
  res.end = function wrappedEnd(...args) {
    if (res.statusCode === 402) {
      logSondage({ endpoint: endpointPath, ip: req.ip, userAgent: req.get("user-agent") }).catch(() => {});
    }
    return originalEnd.apply(res, args);
  };
  next();
});

if (Object.keys(paidRoutes).length > 0) {
  app.use(paymentMiddleware(paidRoutes, resourceServer));
}

// safeHandler enrobe CHAQUE endpoint (existant et nouveau) : garantit
// qu'aucune erreur non prevue ne remonte en 500 brut (page HTML par defaut
// d'Express) — toujours un JSON propre. Voir lib/http.js.
for (const ep of endpoints) {
  app[ep.method.toLowerCase()](ep.path, safeHandler(ep.handler));
}

// Document de decouverte pour les agents (voir discovery.js pour le detail
// du format et ses sources documentees).
app.get("/.well-known/x402.json", (req, res) => {
  res.json(buildDiscoveryDocument(endpoints, config));
});

// Document OpenAPI-first ("recommended" discovery path for x402scan and
// others) — voir openapi.js pour le detail du format et ses sources.
app.get("/openapi.json", (req, res) => {
  res.json(buildOpenApiDocument(endpoints, config));
});

// Favicon minimal (un simple "$" sur cercle plein) — sert uniquement a
// satisfaire les audits de decouverte (ex. @agentcash/discovery, utilise
// par x402scan) qui verifient /favicon.svg par un HEAD puis un GET avec
// Content-Type image/*. Aucune dependance, cree pour ce projet.
const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<circle cx="16" cy="16" r="16" fill="#0F172A"/>' +
  '<text x="16" y="22" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" ' +
  'font-size="18" font-weight="bold" fill="#22D3A8">$</text>' +
  "</svg>";
app.get("/favicon.svg", (req, res) => {
  res.set("Cache-Control", "public, max-age=86400").type("image/svg+xml").send(FAVICON_SVG);
});

// GET /stats/daily?key=<STATS_KEY> — protected admin/reporting route, NOT
// loaded from endpoints/ on purpose: it must never be published in
// .well-known/x402.json or /openapi.json (unlike GET /stats, which is free
// and anonymized, this one surfaces revenue and payer addresses). 401
// without the exact key; an empty/unset STATS_KEY always denies (never
// treated as "no key required").
app.get(
  "/stats/daily",
  safeHandler(async (req, res) => {
    if (!config.statsKey || req.query.key !== config.statsKey) {
      res.status(401).json({ error: "Missing or invalid 'key' query parameter." });
      return;
    }
    res.json(await computeDailyStats());
  })
);

// GET /stats/probes?key=<STATS_KEY> — same gate/route pattern as
// /stats/daily above (protected, never in .well-known/x402.json or
// /openapi.json). Unlike /stats/daily's top_user_agents (capped at 10),
// this exposes the FULL untruncated long tail by User-Agent and by
// truncated IP — see lib/stats-probes.js.
app.get(
  "/stats/probes",
  safeHandler(async (req, res) => {
    if (!config.statsKey || req.query.key !== config.statsKey) {
      res.status(401).json({ error: "Missing or invalid 'key' query parameter." });
      return;
    }
    res.json(await computeProbesStats());
  })
);

// GET /stats/echecs?key=<STATS_KEY> — same gate/route pattern as
// /stats/daily above. Surfaces logs/echecs.jsonl (settlement_failed +
// upstream_error, see echecs-log.js) — the observability gap this was
// built to close.
app.get(
  "/stats/echecs",
  safeHandler(async (req, res) => {
    if (!config.statsKey || req.query.key !== config.statsKey) {
      res.status(401).json({ error: "Missing or invalid 'key' query parameter." });
      return;
    }
    res.json(await computeEchecsStats());
  })
);

// GET /stats/apify?key=<STATS_KEY> — same gate/route pattern as
// /stats/daily above (protected, never in .well-known/x402.json or
// /openapi.json). Estimated USD revenue from Mathéo's own Apify Actors
// monetized via pay-per-event — entirely separate from and unrelated to
// this server's own x402 revenue above. See lib/stats-apify.js's file
// header for exactly why every figure here is an ESTIMATE (no Apify API
// gives an audited dollar amount), cached >=15min in DATA_DIR (survives
// restarts, like the payment/sondage/echecs logs) so this route never
// hits the Apify API on every tile refresh. Never a 500 on Apify being
// unreachable — falls back to the last cached value with an honest
// `freshness` flag instead (see computeApifyStats).
app.get(
  "/stats/apify",
  safeHandler(async (req, res) => {
    if (!config.statsKey || req.query.key !== config.statsKey) {
      res.status(401).json({ error: "Missing or invalid 'key' query parameter." });
      return;
    }
    res.json(await computeApifyStats());
  })
);

// Rate-limit for GET /stats/apify/public below: same express-rate-limit library
// and simple windowMs/limit style already used for apiLimiter above (nothing
// reinvented) — a dedicated, smaller instance because this route serves a
// different surface (free, no key, meant for a dashboard tile refresh, not the
// paid /api/* traffic apiLimiter is sized for). Its real job is defense in
// depth: computeApifyStatsPublic() -> computeApifyStats() already means a
// request storm here can trigger AT MOST one real Apify API call per 15-minute
// cache window (see lib/stats-apify.js's in-flight de-dupe) regardless of this
// limiter, so this mainly bounds wasted CPU/bandwidth on cache-hit responses,
// not Apify usage.
const apifyPublicLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Trop de requetes, reessaie dans une minute." },
});

// GET /stats/apify/public — free, key-less, scrubbed mirror of GET /stats/apify
// above, for a static site's client-side JS (the Jarvis PWA's "Crypto x402"
// panel) that cannot hold STATS_KEY. Same arbitration as GET /stats vs
// /stats/daily: this route only ever aggregates (revenue totals, run counts,
// per-Actor name/price/margin/runs/revenue — see lib/stats-apify.js's
// PUBLIC_TOP_LEVEL_FIELDS/PUBLIC_ACTOR_FIELDS allow-lists for the exact field
// list and what's dropped, notably the Apify actor id and any internal error
// detail). Reuses computeApifyStats()'s cache and in-flight de-dupe entirely —
// computeApifyStatsPublic() never calls the Apify API itself, only reshapes
// whatever computeApifyStats() already produced (see that file).
app.get(
  "/stats/apify/public",
  apifyPublicLimiter,
  safeHandler(async (req, res) => {
    // CORS open for this route ONLY, same single-route pattern as GET /stats
    // (endpoints/stats.js) — never a blanket app-wide cors().
    res.set("Access-Control-Allow-Origin", "*");
    res.json(await computeApifyStatsPublic());
  })
);

app.listen(config.port, "0.0.0.0", () => {
  console.log(`Serveur x402 demarre sur http://0.0.0.0:${config.port}`);
  console.log(`URL publique annoncee aux agents: ${config.baseUrl}`);
  if (config.baseUrl.includes("localhost")) {
    console.warn(
      "ATTENTION: BASE_URL n'est pas defini (repli sur localhost) — " +
        "a corriger avant tout deploiement reel."
    );
  }
  console.log(`Reseau: ${config.network} (${config.caip2Network})`);
  console.log(
    `Facilitateur: ${config.isMainnet ? "CDP (mainnet)" : config.testnetFacilitatorUrl}`
  );
  console.log(`Adresse de reception: ${config.payToAddress}`);
  for (const ep of endpoints) {
    const tag = ep.price == null ? "gratuit" : ep.price;
    console.log(`  ${ep.method} ${ep.path} [${tag}] — ${ep.description}`);
  }
  console.log(`  GET /.well-known/x402.json [gratuit] — decouverte pour agents.`);
  console.log(`  GET /openapi.json [gratuit] — decouverte OpenAPI-first (x402scan et al.).`);
});
