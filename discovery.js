// discovery.js — builds the discovery document served at
// GET /.well-known/x402.json.
//
// The x402 protocol (docs.x402.org/extensions/bazaar) defines "Bazaar"
// discovery on the FACILITATOR side: GET {facilitator}/discovery/resources,
// fed by the metadata each route declares via the bazaar extension (see
// endpoints/defi-tvl.js -> declareDiscoveryExtension, already returned as-is
// in our real 402 PAYMENT-REQUIRED responses). There is NO single official
// schema for a server-side .well-known file.
//
// The only normative document for this path is the IETF draft
// "Discovering x402 Payment Capability via DNS and a Well-Known URI"
// (draft-hawkins-x402-dns-discovery), which defines:
//   - the path /.well-known/x402 (the .json suffix is an alias tolerated
//     by several community implementations, including awesome-x402)
//   - the envelope { x402Version, kind, name, description, resources[],
//     docs, updated }
//   - kind: "facilitator" | "resource-server" | "both"
//   - a minimal resources[] entry: { url, method, description }
//
// This document follows that envelope (the only documented format for this
// path) and enriches each resource with the SAME price/network and
// input/output schema fields already used elsewhere in this server
// (accepts + extensions.bazaar), rather than inventing a third schema.
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));

// endpoints: the list built by server.js (path, method, price, description,
// discovery); config: config.js's default export.
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
