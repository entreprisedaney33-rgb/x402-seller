// scripts/seed-bazaar.js — appelle UNE FOIS chaque endpoint payant en
// production, avec un vrai paiement mainnet, pour que le facilitateur CDP
// les catalogue dans son index Bazaar (le catalogue se construit a partir
// des paiements deja traites, cf. scripts/check-bazaar.js).
//
// Reveil du serveur d'abord (plan gratuit Render), puis chaque endpoint en
// sequence avec 2 s de pause entre chaque appel. Un echec sur un endpoint
// n'interrompt pas les suivants.
//
// Usage: npm run seed
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import config from "../config.js";

const TARGET_URL = process.env.TARGET_URL || "https://x402-seller-0ay3.onrender.com";
const PAUSE_MS = 2000;

// Un exemple valide par endpoint payant — mêmes exemples que les tests
// reels precedents (base-sepolia puis production).
const ENDPOINTS = [
  { path: "/api/defi/tvl?protocol=aave", method: "GET", price: 0.005 },
  { path: "/api/defi/price?coins=ethereum,bitcoin", method: "GET", price: 0.005 },
  { path: "/api/defi/tvl-chain?chain=base", method: "GET", price: 0.005 },
  { path: "/api/defi/protocols?limit=3", method: "GET", price: 0.005 },
  { path: "/api/defi/yields?chain=base&min_tvl=1000000&limit=3", method: "GET", price: 0.005 },
  { path: "/api/defi/stablecoins?limit=3", method: "GET", price: 0.005 },
  { path: "/api/chain/gas?chain=base", method: "GET", price: 0.005 },
  { path: "/api/chain/block?chain=base", method: "GET", price: 0.005 },
  { path: "/api/fx/rates?base=EUR", method: "GET", price: 0.005 },
  { path: "/api/github/repo?full_name=expressjs/express", method: "GET", price: 0.005 },
  { path: "/api/npm/package?name=express", method: "GET", price: 0.005 },
  { path: "/api/hn/top?limit=3", method: "GET", price: 0.005 },
  { path: "/api/wiki/summary?title=Bitcoin&lang=en", method: "GET", price: 0.005 },
  { path: "/api/dns/lookup?domain=example.com", method: "GET", price: 0.005 },
  { path: "/api/rdap/domain?domain=example.com", method: "GET", price: 0.005 },
  {
    path: "/api/ai/summarize",
    method: "POST",
    price: 0.01,
    body: {
      text:
        "L'entreprise Nordev Solutions a annonce aujourd'hui les resultats de son troisieme trimestre, marques par une croissance de 18% du chiffre d'affaires par rapport a l'annee precedente. Cette progression s'explique principalement par l'expansion de son offre de services cloud aupres des petites et moyennes entreprises, ainsi que par l'ouverture de deux nouveaux bureaux regionaux a Lyon et Toulouse. Le directeur general, Marc Bertillon, a souligne que cette dynamique s'accompagne d'un investissement accru dans la recherche et developpement, avec un budget qui a double sur les douze derniers mois.\n\nMalgre ce contexte favorable, l'entreprise fait face a des defis importants sur le plan du recrutement. Le secteur technologique connait actuellement une penurie de profils qualifies, en particulier dans les domaines de la cybersecurite et de l'intelligence artificielle. Pour y remedier, Nordev Solutions a lance un partenariat avec trois ecoles d'ingenieurs afin de former directement les futurs talents selon ses besoins specifiques, et a egalement mis en place un programme de mobilite interne pour retenir ses employes actuels.\n\nPour le dernier trimestre de l'annee, la direction reste prudente mais optimiste. Elle table sur une poursuite de la croissance, tout en restant attentive a l'evolution du contexte economique general et aux eventuelles tensions sur les couts d'approvisionnement en materiel informatique. Un point d'etape complet sera presente lors de l'assemblee generale prevue en fevrier prochain.",
      max_sentences: 3,
    },
  },
  {
    path: "/api/ai/classify",
    method: "POST",
    price: 0.01,
    body: {
      text:
        "Bonjour, je vous ecris car le produit que j'ai recu la semaine derniere presente un defaut de fabrication sur le boitier, et il ne s'allume plus depuis hier. J'aimerais savoir comment proceder pour un remboursement ou un echange, car ce n'est clairement pas normal pour un article recu il y a a peine dix jours. Merci de me repondre rapidement. Cordialement, Sophie Marchand.",
      labels: ["devis", "reclamation", "autre"],
    },
  },
  {
    path: "/api/ai/translate",
    method: "POST",
    price: 0.01,
    body: {
      text: "Notre equipe technique a corrige le probleme et le service devrait fonctionner normalement d'ici la fin de la journee.",
      target_lang: "English",
    },
  },
  {
    path: "/api/ai/extract",
    method: "POST",
    price: 0.02,
    body: {
      text:
        "Facture etablie par la SARL Menuiserie Dubreuil, 14 rue des Artisans, 69003 Lyon, le 12 aout 2026. Prestation : fabrication et pose d'une porte d'entree sur mesure en chene massif, y compris ferrures et finitions. Montant total HT : 2 150,00 euros. TVA a 20% : 430,00 euros. Montant total TTC a regler : 2 580,00 euros, payable a 30 jours a compter de la reception de la facture.",
      schema: {
        type: "object",
        properties: {
          fournisseur: { type: "string", description: "Nom de l'entreprise qui emet la facture" },
          montant_ttc: { type: "number", description: "Montant total TTC en euros, sans le symbole" },
          date: { type: "string", description: "Date de la facture au format AAAA-MM-JJ" },
        },
      },
    },
  },
];

