// scripts/seed-hebdo.js — seed hebdomadaire automatise (mode complet) : paie
// pour de vrai CHAQUE endpoint payant decouvert dynamiquement depuis
// GET {TARGET_URL}/.well-known/x402.json (la meme decouverte dynamique que
// scripts/seed-bazaar.js — voir scripts/lib/seed-core.js, partage entre les
// deux), 1 retry par endpoint en cas d'echec, 3s de pause entre chaque appel.
//
// Pourquoi : le facilitateur CDP desindexe du Bazaar les endpoints qui n'ont
// pas vu de paiement reel recent. Ce script tourne sur un cron Render
// separe (voir render-cron-seed.json — cree via l'API, pas dans render.yaml,
// pour ne rien toucher au service web existant) chaque lundi, pour que le
// catalogue Bazaar ne se vide jamais, meme sans trafic agent reel.
//
// Garde-fou avant toute depense : verifie le solde USDC du portefeuille
// acheteur sur Base MAINNET (toujours mainnet, quel que soit NETWORK — ce
// script n'a de sens qu'en production) et s'arrete proprement, SANS reveiller
// le serveur ni rien depenser, si le solde est sous MIN_BALANCE_USD.
//
// logs/seeds.jsonl : resume JSON (une ligne par run) ecrit en LOCAL
// uniquement — utile quand ce script tourne depuis ce Mac ; sur Render, le
// disque du cron job n'est pas persistant (voir docs/render-cron-jobs), donc
// cette ecriture y echoue silencieusement (avertissement, jamais fatal) —
// les vrais logs d'execution restent consultables dans le Dashboard Render.
//
// Usage : node scripts/seed-hebdo.js
//         TARGET_URL=http://localhost:4021 node scripts/seed-hebdo.js
//
// N'importe PAS ../config.js : ce script n'a besoin que de BUYER_PRIVATE_KEY
// (lu directement depuis process.env) — pas de PAY_TO_ADDRESS ni de cles CDP,
// qui ne concernent que le cote VENDEUR (server.js). Ca garde la liste des
// variables d'environnement du cron job Render limitee au strict necessaire.
import { appendFile, mkdir } from "node:fs/promises";
import { config as loadEnv } from "dotenv";
import { createPublicClient, http as viemHttp, formatUnits } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { wakeServer, runSeed } from "./lib/seed-core.js";

// Charge .env quand il existe (execution locale depuis ce Mac) — n'ecrase
// jamais une variable deja presente dans l'environnement (comportement par
// defaut de dotenv), donc sans effet sur Render ou les vraies variables
// d'environnement du cron job font deja foi et aucun .env n'existe.
loadEnv();

const TARGET_URL = (process.env.TARGET_URL || "https://x402-seller-0ay3.onrender.com").replace(/\/$/, "");
const PAUSE_MS = 3000;
const MIN_BALANCE_USD = 0.5;

// USDC natif sur Base mainnet (eip155:8453) — meme adresse que celle
// utilisee par @x402/evm en interne (node_modules/@x402/evm/dist/esm/
// chunk-GMTGRPK2.mjs, DEFAULT_ASSETS["eip155:8453"]), pas devinee.
const USDC_ON_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ERC20_BALANCE_OF_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];

const buyerPrivateKey = process.env.BUYER_PRIVATE_KEY || "";
if (!buyerPrivateKey) {
  console.error("BUYER_PRIVATE_KEY est vide — rien pour payer. Arret propre, aucune depense.");
  process.exit(1);
}

const account = privateKeyToAccount(buyerPrivateKey);
console.log(`Acheteur : ${account.address}`);
console.log(`Cible    : ${TARGET_URL}`);

// --- Garde-fou solde : verifie AVANT toute depense --------------------------

console.log(`\nSolde    : lecture USDC sur Base mainnet...`);
const balanceClient = createPublicClient({ chain: base, transport: viemHttp(undefined, { timeout: 10_000 }) });

