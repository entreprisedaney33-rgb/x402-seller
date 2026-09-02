#!/usr/bin/env node
// server.js — x402-seller-mcp: an MCP server (stdio transport) that turns
// every paid endpoint of https://x402-seller-0ay3.onrender.com (or any
// X402_ORIGIN) into an MCP tool, generated from that server's own
// GET /.well-known/x402.json discovery document — never hand-listed, so it
// stays correct as endpoints are added or changed on the origin.
//
// Two call modes, chosen once at startup by whether BUYER_PRIVATE_KEY is
// set (see lib/x402-client.js for both):
//   - unset : each tool call fetches the endpoint unauthenticated, decodes
//     the real 402 challenge it gets back, and explains it (price,
//     network, how to enable paid calls) instead of returning data.
//   - set   : each tool call pays automatically via @x402/fetch and
//     returns the real result plus the settlement receipt (payer, tx hash).
//
// Startup never depends on the network being reachable or fast: the live
// discovery document is tried with a short budget, and on any failure
// (network error, timeout, bad response) the server falls back to
// tools-snapshot.json, a copy bundled at publish time (see
// scripts/generate-snapshot.js) — so `tools/list` always returns the full
// tool set, even to a directory scanner running with no/slow egress. If we
// started from the snapshot, a background retry keeps trying the live
// origin and reconciles the registered tools once it succeeds.
//
// IMPORTANT (per the MCP docs, modelcontextprotocol.io/docs/develop/build-server):
// on stdio, stdout is the JSON-RPC channel — never console.log here, only
// console.error (stderr), or the protocol breaks.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { privateKeyToAccount } from "viem/accounts";
import { buildInputShape, getParamGroups, toToolName } from "./lib/schema.js";
import { buildRequest, callUnpaid, callPaid } from "./lib/x402-client.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
const SNAPSHOT_PATH = join(here, "tools-snapshot.json");

const X402_ORIGIN = (process.env.X402_ORIGIN || "https://x402-seller-0ay3.onrender.com").replace(/\/$/, "");
const BUYER_PRIVATE_KEY = process.env.BUYER_PRIVATE_KEY || "";
const STARTUP_FETCH_TIMEOUT_MS = 5_000;
const BACKGROUND_RETRY_INTERVAL_MS = 15_000;
const BACKGROUND_RETRY_MAX_ATTEMPTS = 10;

const SERVER_INSTRUCTIONS =
  "Pay-per-call access to x402-seller's paid API endpoints (crypto prices, DeFi data, " +
  "on-chain reads, web reading, AI tasks) in USDC on Base — no API key. Without " +
  "BUYER_PRIVATE_KEY set, every tool call explains the real 402 payment challenge " +
  "instead of paying; with it set to a funded throwaway wallet's private key, calls " +
  "pay automatically over x402 and return the real result.";

function isValidDiscoveryDocument(doc) {
  return Boolean(doc) && Array.isArray(doc.resources);
}

async function fetchLiveDiscoveryDocument(timeoutMs) {
  const url = `${X402_ORIGIN}/.well-known/x402.json`;
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  const doc = await response.json();
  if (!isValidDiscoveryDocument(doc)) {
    throw new Error(`${url} has no "resources" array — not a valid x402 discovery document.`);
  }
  return doc;
}

function loadSnapshotDiscoveryDocument() {
  const doc = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  if (!isValidDiscoveryDocument(doc)) {
    throw new Error(`${SNAPSHOT_PATH} has no "resources" array — corrupt bundled snapshot.`);
  }
  return doc;
}

// Bounded to STARTUP_FETCH_TIMEOUT_MS so a slow/unreachable origin never
// stalls startup — falls back to the bundled snapshot on any failure.
async function loadStartupDiscoveryDocument() {
  try {
    const doc = await fetchLiveDiscoveryDocument(STARTUP_FETCH_TIMEOUT_MS);
    return { doc, source: "live" };
  } catch (err) {
    console.error(
      `x402-seller-mcp: live discovery fetch failed within ${STARTUP_FETCH_TIMEOUT_MS}ms (${err.message}) ` +
        "— falling back to the bundled snapshot."
    );
    const doc = loadSnapshotDiscoveryDocument();
    return { doc, source: "snapshot" };
  }
}

function toolDescriptionFromResource(resource) {
  const priceNote = resource.accepts?.[0]?.price ? ` Costs ${resource.accepts[0].price} via x402 (USDC).` : "";
  return `${resource.description || `${resource.method} ${new URL(resource.url).pathname}`}${priceNote}`;
}

