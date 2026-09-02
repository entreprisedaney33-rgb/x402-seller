#!/usr/bin/env node
// scripts/generate-snapshot.js — fetches the live x402 discovery document
// and writes it to ../tools-snapshot.json, bundled with the published
// package so the server can always list tools even when it can't reach the
// origin at startup (see server.js's loadStartupDiscoveryDocument). Run
// manually with `npm run snapshot`, or automatically before every
// `npm publish` via the prepublishOnly script.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(here, "..", "tools-snapshot.json");
const X402_ORIGIN = (process.env.X402_ORIGIN || "https://x402-seller-0ay3.onrender.com").replace(/\/$/, "");

async function main() {
  const url = `${X402_ORIGIN}/.well-known/x402.json`;
  console.log(`Fetching ${url} ...`);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  const doc = await response.json();
  if (!Array.isArray(doc.resources)) {
    throw new Error(`${url} has no "resources" array — not a valid x402 discovery document.`);
  }
  writeFileSync(OUT_PATH, JSON.stringify(doc, null, 2) + "\n");
  console.log(`Wrote ${doc.resources.length} resource(s) to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("generate-snapshot failed:", err.message);
  process.exit(1);
});
