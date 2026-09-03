// echecs-log.js — append-only log of failures the client-facing flow
// otherwise swallows silently (<DATA_DIR>/echecs.jsonl, see config.js —
// DATA_DIR must point to a persistent disk in production, or this log is
// lost on every Render redeploy). Mirrors payment-log.js/sondage-log.js
// (same append-only jsonl pattern, same explicit-field-list discipline).
//
// Two distinct causes, tagged by `type`:
//   - "settlement_failed": x402 verified the payment but the facilitator's
//     own settle call failed (server.js's onAfterSettle,
//     ctx.result.success === false) — a real payment attempt that didn't
//     go through, not this server's fault.
//   - "upstream_error": a paid endpoint's handler threw an UpstreamError
//     (lib/http.js) — a third-party source (Tavily, DefiLlama, GitHub...)
//     was slow/down/rate-limited. Since x402 only settles AFTER a
//     successful (2xx) handler response, this never means a buyer was
//     charged for a failed request — it's purely an operational signal,
//     no money involved.
//
// Never logs a private key, a full payment signature/payload, or any
// field beyond what's explicitly listed in each function below — only
// short strings (reason codes, HTTP statuses, a public payer address, a
// truncated User-Agent).
import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import config from "./config.js";

const logFile = join(config.dataDir, "echecs.jsonl");
let dirReady = null;

async function ensureLogDir() {
  if (!dirReady) {
    dirReady = mkdir(config.dataDir, { recursive: true });
  }
  await dirReady;
}

async function appendEchec(entry) {
  try {
    await ensureLogDir();
    await appendFile(logFile, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    // A logging hiccup must never break the actual response already sent
    // to the client — just report it.
    console.error(`Could not write to ${logFile}:`, err.message);
  }
}

export async function logEchecSettlement({ endpoint, method, motif, payer, userAgent }) {
  await appendEchec({
    date: new Date().toISOString(),
    type: "settlement_failed",
    endpoint: endpoint || null,
    method: method || null,
    motif: motif ? String(motif).slice(0, 300) : null,
    payer: payer || null,
    user_agent: userAgent ? String(userAgent).slice(0, 200) : null,
  });
}

export async function logEchecUpstream({ endpoint, provider, httpStatus, message }) {
  await appendEchec({
    date: new Date().toISOString(),
    type: "upstream_error",
    endpoint: endpoint || null,
    provider: provider || null,
    http_status: httpStatus ?? null,
    message: message ? String(message).slice(0, 300) : null,
  });
}