function makeToolHandler(resource, queryNames, bodyNames, account) {
  return async (args) => {
    const { url, init } = buildRequest(resource, args || {}, queryNames, bodyNames);
    try {
      const text = account ? await callPaid(url, init, account) : await callUnpaid(url, init);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Request failed: ${err.message}` }], isError: true };
    }
  };
}

// Registers/updates/removes tools so the live tool set always matches
// `doc.resources`. `registry` (name -> RegisteredTool handle) is carried
// across calls, so this is safe to call again later (e.g. after a
// background refresh) without hitting "already registered" errors.
function syncToolsFromDiscovery(server, doc, account, registry) {
  const desired = new Map();
  for (const resource of doc.resources) {
    desired.set(toToolName(resource.method, resource.url), resource);
  }

  for (const [toolName, resource] of desired) {
    const shape = buildInputShape(resource);
    const { queryNames, bodyNames } = getParamGroups(resource);
    const description = toolDescriptionFromResource(resource);
    const handler = makeToolHandler(resource, queryNames, bodyNames, account);
    const existing = registry.get(toolName);
    if (existing) {
      existing.update({ description, callback: handler });
    } else {
      registry.set(toolName, server.registerTool(toolName, { description, inputSchema: z.object(shape) }, handler));
    }
  }

  for (const [toolName, handle] of registry) {
    if (!desired.has(toolName)) {
      handle.remove();
      registry.delete(toolName);
    }
  }

  return desired.size;
}

// Only relevant when startup used the snapshot: keeps retrying the live
// origin in the background (without blocking anything) so a long-lived
// process — e.g. Claude Desktop, which keeps this server running for a
// whole session — picks up the real, current tool set as soon as the
// network or origin recovers. Gives up quietly after a bounded number of
// attempts rather than retrying forever.
async function refreshFromLiveInBackground(server, account, registry, startedFromLive) {
  if (startedFromLive) return;
  for (let attempt = 1; attempt <= BACKGROUND_RETRY_MAX_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, BACKGROUND_RETRY_INTERVAL_MS));
    try {
      const doc = await fetchLiveDiscoveryDocument(STARTUP_FETCH_TIMEOUT_MS);
      const total = syncToolsFromDiscovery(server, doc, account, registry);
      console.error(`x402-seller-mcp: background refresh succeeded on attempt ${attempt} — ${total} tool(s) now live.`);
      return;
    } catch (err) {
      console.error(`x402-seller-mcp: background refresh attempt ${attempt}/${BACKGROUND_RETRY_MAX_ATTEMPTS} failed: ${err.message}`);
    }
  }
  console.error(`x402-seller-mcp: gave up on background refresh after ${BACKGROUND_RETRY_MAX_ATTEMPTS} attempts — staying on the bundled snapshot.`);
}

async function main() {
  console.error(
    `x402-seller-mcp: loading discovery document (live origin ${X402_ORIGIN}, ` +
      `${STARTUP_FETCH_TIMEOUT_MS}ms budget, then bundled snapshot) ...`
  );
  const { doc, source } = await loadStartupDiscoveryDocument();

  let account = null;
  if (BUYER_PRIVATE_KEY) {
    try {
      account = privateKeyToAccount(BUYER_PRIVATE_KEY);
    } catch (err) {
      throw new Error(`BUYER_PRIVATE_KEY is set but invalid: ${err.message}`);
    }
  }

  const server = new McpServer({
    name: "x402-seller-mcp",
    version: pkg.version,
    instructions: SERVER_INSTRUCTIONS,
  });

  const registry = new Map();
  const total = syncToolsFromDiscovery(server, doc, account, registry);

  console.error(
    `x402-seller-mcp: registered ${total} tool(s) from ${doc.resources.length} resource(s) (source: ${source}). ` +
      (account
        ? `Paid mode: calls will be settled automatically from wallet ${account.address}.`
        : `Unpaid mode: no BUYER_PRIVATE_KEY set — calls will explain the 402 challenge instead of paying.`)
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("x402-seller-mcp: running on stdio.");

  // Fire-and-forget: never blocks startup or the caller. No-op when we
  // already started from live data.
  refreshFromLiveInBackground(server, account, registry, source === "live").catch((err) => {
    console.error("x402-seller-mcp: background refresh crashed:", err.message);
  });
}

main().catch((err) => {
  console.error("x402-seller-mcp: fatal error:", err.message);
  process.exit(1);
});