let balanceUsd;
try {
  const balanceRaw = await balanceClient.readContract({
    address: USDC_ON_BASE,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
  balanceUsd = Number(formatUnits(balanceRaw, 6));
} catch (error) {
  console.error(`Impossible de lire le solde USDC sur Base : ${error?.message || error}`);
  console.error("Arret propre, aucune depense (le garde-fou refuse de continuer sans certitude sur le solde).");
  process.exit(1);
}

console.log(`Solde    : $${balanceUsd.toFixed(4)} USDC`);

if (balanceUsd < MIN_BALANCE_USD) {
  console.error(
    `\n⚠️  Solde insuffisant : $${balanceUsd.toFixed(4)} < seuil minimum $${MIN_BALANCE_USD.toFixed(2)}.\n` +
      `Arret propre, AUCUNE requete n'a ete faite au serveur, rien n'a ete depense.\n` +
      `Recharge ${account.address} en USDC sur Base avant la prochaine execution (chaque lundi 08h00 Paris).`
  );
  process.exit(1);
}

// --- Reveil du serveur -------------------------------------------------------

console.log(`\nReveil   : GET ${TARGET_URL}/health (timeout 90 s)...`);
try {
  const { ms, status } = await wakeServer(TARGET_URL);
  console.log(`Reveille en ${(ms / 1000).toFixed(1)} s (HTTP ${status}).`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// --- Seed complet (tous les endpoints decouverts, 1 retry par echec) -------

console.log(`\nDecouverte : GET ${TARGET_URL}/.well-known/x402.json...`);

let seedResult;
try {
  seedResult = await runSeed({
    targetUrl: TARGET_URL,
    account,
    only: null, // mode complet : tout ce qui est decouvert, jamais une liste figee
    pauseMs: PAUSE_MS,
    retryOnFail: true,
    onDiscovered: ({ discoveredCount, skippedNoExample, toCallCount }) => {
      console.log(`${discoveredCount} endpoint(s) payant(s) decouvert(s).`);
      for (const w of skippedNoExample) {
        console.warn(`⚠️  Pas d'exemple pour ${w} dans EXAMPLES — endpoint saute.`);
      }
      console.log(`${toCallCount} endpoint(s) a appeler, pause de ${PAUSE_MS / 1000}s entre chaque, 1 retry si echec.\n`);
    },
    onStart: (i, total, ep) => {
      process.stdout.write(`[${i + 1}/${total}] ${ep.method} ${ep.path} ... `);
    },
    onResult: (i, total, ep, result) => {
      const retryTag = result.retried ? " (apres retry)" : "";
      if (result.error) {
        console.log(`ERREUR${retryTag}: ${result.error}`);
      } else {
        console.log((result.paid ? `OK (HTTP ${result.httpStatus})` : `ECHEC (HTTP ${result.httpStatus})`) + retryTag);
      }
    },
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const { discoveredCount, skippedNoExample, results, totalSpent } = seedResult;
const succeeded = results.filter((r) => r.paid);
const failed = results.filter((r) => !r.paid);

console.log("\n=== Resultat ===\n");
console.table(
  results.map((r) => ({
    Endpoint: r.endpoint,
    "Statut HTTP": r.httpStatus,
    "Hash de paiement": r.hash || (r.error ? `ERREUR: ${r.error}` : "(aucun)"),
    Montant: r.paid ? `$${r.price.toFixed(3)}` : "-",
    Retry: r.retried ? "oui" : "non",
  }))
);
console.log(
  `\nTotal depense : $${totalSpent.toFixed(3)} (${succeeded.length}/${results.length} paiement(s) reussi(s), ` +
    `${failed.length} echec(s) apres retry, sur ${discoveredCount} endpoint(s) decouvert(s), ` +
    `${skippedNoExample.length} saute(s) faute d'exemple).`
);

// --- Resume JSON dans logs/seeds.jsonl (disque LOCAL uniquement) -----------

const summary = {
  date: new Date().toISOString(),
  target: TARGET_URL,
  buyer: account.address,
  balance_usdc_before: balanceUsd,
  discovered: discoveredCount,
  skipped_no_example: skippedNoExample.length,
  attempted: results.length,
  succeeded: succeeded.length,
  failed: failed.length,
  total_spent_usdc: Math.round(totalSpent * 1e6) / 1e6,
  succeeded_endpoints: succeeded.map((r) => r.endpoint),
  failed_endpoints: failed.map((r) => ({ endpoint: r.endpoint, http_status: r.httpStatus, error: r.error })),
};

try {
  const logsDir = new URL("../logs/", import.meta.url);
  await mkdir(logsDir, { recursive: true });
  await appendFile(new URL("seeds.jsonl", logsDir), JSON.stringify(summary) + "\n");
  console.log(`\nResume ajoute a logs/seeds.jsonl.`);
} catch (error) {
  console.warn(
    `\nImpossible d'ecrire logs/seeds.jsonl (non fatal — normal sur un disque non persistant comme un cron ` +
      `Render) : ${error?.message || error}`
  );
}

if (failed.length > 0) {
  console.error(`\n${failed.length} endpoint(s) en echec meme apres retry.`);
  process.exit(1);
}
