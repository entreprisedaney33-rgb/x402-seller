// lib/schema.js — converts the Bazaar discovery schema each resource in
// /.well-known/x402.json already carries (extensions.bazaar.schema, from
// @x402/extensions/bazaar's declareDiscoveryExtension — see ../../discovery.js
// and ../../endpoints/*.js in the parent x402-seller project) into a zod
// object suitable for MCP's registerTool({ inputSchema }).
//
// The bazaar schema shape (verified against a live resource fetched from
// the running server, not guessed):
//   extensions.bazaar.schema.properties.input.properties.queryParams  (GET)
//   extensions.bazaar.schema.properties.input.properties.body          (POST)
// each a plain JSON-Schema object: { properties: {name: {type, description,
// enum?, items?}}, required: [...] }. Only the small set of JSON-Schema
// types our own endpoints actually use are handled (string/integer/number/
// boolean/array/object) — this is a narrow, purpose-built mapping for this
// one server's schemas, not a general JSON-Schema-to-Zod library.
import { z } from "zod";

function zodForJsonSchemaProp(prop) {
  let field;
  switch (prop?.type) {
    case "integer":
      field = z.number().int();
      break;
    case "number":
      field = z.number();
      break;
    case "boolean":
      field = z.boolean();
      break;
    case "array":
      field = z.array(zodForJsonSchemaProp(prop.items || { type: "string" }));
      break;
    case "object":
      // Used by our /api/ai/extract and /api/web/extract "schema" param
      // (an arbitrary caller-supplied JSON Schema) — no fixed shape to
      // enforce, so accept any plain object.
      field = z.record(z.string(), z.any());
      break;
    case "string":
    default:
      field = prop?.enum ? z.enum(prop.enum) : z.string();
  }
  if (prop?.description) field = field.describe(prop.description);
  return field;
}

// buildInputShape(resource) -> plain object of {name: ZodType}, ready to
// pass into z.object(...). Merges GET queryParams and POST body (a given
// resource only ever has one or the other, per how declareDiscoveryExtension
// is used in this project, but merging both is harmless and future-proof).
export function buildInputShape(resource) {
  const inputSchema = resource?.extensions?.bazaar?.schema?.properties?.input;
  const shape = {};
  if (!inputSchema) return shape;

  for (const group of ["queryParams", "body"]) {
    const groupSchema = inputSchema.properties?.[group];
    if (!groupSchema?.properties) continue;
    const required = new Set(groupSchema.required || []);
    for (const [name, prop] of Object.entries(groupSchema.properties)) {
      let field = zodForJsonSchemaProp(prop);
      if (!required.has(name)) field = field.optional();
      shape[name] = field;
    }
  }
  return shape;
}

// getParamGroups(resource) -> { queryNames, bodyNames } — which argument
// names go in the query string (GET) vs. the JSON body (POST), per the
// SAME bazaar schema buildInputShape reads. Used at call time to split a
// tool call's args into the right part of the HTTP request.
export function getParamGroups(resource) {
  const inputSchema = resource?.extensions?.bazaar?.schema?.properties?.input;
  return {
    queryNames: Object.keys(inputSchema?.properties?.queryParams?.properties || {}),
    bodyNames: Object.keys(inputSchema?.properties?.body?.properties || {}),
  };
}

// toToolName("GET", "https://host/api/gas/base") -> "get_api_gas_base"
export function toToolName(method, url) {
  const path = new URL(url).pathname;
  const parts = path.split("/").filter(Boolean);
  return [method.toLowerCase(), ...parts].join("_").replace(/[^a-z0-9_]/g, "_");
}
