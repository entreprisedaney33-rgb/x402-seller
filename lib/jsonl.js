// lib/jsonl.js — lecture EN FLUX (ligne par ligne) des journaux append-only
// <DATA_DIR>/*.jsonl, partagee par tous les modules /stats*.
//
// Pourquoi (incident du 09-10/11/2026) : chaque module faisait
// readFile(fichier entier) -> split("\n") -> JSON.parse de TOUTES les lignes.
// sondages.jsonl grossit de plusieurs milliers de lignes par jour (sondes
// 402 des annuaires/crawlers), et apres ~2 mois le serveur depassait la
// limite memoire de Node (plan Render 512 Mo) a chaque calcul de /stats :
// "JavaScript heap out of memory", plantage toutes les ~7 minutes, 502
// pour tout le monde (agents payeurs compris).
//
// Ici : on lit le fichier par morceaux (readline), on jette tout de suite
// les lignes hors fenetre (sinceMs), et on "interne" les chaines tres
// repetees (endpoint, user_agent, ip) pour qu'elles n'existent qu'une fois
// en memoire. Memoire = O(lignes gardees), plus O(taille du fichier).
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

// readJsonl(fichier, { sinceMs, intern }) -> tableau d'entrees.
//   sinceMs : si fourni, ne garde que les entrees dont `date` est dans les
//             sinceMs dernieres millisecondes (les autres ne sont jamais
//             conservees). null = tout le fichier (petits journaux seulement).
//   intern  : noms de champs dont les valeurs sont dedoublonnees en memoire.
// Fichier absent -> []. Ligne illisible (coupee par un crash) -> ignoree.
export async function readJsonl(file, { sinceMs = null, intern = [] } = {}) {
  const cutoff = sinceMs == null ? -Infinity : Date.now() - sinceMs;
  const pool = new Map();
  const entries = [];

  let stream;
  try {
    stream = createReadStream(file, { encoding: "utf8" });
    await new Promise((resolve, reject) => {
      stream.once("open", resolve);
      stream.once("error", reject);
    });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (sinceMs != null) {
      const t = Date.parse(e?.date);
      if (!Number.isFinite(t) || t < cutoff) continue;
    }
    for (const k of intern) {
      const v = e[k];
      if (typeof v !== "string") continue;
      const hit = pool.get(v);
      if (hit !== undefined) e[k] = hit;
      else pool.set(v, v);
    }
    entries.push(e);
  }
  return entries;
}
