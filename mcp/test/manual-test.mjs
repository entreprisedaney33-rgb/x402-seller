// Local test harness: spawns ../server.js as a real subprocess over stdio
// (exactly how Claude Desktop/Cursor would), and drives it with the
// official Client class — listTools(), then callTool().
//
// Phase SNAPSHOT (always runs, free): X402_ORIGIN points at a domain that
// cannot resolve (RFC 2606 .invalid) — simulates a directory scanner with
// no/broken egress to the real origin. Verifies the server still starts,
// still lists every tool (from the bundled tools-snapshot.json), and says
// so on stderr — this is the fix for Smithery's "couldn't list
// capabilities" failure.
//
// Phase LIVE (always runs, free): default X402_ORIGIN (the real origin) —
// verifies the live discovery fetch succeeds within the 5s startup budget
// and tools are sourced from it, not the snapshot.
//
// Phase PAID (opt-in, spends real money): set RUN_PAID_TEST=1 to also pay
// for one real call with BUYER_PRIVATE_KEY, read from the env or, if
// unset, from ../../.env (this monorepo's own dev wallet) — never run
// this phase by accident just by running `npm test`.
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(here, "..", "server.js");
const PARENT_ENV_FILE = join(here, "..", "..", ".env");

function readBuyerPrivateKeyFromParentEnv() {
  if (!existsSync(PARENT_ENV_FILE)) return "";
  const match = readFileSync(PARENT_ENV_FILE, "utf8").match(/^BUYER_PRIVATE_KEY=(.*)$/m);
  return match ? match[1].trim() : "";
}

async function runPhase(label, env, { expectSource } = {}) {
  console.log(`\n=== ${label} ===`);
  const transport = new StdioClientTransport({ command: "node", args: [SERVER_PATH], env, stderr: "pipe" });
  const client = new Client({ name: "manual-test-client", version: "0.0.1" });

  let stderrText = "";
  if (transport.stderr) {
    transport.stderr.on("data", (chunk) => {
      stderrText += chunk.toString();
      process.stderr.write(`[server] ${chunk}`);
    });
  }

  await client.connect(transport);

  const tools = await client.listTools();
  console.log(`Tools registered: ${tools.tools.length}`);
  console.log("First 5 tool names:", tools.tools.slice(0, 5).map((t) => t.name));

  if (tools.tools.length === 0) {
    throw new Error(`${label}: expected at least one tool, got 0`);
  }

  if (expectSource) {
    const sourceLine = stderrText.includes(`(source: ${expectSource})`);
    console.log(`Discovery source line mentions "${expectSource}": ${sourceLine ? "yes" : "NO — unexpected"}`);
    if (!sourceLine) {
      throw new Error(`${label}: expected stderr to report "(source: ${expectSource})", got:\n${stderrText}`);
    }
  }

  const target = tools.tools.find((t) => t.name === "get_api_gas_base");
  if (!target) {
    console.log("get_api_gas_base not found!");
  } else {
    console.log(`\nCalling ${target.name} ...`);
    const result = await client.callTool({ name: target.name, arguments: {} });
    console.log("Result:");
    console.log(result.content.map((c) => c.text).join("\n"));
  }

  await client.close();
}

await runPhase(
  "PHASE SNAPSHOT: unreachable X402_ORIGIN (.invalid) — must fall back to the bundled snapshot",
  { PATH: process.env.PATH, X402_ORIGIN: "https://x402-seller-mcp-test.invalid" },
  { expectSource: "snapshot" }
);

await runPhase(
  "PHASE LIVE: real X402_ORIGIN, no BUYER_PRIVATE_KEY (unpaid/explain mode, free)",
  { PATH: process.env.PATH },
  { expectSource: "live" }
);

if (process.env.RUN_PAID_TEST === "1") {
  const buyerPrivateKey = process.env.BUYER_PRIVATE_KEY || readBuyerPrivateKeyFromParentEnv();
  if (!buyerPrivateKey) {
    console.log("\nRUN_PAID_TEST=1 but no BUYER_PRIVATE_KEY found (env or ../../.env) — skipping phase PAID.");
  } else {
    await runPhase("PHASE PAID: with BUYER_PRIVATE_KEY (REAL mainnet payment, ~$0.005)", {
      PATH: process.env.PATH,
      BUYER_PRIVATE_KEY: buyerPrivateKey,
    });
  }
} else {
  console.log("\n(Set RUN_PAID_TEST=1 to also run phase PAID, which makes a real ~$0.005 mainnet payment.)");
}

console.log("\nAll phases passed.");
