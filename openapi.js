// openapi.js — builds the OpenAPI document served on GET /openapi.json.
//
// This is the "OpenAPI-first" discovery path several x402 directories now
// prefer over the legacy /.well-known/x402(.json) fan-out — notably
// x402scan (github.com/Merit-Systems/x402scan, docs/DISCOVERY.md): its
// discovery engine (@agentcash/discovery, pinned at 1.7.5 in x402scan's own
// package.json — verified against the published package) tries
// `${origin}/openapi.json` FIRST and, as of that pinned version, no longer
// parses `/.well-known/x402` at all (only flags it as a legacy/info notice)
// — so this file is what actually makes automated "Add Server" / fan-out
// registration work today, on x402scan and elsewhere. It does NOT replace
// GET /.well-known/x402.json (discovery.js), which stays as-is for anything
// still reading that format.
//
// Required top-level fields per x402scan's spec: openapi, info.title,
// info.version, paths. Per PAID operation: a declared `402` response,
// `x-payment-info.protocols` (["x402"]), and `x-payment-info.price`
// ({mode:"fixed", currency:"USD", amount:"<dollars, no $>"}) — see
// docs/DISCOVERY.md in that repo for the exact shape (fetched and
// cross-checked against the live x402scan.com API before writing this).
//
// Per-endpoint parameters/request bodies are derived from the SAME Bazaar
// discovery metadata each endpoint already declares (declareDiscoveryExtension,
// @x402/extensions/bazaar) — not a second, hand-maintained schema. Its
// wrapped shape (bazaar.schema.properties.input.properties.queryParams|body)
// was inspected directly against the installed package before writing the
// extraction below.
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));

const SUMMARY_MAX_CHARS = 120;

function firstSentence(text) {
  const match = /^.*?[.!?](?=\s|$)/.exec(text || "");
  const sentence = (match ? match[0] : text || "").trim();
  if (sentence.length <= SUMMARY_MAX_CHARS) return sentence;
  // Truncate at a word boundary rather than mid-word.
  const cut = sentence.slice(0, SUMMARY_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : SUMMARY_MAX_CHARS)}…`;
}

function toOperationId(method, path) {
  const parts = path.split("/").filter(Boolean).map((p) => p.replace(/[^a-zA-Z0-9]/g, ""));
  const camel = parts.map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1))).join("");
  return `${method.toLowerCase()}${camel[0].toUpperCase()}${camel.slice(1)}`;
}

function inputSchemaFor(ep) {
  return ep.discovery?.bazaar?.schema?.properties?.input;
}

function outputExampleFor(ep) {
  return ep.discovery?.bazaar?.info?.output?.example;
}

function buildParameters(inputSchema) {
  const queryParams = inputSchema?.properties?.queryParams;
  if (!queryParams?.properties) return undefined;
  const required = new Set(queryParams.required || []);
  const parameters = Object.entries(queryParams.properties).map(([name, schema]) => ({
    name,
    in: "query",
    required: required.has(name),
    schema: { type: schema.type, ...(schema.enum ? { enum: schema.enum } : {}) },
    ...(schema.description ? { description: schema.description } : {}),
  }));
  return parameters.length > 0 ? parameters : undefined;
}

function buildRequestBody(inputSchema) {
  const body = inputSchema?.properties?.body;
  if (!body) return undefined;
  return {
    required: true,
    content: {
      "application/json": {
        schema: { type: "object", properties: body.properties || {}, required: body.required || [] },
      },
    },
  };
}

function buildOperation(ep) {
  const inputSchema = inputSchemaFor(ep);
  const outputExample = outputExampleFor(ep);
  const isPaid = ep.price != null;

  const operation = {
    operationId: toOperationId(ep.method, ep.path),
    summary: firstSentence(ep.description),
    description: ep.description,
    responses: {
      200: {
        description: "Successful response",
        content: {
          "application/json": {
            schema: outputExample ? { type: "object", example: outputExample } : { type: "object" },
          },
        },
      },
    },
  };

  if (ep.method === "GET") {
    const parameters = buildParameters(inputSchema);
    if (parameters) operation.parameters = parameters;
  } else {
    const requestBody = buildRequestBody(inputSchema);
    if (requestBody) operation.requestBody = requestBody;
  }

  if (isPaid) {
    operation.responses[402] = { description: "Payment required (x402)." };
    operation["x-payment-info"] = {
      // Per @agentcash/discovery's PaymentProtocolSchema (verified against
      // the exact version x402scan pins, 1.7.5): each entry must be a
      // record keyed by protocol name (e.g. {x402: {}}), NOT a plain
      // string — a bare "x402" string silently fails PaymentInfoSchema and
      // falls through to legacy-format parsing, which this object shape
      // doesn't match either, so price/protocols would be reported missing.
      protocols: [{ x402: {} }],
      price: { mode: "fixed", currency: "USD", amount: ep.price.replace(/^\$/, "") },
    };
  } else {
    // Explicitly marks free endpoints (/health, /stats) as public — without
    // this, @agentcash/discovery's auditor can't distinguish "no auth
    // declared" from "actually open", and flags it (L2/L3_AUTH_MODE_MISSING).
    operation.security = [];
  }

  return operation;
}

// Short zero-hop context for agents (info.x-guidance) — kept well under the
// ~4000-char budget @agentcash/discovery flags as too long for reliable
// injection (see docs/DISCOVERY.md, L4 checks, in Merit-Systems/x402scan).
function buildGuidance(config) {
  return (
    `${config.baseUrl} sells small, single-purpose API endpoints over x402 (USDC on Base). ` +
    "Every call under /api/* returns 402 Payment Required first; pay with an x402-aware client " +
    "(e.g. @x402/fetch's wrapFetchWithPaymentFromConfig) and replay the request.\n\n" +
    "Endpoint families:\n" +
    "- /api/price/{eth,btc,sol}-usd, /api/price/usdc-supply, /api/gas/{base,ethereum} — single-purpose crypto price/gas lookups, no parameters.\n" +
    "- /api/defi/{price,tvl,tvl-chain,protocols,yields,stablecoins} — DeFi market data (DefiLlama), parameterized.\n" +
    "- /api/chain/{gas,block} — live on-chain reads via public RPC (viem), ?chain=base|ethereum.\n" +
    "- /api/web/{read,extract} (POST) — fetch any public URL as clean Markdown, or extract structured JSON from it per a JSON Schema you supply.\n" +
    "- /api/{fx/rates,github/repo,npm/package,hn/top,wiki/summary,dns/lookup,rdap/domain} — open public data lookups.\n" +
    "- /api/ai/{summarize,classify,translate,extract} (POST) — Claude Haiku 4.5 text tasks.\n\n" +
    "GET /health and GET /stats are free and require no payment."
  );
}

// endpoints: the list built by server.js (path, method, price, description,
// discovery); config: config.js's default export.
export function buildOpenApiDocument(endpoints, config) {
  const paths = {};
  for (const ep of endpoints) {
    paths[ep.path] = paths[ep.path] || {};
    paths[ep.path][ep.method.toLowerCase()] = buildOperation(ep);
  }

  return {
    openapi: "3.1.0",
    info: {
      title: pkg.name,
      version: pkg.version,
      description: pkg.description,
      contact: { url: config.baseUrl },
      "x-guidance": buildGuidance(config),
    },
    servers: [{ url: config.baseUrl }],
    paths,
  };
}
