// server.js — demarre Express et monte le middleware x402.
//
// Endpoints charges automatiquement depuis endpoints/ : chaque fichier exporte
// { path, price, description, handler } (+ method et discovery optionnels).
// price: null => endpoint gratuit ; price: "$0.005" => protege par x402.
import { readdir } from "node:fs/promises";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createFacilitatorConfig } from "@coinbase/x402";
import config from "./config.js";

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
    description: ep.description,
    mimeType: "application/json",
    ...(ep.discovery ? { extensions: ep.discovery } : {}),
  };
}

// --- 4. Application Express ------------------------------------------------

const app = express();

if (Object.keys(paidRoutes).length > 0) {
  app.use(paymentMiddleware(paidRoutes, resourceServer));
}

for (const ep of endpoints) {
  app[ep.method.toLowerCase()](ep.path, ep.handler);
}

app.listen(config.port, () => {
  console.log(`Serveur x402 demarre sur http://localhost:${config.port}`);
  console.log(`Reseau: ${config.network} (${config.caip2Network})`);
  console.log(
    `Facilitateur: ${config.isMainnet ? "CDP (mainnet)" : config.testnetFacilitatorUrl}`
  );
  console.log(`Adresse de reception: ${config.payToAddress}`);
  for (const ep of endpoints) {
    const tag = ep.price == null ? "gratuit" : ep.price;
    console.log(`  ${ep.method} ${ep.path} [${tag}] — ${ep.description}`);
  }
});
