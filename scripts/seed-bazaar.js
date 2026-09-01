// scripts/seed-bazaar.js — appelle chaque endpoint payant DECOUVERT
// DYNAMIQUEMENT via GET {TARGET_URL}/.well-known/x402.json, avec un vrai
// paiement, pour que le facilitateur CDP les catalogue dans son index
// Bazaar (le catalogue se construit a partir des paiements deja traites,
// cf. scripts/check-bazaar.js). Aucune liste d'endpoints codee en dur : la
// SEULE partie fixe du script est la table d'EXEMPLES ci-dessous (comment
// appeler chaque chemin), lue par chemin — un endpoint sans exemple est
// simplement signale et saute, jamais appele a l'aveugle.
//
// Reveil du serveur d'abord (plan gratuit Render), puis chaque endpoint en
// sequence avec 2 s de pause entre chaque appel. Un echec sur un endpoint
// n'interrompt pas les suivants.
//
// Usage: npm run seed
//        npm run seed -- --only=/api/gas/base,/api/gas/ethereum
//        TARGET_URL=http://localhost:4021 npm run seed -- --only=/api/web/read
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import config from "../config.js";

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

// Table d'exemples valides, indexee par CHEMIN SANS query string. C'est la
// SEULE liste codee en dur de ce script — tout le reste (quels endpoints
// existent, leur methode, leur prix) vient de .well-known/x402.json.
//   - GET  : { query: "a=b&c=d" }  (query string a coller telle quelle ;
//            omise ou vide = endpoint sans parametre)
//   - POST : { body: {...} }        (corps JSON)
const EXAMPLES = {
  "/api/defi/tvl": { query: "protocol=aave" },
  "/api/defi/price": { query: "coins=ethereum,bitcoin" },
  "/api/defi/tvl-chain": { query: "chain=base" },
  "/api/defi/protocols": { query: "limit=3" },
  "/api/defi/yields": { query: "chain=base&min_tvl=1000000&limit=3" },
  "/api/defi/stablecoins": { query: "limit=3" },
  "/api/chain/gas": { query: "chain=base" },
  "/api/chain/block": { query: "chain=base" },
  "/api/gas/base": {},
  "/api/gas/ethereum": {},
  "/api/price/eth-usd": {},
  "/api/price/btc-usd": {},
  "/api/price/sol-usd": {},
  "/api/price/usdc-supply": {},
  "/api/fx/rates": { query: "base=EUR" },
  "/api/github/repo": { query: "full_name=expressjs/express" },
  "/api/npm/package": { query: "name=express" },
  "/api/hn/top": { query: "limit=3" },
  "/api/wiki/summary": { query: "title=Bitcoin&lang=en" },
  "/api/dns/lookup": { query: "domain=example.com" },
  "/api/rdap/domain": { query: "domain=example.com" },
  "/api/web/read": { body: { url: "https://en.wikipedia.org/wiki/HTTP_402" } },
  "/api/web/extract": {
    body: {
      url: "https://en.wikipedia.org/wiki/HTTP_402",
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          first_paragraph: { type: "string" },
        },
      },
    },
  },
  "/api/ai/summarize": {
    body: {
      text:
        "L'entreprise Nordev Solutions a annonce aujourd'hui les resultats de son troisieme trimestre, marques par une croissance de 18% du chiffre d'affaires par rapport a l'annee precedente. Cette progression s'explique principalement par l'expansion de son offre de services cloud aupres des petites et moyennes entreprises, ainsi que par l'ouverture de deux nouveaux bureaux regionaux a Lyon et Toulouse. Le directeur general, Marc Bertillon, a souligne que cette dynamique s'accompagne d'un investissement accru dans la recherche et developpement, avec un budget qui a double sur les douze derniers mois.\n\nMalgre ce contexte favorable, l'entreprise fait face a des defis importants sur le plan du recrutement. Le secteur technologique connait actuellement une penurie de profils qualifies, en particulier dans les domaines de la cybersecurite et de l'intelligence artificielle. Pour y remedier, Nordev Solutions a lance un partenariat avec trois ecoles d'ingenieurs afin de former directement les futurs talents selon ses besoins specifiques, et a egalement mis en place un programme de mobilite interne pour retenir ses employes actuels.\n\nPour le dernier trimestre de l'annee, la direction reste prudente mais optimiste. Elle table sur une poursuite de la croissance, tout en restant attentive a l'evolution du contexte economique general et aux eventuelles tensions sur les couts d'approvisionnement en materiel informatique. Un point d'etape complet sera presente lors de l'assemblee generale prevue en fevrier prochain.",
      max_sentences: 3,
    },
  },
  "/api/ai/classify": {
    body: {
      text:
        "Bonjour, je vous ecris car le produit que j'ai recu la semaine derniere presente un defaut de fabrication sur le boitier, et il ne s'allume plus depuis hier. J'aimerais savoir comment proceder pour un remboursement ou un echange, car ce n'est clairement pas normal pour un article recu il y a a peine dix jours. Merci de me repondre rapidement. Cordialement, Sophie Marchand.",
      labels: ["devis", "reclamation", "autre"],
    },
  },
  "/api/ai/translate": {
    body: {
      text: "Notre equipe technique a corrige le probleme et le service devrait fonctionner normalement d'ici la fin de la journee.",
      target_lang: "English",
    },
  },
  "/api/ai/extract": {
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
};

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
if (ONLY) console.log(`Filtre   : --only=${[...ONLY].join(",")}`);

