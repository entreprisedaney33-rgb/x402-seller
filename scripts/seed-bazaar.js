// scripts/seed-bazaar.js — appelle chaque endpoint payant DECOUVERT
// DYNAMIQUEMENT via GET {TARGET_URL}/.well-known/x402.json, avec un vrai
// paiement, pour que le facilitateur CDP les catalogue dans son index
// Bazaar (le catalogue se construit a partir des paiements deja traites,
// cf. scripts/check-bazaar.js). Aucune liste d'endpoints codee en dur : la
// SEULE partie fixe du script est la table d'EXEMPLES (comment appeler
// chaque chemin), qui vit maintenant dans scripts/lib/seed-core.js —
// partagee avec scripts/seed-hebdo.js (le seed hebdomadaire automatise en
// mode complet, sans --only, avec 1 retry par endpoint) pour ne jamais
// avoir deux listes qui divergent.
//
// Reveil du serveur d'abord (plan gratuit Render), puis chaque endpoint en
// sequence avec 2 s de pause entre chaque appel. Un echec sur un endpoint
// n'interrompt pas les suivants.
//
// Usage: npm run seed
//        npm run seed -- --only=/api/gas/base,/api/gas/ethereum
//        TARGET_URL=http://localhost:4021 npm run seed -- --only=/api/web/read
import { privateKeyToAccount } from "viem/accounts";
import config from "../config.js";
import { wakeServer, runSeed } from "./lib/seed-core.js";

const TARGET_URL = (process.env.TARGET_URL || "https://x402-seller-0ay3.onrender.com").replace(/\/$/, "");
const PAUSE_MS = 2000;

// --only=<chemins separes par des virgules> : ne seed que ces chemins
// exacts (tels qu'ils apparaissent dans .well-known/x402.json, ex.
// /api/gas/base). Sans cette option, TOUS les endpoints payants decouverts
// sont amorces (comportement d'origine, juste rendu dynamique).
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg
  ? new Set(
      onlyArg
        .slice("--only=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    )
  : null;

if (!config.buyerPrivateKey) {
  console.error(
    "BUYER_PRIVATE_KEY est vide dans le .env.\n" +
      "Genere un portefeuille d'abord : npm run generate-buyer-wallet\n" +
      "puis alimente l'adresse en USDC."
  );
  process.exit(1);
}

const account = privateKeyToAccount(config.buyerPrivateKey);
console.log(`Acheteur : ${account.address}`);
console.log(`Cible    : ${TARGET_URL}`);
if (ONLY) console.log(`Filtre   : --only=${[...ONLY].join(",")}`);

// Reveil du serveur (plan gratuit Render) avant tout appel, y compris la
// lecture de .well-known/x402.json.
console.log(`\nReveil   : GET ${TARGET_URL}/health (timeout 90 s)...`);
try {
  const { ms, status } = await wakeServer(TARGET_URL);
  console.log(`Reveille en ${(ms / 1000).toFixed(1)} s (HTTP ${status}).`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// --- Decouverte + appels payes (scripts/lib/seed-core.js) -------------------

console.log(`\nDecouverte : GET ${TARGET_URL}/.well-known/x402.json...`);

let seedResult;
try {
  seedResult = await runSeed({
    targetUrl: TARGET_URL,
    account,
    only: ONLY,
    pauseMs: PAUSE_MS,
    retryOnFail: false,
    onDiscovered: ({ discoveredCount, skippedNoExample, skippedNotFound, toCallCount }) => {
      console.log(`${discoveredCount} endpoint(s) payant(s) decouvert(s).`);
      for (const wanted of skippedNotFound) {
        console.warn(`⚠️  --only demande "${wanted}", introuvable dans .well-known/x402.json — ignore.`);
      }
      for (const w of skippedNoExample) {
        console.warn(`⚠️  Pas d'exemple pour ${w} dans EXAMPLES — endpoint saute.`);
      }
      if (toCallCount === 0) {
        console.error("\nAucun endpoint a appeler (filtre --only vide, ou aucun exemple disponible).");
        process.exit(1);
      }
      console.log(`${toCallCount} endpoint(s) a appeler, pause de ${PAUSE_MS / 1000}s entre chaque.\n`);
    },
    onStart: (i, total, ep) => {
      process.stdout.write(`[${i + 1}/${total}] ${ep.method} ${ep.path} ... `);
    },
    onResult: (i, total, ep, result) => {
      if (result.error) {
        console.log(`ERREUR: ${result.error}`);
      } else {
        console.log(result.paid ? `OK (HTTP ${result.httpStatus})` : `ECHEC (HTTP ${result.httpStatus})`);
      }
    },
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const { results, totalSpent } = seedResult;

console.log("\n=== Resultat ===\n");
console.table(
  results.map((r) => ({
    Endpoint: r.endpoint,
    "Statut HTTP": r.httpStatus,
    "Hash de paiement": r.hash || "(aucun)",
    Montant: r.paid ? `$${r.price.toFixed(3)}` : "-",
  }))
);
console.log(
  `\nTotal depense : $${totalSpent.toFixed(3)} (sur ${results.length} endpoint(s) appele(s), ` +
    `${results.filter((r) => r.paid).length} paiement(s) reussi(s))`
);
