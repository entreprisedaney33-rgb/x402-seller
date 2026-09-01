// Local test harness: spawns ../server.js as a real subprocess over stdio
// (exactly how Claude Desktop/Cursor would), and drives it with the
// official Client class — listTools(), then callTool() in both modes.
//
// Phase 1 (always runs, free): no BUYER_PRIVATE_KEY — verifies the server
// starts, lists tools, and returns a clear 402 explanation.
//
// Phase 2 (opt-in, spends real money): set RUN_PAID_TEST=1 to also pay for
// one real call with BUYER_PRIVATE_KEY, read from the env or, if unset,
// from ../../.env (this monorepo's own dev wallet) — never run this phase
// by accident just by running `npm test`.
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

async function runPhase(label, env) {
  console.log(`\n=== ${label} ===`);
  const transport = new StdioClientTransport({ command: "node", args: [SERVER_PATH], env, stderr: "pipe" });
  const client = new Client({ name: "manual-test-client", version: "0.0.1" });
  await client.connect(transport);
  if (transport._stderrStream) {
    transport._stderrStream.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  }

  const tools = await client.listTools();
  console.log(`Tools registered: ${tools.tools.length}`);
  console.log("First 5 tool names:", tools.tools.slice(0, 5).map((t) => t.name));

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

await runPhase("PHASE 1: no BUYER_PRIVATE_KEY (unpaid/explain mode, free)", { PATH: process.env.PATH });

if (process.env.RUN_PAID_TEST === "1") {
  const buyerPrivateKey = process.env.BUYER_PRIVATE_KEY || readBuyerPrivateKeyFromParentEnv();
  if (!buyerPrivateKey) {
    console.log("\nRUN_PAID_TEST=1 but no BUYER_PRIVATE_KEY found (env or ../../.env) — skipping phase 2.");
  } else {
    await runPhase("PHASE 2: with BUYER_PRIVATE_KEY (REAL mainnet payment, ~$0.005)", {
      PATH: process.env.PATH,
      BUYER_PRIVATE_KEY: buyerPrivateKey,
    });
  }
} else {
  console.log("\n(Set RUN_PAID_TEST=1 to also run phase 2, which makes a real ~$0.005 mainnet payment.)");
}
