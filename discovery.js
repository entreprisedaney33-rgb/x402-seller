// discovery.js — construit le document de decouverte servi sur
// GET /.well-known/x402.json.
//
// Le protocole x402 (docs.x402.org/extensions/bazaar) definit la decouverte
// "Bazaar" cote FACILITATEUR : GET {facilitator}/discovery/resources, nourri
// par les metadonnees que chaque route declare via l'extension bazaar (voir
// endpoints/defi-tvl.js -> declareDiscoveryExtension, deja renvoyees telles
// quelles dans nos vraies reponses 402 PAYMENT-REQUIRED). Il n'existe PAS de
// schema officiel unique pour un fichier .well-known cote serveur.
//
// Le seul document normatif pour ce chemin est le brouillon IETF
// "Discovering x402 Payment Capability via DNS and a Well-Known URI"
// (draft-hawkins-x402-dns-discovery), qui definit :
//   - le chemin /.well-known/x402 (le suffixe .json est un alias tolere
//     par plusieurs implementations communautaires, dont awesome-x402)
//   - l'enveloppe { x402Version, kind, name, description, resources[],
//     docs, updated }
//   - kind: "facilitator" | "resource-server" | "both"
//   - resources[] minimal : { url, method, description }
//
// Ce document reprend cette enveloppe (le seul format documente pour ce
// chemin) et enrichit chaque ressource avec les MEMES champs de prix/reseau
// et de schema d'entree/sortie deja utilises ailleurs dans ce serveur
// (accepts + extensions.bazaar), plutot que d'inventer un schema tiers.
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));

// endpoints: la liste construite par server.js (path, method, price,
// description, discovery) ; config: l'export par defaut de config.js.
export function buildDiscoveryDocument(endpoints, config) {
  const resources = endpoints
    .filter((ep) => ep.price != null)
    .map((ep) => ({
      url: `${config.baseUrl}${ep.path}`,
      method: ep.method,
      description: ep.description,
      accepts: [
        {
          scheme: "exact",
          network: config.caip2Network,
          price: ep.price,
          payTo: config.payToAddress,
        },
      ],
      ...(ep.discovery ? { extensions: ep.discovery } : {}),
    }));

  return {
    x402Version: 2,
    kind: "resource-server",
    name: pkg.name,
    description: pkg.description,
    resources,
    docs: config.baseUrl,
    updated: new Date().toISOString(),
  };
}
