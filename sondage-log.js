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
import { mkdir, appendFile, rename } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { finished, pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
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

  return avecVerrou(async () => {
    try {
      await ensureLogDir();
      await appendFile(logFile, JSON.stringify(entry) + "\n", "utf8");
    } catch (err) {
      // A logging hiccup must never break the actual 402 response already
      // sent to the client — just report it.
      console.error(`Could not write to ${logFile}:`, err.message);
    }
  });
}

// --- Rotation (ajoutee le 10/11/2026, incident "heap out of memory") -------
// sondages.jsonl ne doit plus grossir sans fin : une fois par jour, les
// lignes de plus de 8 jours (aucune route /stats* n'en a besoin, voir
// lib/sondages-recents.js) sont deplacees, compressees, a la fin de
// <DATA_DIR>/sondages-archive.jsonl.gz. Rien n'est supprime : l'archive se
// lit avec `zcat sondages-archive.jsonl.gz` (chaque rotation ajoute un
// membre gzip, format standard lu d'un bloc par zcat/gunzip).
//
// Ecritures et rotation passent par le meme verrou en memoire : pendant une
// rotation, les nouvelles sondes attendent quelques secondes (en memoire,
// quelques lignes) au lieu d'etre perdues ou ecrasees par le renommage.
let chaine = Promise.resolve();
function avecVerrou(fn) {
  const p = chaine.then(fn, fn);
  chaine = p.catch(() => {});
  return p;
}

const archiveFile = join(config.dataDir, "sondages-archive.jsonl.gz");
const GARDER_MS = 8 * 24 * 60 * 60 * 1000;
const UN_JOUR_MS = 24 * 60 * 60 * 1000;

async function ecrireLigne(ws, ligne) {
  if (!ws.write(ligne + "\n")) await once(ws, "drain");
}

async function fermer(ws) {
  ws.end();
  await finished(ws);
}

export function rotateSondages() {
  return avecVerrou(async () => {
    const debut = Date.now();
    const cutoff = debut - GARDER_MS;
    const tmpFile = logFile + ".tmp";
    let gardees = 0;
    let archivees = 0;

    let input;
    try {
      input = createReadStream(logFile, { encoding: "utf8" });
      await once(input, "open");
    } catch (err) {
      if (err.code === "ENOENT") return { gardees: 0, archivees: 0 };
      throw err;
    }

    const recent = createWriteStream(tmpFile, { encoding: "utf8" });
    const gzip = createGzip();
    const archive = createWriteStream(archiveFile, { flags: "a" });
    const archiveFini = pipeline(gzip, archive);

    for await (const ligne of createInterface({ input, crlfDelay: Infinity })) {
      if (!ligne.trim()) continue;
      let t = NaN;
      try {
        t = Date.parse(JSON.parse(ligne).date);
      } catch {
        // ligne illisible : archivee telle quelle, jamais perdue
      }
      if (Number.isFinite(t) && t >= cutoff) {
        await ecrireLigne(recent, ligne);
        gardees++;
      } else {
        await ecrireLigne(gzip, ligne);
        archivees++;
      }
    }

    gzip.end();
    await archiveFini;
    await fermer(recent);
    // Remplacement atomique : l'ancien fichier n'est remplace qu'une fois
    // l'archive ecrite et fermee.
    await rename(tmpFile, logFile);
    console.log(
      `Rotation sondages : ${gardees} lignes gardees (8 derniers jours), ${archivees} archivees dans ${archiveFile} (${Date.now() - debut} ms)`
    );
    return { gardees, archivees };
  });
}

// Lance une rotation peu apres le demarrage (sans retarder l'ecoute du
// serveur), puis une fois par jour. Un echec est journalise, jamais fatal.
export function planifierRotationSondages() {
  const lancer = () =>
    rotateSondages().catch((err) => console.error("Rotation sondages en echec :", err.message));
  setTimeout(lancer, 30_000).unref();
  setInterval(lancer, UN_JOUR_MS).unref();
}