if (!config.buyerPrivateKey) {
  console.error(
    "BUYER_PRIVATE_KEY est vide dans le .env.\n" +
      "Genere un portefeuille d'abord : npm run generate-buyer-wallet\n" +
      "puis alimente l'adresse en USDC."
  );
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const account = privateKeyToAccount(config.buyerPrivateKey);
console.log(`Acheteur : ${account.address}`);
console.log(`Cible    : ${TARGET_URL}`);
console.log(`${ENDPOINTS.length} endpoints a appeler, pause de ${PAUSE_MS / 1000}s entre chaque.\n`);

// Reveil du serveur (plan gratuit Render) avant tout appel paye.
console.log(`Reveil   : GET ${TARGET_URL}/health (timeout 90 s)...`);
const wakeStart = Date.now();
try {
  const healthResponse = await fetch(`${TARGET_URL}/health`, { signal: AbortSignal.timeout(90_000) });
  const wakeMs = Date.now() - wakeStart;
  if (!healthResponse.ok) {
    console.error(`/health a repondu HTTP ${healthResponse.status} apres ${(wakeMs / 1000).toFixed(1)} s.`);
    process.exit(1);
  }
  console.log(`Reveille en ${(wakeMs / 1000).toFixed(1)} s (HTTP ${healthResponse.status}).\n`);
} catch (error) {
  console.error(`/health injoignable : ${error?.message || error}`);
  process.exit(1);
}

const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:*", client: new ExactEvmScheme(account) }],
});

const results = [];
let totalSpent = 0;

for (let i = 0; i < ENDPOINTS.length; i++) {
  const ep = ENDPOINTS[i];
  const url = `${TARGET_URL}${ep.path}`;
  const fetchOptions = { method: ep.method };
  if (ep.body) {
    fetchOptions.body = JSON.stringify(ep.body);
    fetchOptions.headers = { "Content-Type": "application/json" };
  }

  process.stdout.write(`[${i + 1}/${ENDPOINTS.length}] ${ep.method} ${ep.path} ... `);

  let httpStatus = null;
  let hash = null;
  let paid = false;

  try {
    const response = await fetchWithPayment(url, fetchOptions);
    httpStatus = response.status;

    const paymentHeader = response.headers.get("PAYMENT-RESPONSE");
    if (paymentHeader) {
      const receipt = decodePaymentResponseHeader(paymentHeader);
      if (receipt?.success) {
        paid = true;
        hash = receipt.transaction || null;
        totalSpent += ep.price;
      }
    }
    console.log(paid ? `OK (HTTP ${httpStatus})` : `ECHEC (HTTP ${httpStatus})`);
  } catch (error) {
    httpStatus = "ERREUR";
    console.log(`ERREUR: ${error?.message || error}`);
  }

  results.push({
    Endpoint: `${ep.method} ${ep.path}`,
    "Statut HTTP": httpStatus,
    "Hash de paiement": hash || "(aucun)",
    Montant: paid ? `$${ep.price.toFixed(3)}` : "-",
  });

  if (i < ENDPOINTS.length - 1) await sleep(PAUSE_MS);
}

console.log("\n=== Resultat ===\n");
console.table(results);
console.log(`\nTotal depense : $${totalSpent.toFixed(3)} (sur ${ENDPOINTS.length} endpoints, ${results.filter((r) => r.Montant !== "-").length} paiement(s) reussi(s))`);
