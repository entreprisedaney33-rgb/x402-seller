// config.js — lit le .env et expose la configuration validee du serveur.
import { config as loadEnv } from "dotenv";
import { resolve as resolvePath } from "node:path";

loadEnv();

// Le protocole x402 v2 identifie les reseaux au format CAIP-2.
const NETWORKS = {
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
};

// Facilitateur public de test (base-sepolia uniquement, sans cle).
const TESTNET_FACILITATOR_URL = "https://x402.org/facilitator";

const network = process.env.NETWORK || "base-sepolia";
if (!NETWORKS[network]) {
  throw new Error(
    `NETWORK invalide: "${network}". Valeurs acceptees: ${Object.keys(NETWORKS).join(", ")}`
  );
}

const payToAddress = process.env.PAY_TO_ADDRESS || "";
if (!/^0x[0-9a-fA-F]{40}$/.test(payToAddress)) {
  throw new Error(
    "PAY_TO_ADDRESS manquante ou invalide dans le .env (adresse EVM 0x... attendue)."
  );
}

const isMainnet = network === "base";
const cdpApiKeyId = process.env.CDP_API_KEY_ID || "";
const cdpApiKeySecret = process.env.CDP_API_KEY_SECRET || "";

if (isMainnet && (!cdpApiKeyId || !cdpApiKeySecret)) {
  throw new Error(
    "NETWORK=base (production) exige CDP_API_KEY_ID et CDP_API_KEY_SECRET dans le .env " +
      "(le facilitateur CDP authentifie verify/settle). " +
      "Pour tester sans cles, utilise NETWORK=base-sepolia."
  );
}

const port = Number(process.env.PORT || 4021);

// URL publique annoncee aux agents (metadonnees Bazaar, .well-known/x402.json).
// En local, replie sur localhost si BASE_URL n'est pas defini ; en production
// (Render), BASE_URL doit TOUJOURS pointer vers le vrai domaine public.
if (process.env.BASE_URL && !/^https?:\/\//.test(process.env.BASE_URL)) {
  throw new Error(
    `BASE_URL invalide: "${process.env.BASE_URL}" (doit commencer par http:// ou https://).`
  );
}
const baseUrl = (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, "");

// Repertoire ou vivent les journaux (paiements.jsonl, sondages.jsonl) lus/ecrits
// par payment-log.js, sondage-log.js, lib/stats.js et lib/stats-daily.js.
// Defaut "./logs" (resolu depuis le repertoire de lancement, donc la racine
// du projet en usage normal) — sur Render, DATA_DIR doit pointer vers le
// point de montage d'un disque persistant (ex. /var/data), sinon ces
// journaux sont perdus a chaque redeploiement (disque ephemere par defaut).
// resolvePath renvoie un chemin absolu tel quel si DATA_DIR est deja
// absolu (ex. /var/data), ou le resout depuis cwd sinon (ex. "./logs").
const dataDir = resolvePath(process.cwd(), process.env.DATA_DIR || "./logs");

export default {
  // "base-sepolia" ou "base"
  network,
  // Identifiant CAIP-2 correspondant, ex. "eip155:84532"
  caip2Network: NETWORKS[network],
  isMainnet,
  payToAddress,
  cdpApiKeyId,
  cdpApiKeySecret,
  buyerPrivateKey: process.env.BUYER_PRIVATE_KEY || "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  // Optionnel : releve le plafond de requetes GitHub (60/h -> 5000/h) pour
  // GET /api/github/repo. Aucun scope requis (donnees de depots publics).
  githubToken: process.env.GITHUB_TOKEN || "",
  // Gamme "premium reseller" (POST /api/search/web, /api/search/serp,
  // /api/web/scrape) — voir README "Premium reseller". Vides par defaut :
  // chaque endpoint renvoie un 503 propre tant que sa cle n'est pas fournie,
  // jamais une erreur 500 ni un crash au demarrage.
  tavilyApiKey: process.env.TAVILY_API_KEY || "",
  serperApiKey: process.env.SERPER_API_KEY || "",
  // Cle secrete protegeant GET /stats/daily (revenu detaille, payers) —
  // route admin, jamais publiee dans .well-known/x402.json ni openapi.json.
  // Vide => route toujours refusee (401), jamais "cle vide == acces libre".
  statsKey: process.env.STATS_KEY || "",
  dataDir,
  port,
  // URL publique de CE serveur, sans slash final. Toute ressource annoncee
  // aux agents (Bazaar, .well-known/x402.json) doit etre construite a partir
  // de cette valeur, jamais deduite de l'hote de la requete entrante.
  baseUrl,
  testnetFacilitatorUrl: TESTNET_FACILITATOR_URL,
};
