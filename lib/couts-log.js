// lib/couts-log.js — append-only log of OUR OWN estimated upstream cost per
// premium-reseller call (<DATA_DIR>/couts.jsonl), one JSON line per
// successful call to a premium provider (Tavily, Serper...). Mirrors
// payment-log.js/sondage-log.js (same append-only jsonl pattern, same
// DATA_DIR — see config.js for why it must point to a persistent disk in
// production, or this log is lost on every Render redeploy).
//
// This is NOT the buyer's x402 payment (already logged separately in
// paiements.jsonl by server.js's onAfterSettle) — it's what WE pay the
// upstream provider to fulfill the call, so real margin per endpoint can be
// tracked over time (sale price is fixed/known already; only the upstream
// cost side needs recording).
import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import config from "../config.js";

const logFile = join(config.dataDir, "couts.jsonl");
let dirReady = null;

async function ensureLogDir() {
  if (!dirReady) {
    dirReady = mkdir(config.dataDir, { recursive: true });
  }
  await dirReady;
}

export async function logCoutAmont({ endpoint, provider, cout_usd }) {
  const entry = {
    date: new Date().toISOString(),
    endpoint: endpoint || null,
    provider: provider || null,
    cout_usd: typeof cout_usd === "number" ? cout_usd : null,
  };

  try {
    await ensureLogDir();
    await appendFile(logFile, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    // A logging hiccup must never break a response already served to the
    // buyer — just report it.
    console.error(`Could not write to ${logFile}:`, err.message);
  }
}
