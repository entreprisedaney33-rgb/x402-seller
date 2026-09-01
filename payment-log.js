// payment-log.js — journal append-only des paiements reussis, 1 ligne
// JSON par paiement dans logs/paiements.jsonl.
//
// Champs ecrits, TOUS publics/non-sensibles (adresse de payeur et hash de
// transaction sont deja visibles sur la blockchain) : date, endpoint, payer,
// montant, hash. On construit la ligne par une liste EXPLICITE de champs
// (jamais un spread de l'objet de contexte x402 en entier) pour garantir
// qu'aucun secret ni payload de paiement signe ne peut finir dans le log,
// meme si la forme des objets du SDK evolue.
import { mkdir, appendFile } from "node:fs/promises";

const logDir = new URL("./logs/", import.meta.url);
const logFile = new URL("./logs/paiements.jsonl", import.meta.url);
let dirReady = null;

async function ensureLogDir() {
  if (!dirReady) {
    dirReady = mkdir(logDir, { recursive: true });
  }
  await dirReady;
}

export async function logPaiementReussi({ endpoint, payer, montant, hash }) {
  const entry = {
    date: new Date().toISOString(),
    endpoint: endpoint || null,
    payer: payer || null,
    montant: montant || null,
    hash: hash || null,
  };

  try {
    await ensureLogDir();
    await appendFile(logFile, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    // Un souci d'ecriture du journal ne doit jamais faire echouer un
    // paiement deja regle — on se contente de le signaler.
    console.error("Impossible d'ecrire dans logs/paiements.jsonl :", err.message);
  }
}
