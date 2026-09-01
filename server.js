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
import { logPaiementReussi } from "./payment-log.js";

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
resourceServer.onAfterSettle(async (ctx) => {
  if (!ctx.result?.success) return;

  const endpointPath = ctx.transportContext?.request?.path || ctx.paymentPayload?.resource?.url || null;
  const matchedEndpoint = endpoints.find((ep) => ep.path === endpointPath);

  await logPaiementReussi({
    endpoint: endpointPath,
    payer: ctx.result.payer || null,
    // Le prix declare pour la route est EXACTEMENT ce que le schema "exact"
    // fait payer (pas de negociation) — plus lisible qu'un montant atomique.
    montant: matchedEndpoint?.price || null,
    hash: ctx.result.transaction || null,
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

// Rate-limit simple par IP sur les routes payantes (/api/*) : 60 req/min.
const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Trop de requetes, reessaie dans une minute." },
});
app.use("/api", apiLimiter);

if (Object.keys(paidRoutes).length > 0) {
  app.use(paymentMiddleware(paidRoutes, resourceServer));
}

for (const ep of endpoints) {
  app[ep.method.toLowerCase()](ep.path, ep.handler);
}

// Document de decouverte pour les agents (voir discovery.js pour le detail
// du format et ses sources documentees).
app.get("/.well-known/x402.json", (req, res) => {
  res.json(buildDiscoveryDocument(endpoints, config));
});

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
});
