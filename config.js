// config.js — lit le .env et expose la configuration validee du serveur.
import { config as loadEnv } from "dotenv";

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
  port,
  // URL publique de CE serveur, sans slash final. Toute ressource annoncee
  // aux agents (Bazaar, .well-known/x402.json) doit etre construite a partir
  // de cette valeur, jamais deduite de l'hote de la requete entrante.
  baseUrl,
  testnetFacilitatorUrl: TESTNET_FACILITATOR_URL,
};
