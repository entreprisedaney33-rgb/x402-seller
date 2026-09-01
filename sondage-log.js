// sondage-log.js — append-only log of every 402 Payment Required response
// served (<DATA_DIR>/sondages.jsonl, see config.js — DATA_DIR must point to
// a persistent disk in production, or this log is lost on every Render
// redeploy), one JSON line per "probe" — an agent that discovers/tests an
// endpoint without (yet) paying. Mirrors payment-log.js (same append-only
// jsonl pattern, same explicit-field-list discipline: no secret or signed
// payload can ever end up in the log).
//
// Fields written: date, endpoint, ip (truncated — last octet/group zeroed,
// never the full client IP), user_agent. No query string, no headers, no
// request body — nothing that could carry sensitive data.
import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import config from "./config.js";

const logFile = join(config.dataDir, "sondages.jsonl");
let dirReady = null;

async function ensureLogDir() {
  if (!dirReady) {
    dirReady = mkdir(config.dataDir, { recursive: true });
  }
  await dirReady;
}

// truncateIp(ip) -> IPv4: zero the last octet ("203.0.113.42" -> "203.0.113.0").
// IPv6: keep only the first 4 groups ("2001:db8:1:2:3::4" -> "2001:db8:1:2::").
// Never returns the exact client address.
export function truncateIp(ip) {
  if (!ip) return null;
  const bare = String(ip).replace(/^::ffff:/, ""); // IPv4-mapped IPv6, from Express behind a proxy
  if (bare.includes(".")) {
    const parts = bare.split(".");
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    return null;
  }
  if (bare.includes(":")) {
    const groups = bare.split(":").filter((g) => g !== "");
    return `${groups.slice(0, 4).join(":")}::`;
  }
  return null;
}

export async function logSondage({ endpoint, ip, userAgent }) {
  const entry = {
    date: new Date().toISOString(),
    endpoint: endpoint || null,
    ip: truncateIp(ip),
    user_agent: userAgent ? String(userAgent).slice(0, 200) : null,
  };

  try {
    await ensureLogDir();
    await appendFile(logFile, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    // A logging hiccup must never break the actual 402 response already
    // sent to the client — just report it.
    console.error(`Could not write to ${logFile}:`, err.message);
  }
}