// Reveil du serveur (plan gratuit Render) avant tout appel, y compris la
// lecture de .well-known/x402.json.
console.log(`\nReveil   : GET ${TARGET_URL}/health (timeout 90 s)...`);
const wakeStart = Date.now();
try {
  const healthResponse = await fetch(`${TARGET_URL}/health`, { signal: AbortSignal.timeout(90_000) });
  const wakeMs = Date.now() - wakeStart;
  if (!healthResponse.ok) {
    console.error(`/health a repondu HTTP ${healthResponse.status} apres ${(wakeMs / 1000).toFixed(1)} s.`);
    process.exit(1);
  }
  console.log(`Reveille en ${(wakeMs / 1000).toFixed(1)} s (HTTP ${healthResponse.status}).`);
} catch (error) {
  console.error(`/health injoignable : ${error?.message || error}`);
  process.exit(1);
}

// --- Decouverte dynamique des endpoints payants -----------------------------

console.log(`\nDecouverte : GET ${TARGET_URL}/.well-known/x402.json...`);
let discoveryDoc;
try {
  const discoveryResponse = await fetch(`${TARGET_URL}/.well-known/x402.json`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!discoveryResponse.ok) {
    console.error(`.well-known/x402.json a repondu HTTP ${discoveryResponse.status}.`);
    process.exit(1);
  }
  discoveryDoc = await discoveryResponse.json();
} catch (error) {
  console.error(`.well-known/x402.json injoignable ou illisible : ${error?.message || error}`);
  process.exit(1);
}

const resources = Array.isArray(discoveryDoc.resources) ? discoveryDoc.resources : [];
if (resources.length === 0) {
  console.error("Aucune ressource payante annoncee dans .well-known/x402.json.");
  process.exit(1);
}

const discovered = resources.map((r) => {
  const url = new URL(r.url);
  const priceRaw = r.accepts?.[0]?.price;
  return {
    path: url.pathname,
    method: (r.method || "GET").toUpperCase(),
    price: typeof priceRaw === "string" ? Number(priceRaw.replace(/^\$/, "")) : Number(priceRaw) || 0,
  };
});

console.log(`${discovered.length} endpoint(s) payant(s) decouvert(s).`);

// Applique --only, en signalant tout chemin demande mais introuvable
// (typo probable) plutot que de l'ignorer en silence.
let toSeed = discovered;
if (ONLY) {
  const foundPaths = new Set(discovered.map((e) => e.path));
  for (const wanted of ONLY) {
    if (!foundPaths.has(wanted)) {
      console.warn(`⚠️  --only demande "${wanted}", introuvable dans .well-known/x402.json — ignore.`);
    }
  }
  toSeed = discovered.filter((e) => ONLY.has(e.path));
}

// Associe chaque endpoint a son exemple ; sans exemple, on signale et on
// saute (jamais d'appel a l'aveugle sur un endpoint inconnu du script).
const withExamples = [];
for (const ep of toSeed) {
  const example = EXAMPLES[ep.path];
  if (!example) {
    console.warn(`⚠️  Pas d'exemple pour ${ep.method} ${ep.path} dans EXAMPLES — endpoint saute.`);
    continue;
  }
  withExamples.push({ ...ep, ...example });
}

if (withExamples.length === 0) {
  console.error("\nAucun endpoint a appeler (filtre --only vide, ou aucun exemple disponible).");
  process.exit(1);
}

console.log(`${withExamples.length} endpoint(s) a appeler, pause de ${PAUSE_MS / 1000}s entre chaque.\n`);

// --- Appels payes -----------------------------------------------------------

const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:*", client: new ExactEvmScheme(account) }],
});

const results = [];
let totalSpent = 0;

for (let i = 0; i < withExamples.length; i++) {
  const ep = withExamples[i];
  const url = ep.query ? `${TARGET_URL}${ep.path}?${ep.query}` : `${TARGET_URL}${ep.path}`;
  const fetchOptions = { method: ep.method };
  if (ep.body) {
    fetchOptions.body = JSON.stringify(ep.body);
    fetchOptions.headers = { "Content-Type": "application/json" };
  }

  process.stdout.write(`[${i + 1}/${withExamples.length}] ${ep.method} ${ep.path} ... `);

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

  if (i < withExamples.length - 1) await sleep(PAUSE_MS);
}

console.log("\n=== Resultat ===\n");
console.table(results);
console.log(
  `\nTotal depense : $${totalSpent.toFixed(3)} (sur ${withExamples.length} endpoint(s) appele(s), ` +
    `${results.filter((r) => r.Montant !== "-").length} paiement(s) reussi(s))`
);
