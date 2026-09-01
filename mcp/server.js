#!/usr/bin/env node
// server.js — x402-seller-mcp: an MCP server (stdio transport) that turns
// every paid endpoint of https://x402-seller-0ay3.onrender.com (or any
// X402_ORIGIN) into an MCP tool, generated at startup from that server's
// own GET /.well-known/x402.json discovery document — never hand-listed,
// so it stays correct as endpoints are added or changed on the origin.
//
// Two call modes, chosen once at startup by whether BUYER_PRIVATE_KEY is
// set (see lib/x402-client.js for both):
//   - unset : each tool call fetches the endpoint unauthenticated, decodes
//     the real 402 challenge it gets back, and explains it (price,
//     network, how to enable paid calls) instead of returning data.
//   - set   : each tool call pays automatically via @x402/fetch and
//     returns the real result plus the settlement receipt (payer, tx hash).
//
// IMPORTANT (per the MCP docs, modelcontextprotocol.io/docs/develop/build-server):
// on stdio, stdout is the JSON-RPC channel — never console.log here, only
// console.error (stderr), or the protocol breaks.
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { privateKeyToAccount } from "viem/accounts";
import { buildInputShape, getParamGroups, toToolName } from "./lib/schema.js";
import { buildRequest, callUnpaid, callPaid } from "./lib/x402-client.js";

const X402_ORIGIN = (process.env.X402_ORIGIN || "https://x402-seller-0ay3.onrender.com").replace(/\/$/, "");
const BUYER_PRIVATE_KEY = process.env.BUYER_PRIVATE_KEY || "";

async function loadDiscoveryDocument() {
  const url = `${X402_ORIGIN}/.well-known/x402.json`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new Error(`Could not reach ${url}: ${err.message}`);
  }
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  const doc = await response.json();
  if (!Array.isArray(doc.resources)) {
    throw new Error(`${url} has no "resources" array — not a valid x402 discovery document.`);
  }
  return doc;
}

function registerToolsFromDiscovery(server, doc, account) {
  let registered = 0;
  for (const resource of doc.resources) {
    const toolName = toToolName(resource.method, resource.url);
    const shape = buildInputShape(resource);
    const { queryNames, bodyNames } = getParamGroups(resource);
    const priceNote = resource.accepts?.[0]?.price ? ` Costs ${resource.accepts[0].price} via x402 (USDC).` : "";

    server.registerTool(
      toolName,
      {
        description: `${resource.description || `${resource.method} ${new URL(resource.url).pathname}`}${priceNote}`,
        inputSchema: z.object(shape),
      },
      async (args) => {
        const { url, init } = buildRequest(resource, args || {}, queryNames, bodyNames);
        try {
          const text = account ? await callPaid(url, init, account) : await callUnpaid(url, init);
          return { content: [{ type: "text", text }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Request failed: ${err.message}` }], isError: true };
        }
      }
    );
    registered += 1;
  }
  return registered;
}

async function main() {
  console.error(`x402-seller-mcp: fetching discovery document from ${X402_ORIGIN} ...`);
  const doc = await loadDiscoveryDocument();

  let account = null;
  if (BUYER_PRIVATE_KEY) {
    try {
      account = privateKeyToAccount(BUYER_PRIVATE_KEY);
    } catch (err) {
      throw new Error(`BUYER_PRIVATE_KEY is set but invalid: ${err.message}`);
    }
  }

  const server = new McpServer({ name: "x402-seller-mcp", version: "0.1.0" });
  const count = registerToolsFromDiscovery(server, doc, account);

  console.error(
    `x402-seller-mcp: registered ${count} tool(s) from ${doc.resources.length} resource(s). ` +
      (account
        ? `Paid mode: calls will be settled automatically from wallet ${account.address}.`
        : `Unpaid mode: no BUYER_PRIVATE_KEY set — calls will explain the 402 challenge instead of paying.`)
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("x402-seller-mcp: running on stdio.");
}

main().catch((err) => {
  console.error("x402-seller-mcp: fatal error:", err.message);
  process.exit(1);
});
