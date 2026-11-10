// lib/sondages-recents.js — UNE seule copie en memoire des sondages 402
// recents, partagee par /stats, /stats/daily et /stats/probes (avant :
// chacun relisait et gardait le fichier entier, jusqu'a 3 copies en meme
// temps). Aucun de ces modules n'a besoin de plus de 7 jours (fenetres
// glissantes 24h/7j, ou jours calendaires UTC "hier"/"aujourd'hui"/7 jours
// de lib/stats-daily.js) : on garde 8 jours pour la marge.
//
// Les sondages plus anciens restent sur disque, dans l'archive compressee
// tenue par sondage-log.js (rotation quotidienne), jamais supprimes.
import { join } from "node:path";
import { cached } from "./cache.js";
import { readJsonl } from "./jsonl.js";
import config from "../config.js";

export const FENETRE_SONDAGES_MS = 8 * 24 * 60 * 60 * 1000;
const sondagesFile = join(config.dataDir, "sondages.jsonl");

export function readSondagesRecents() {
  return cached("sondages-recents", 60_000, () =>
    readJsonl(sondagesFile, {
      sinceMs: FENETRE_SONDAGES_MS,
      intern: ["endpoint", "user_agent", "ip"],
    })
  );
}
