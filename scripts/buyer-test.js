// scripts/buyer-test.js — client acheteur de test.
// Appelle un endpoint payant sur une cible (TARGET_URL) : recoit le 402,
// paie avec BUYER_PRIVATE_KEY via le SDK x402 (@x402/fetch), rejoue la
// requete et affiche la reponse + le recu de paiement.
//
// Cible    : TARGET_URL (env) ou 1er argument CLI, sinon http://localhost:4021.
// Endpoint : ENDPOINT_PATH (env), avec query string incluse (defaut:
//            /api/defi/tvl?protocol=aave, pour ne pas casser les scripts
//            npm existants).
// Methode  : METHOD (env), defaut GET.
// Corps    : BODY (env, chaine JSON), envoye tel quel pour POST/PUT/PATCH.
//
// Usage: npm run buyer-test                                    (defi/tvl, local)
//        npm run buyer-test:prod                                (defi/tvl, Render)
//        ENDPOINT_PATH=/api/defi/price?coins=bitcoin npm run buyer-test
//        ENDPOINT_PATH=/api/ai/summarize METHOD=POST \
//          BODY='{"text":"...","max_sentences":1}' npm run buyer-test
//        node scripts/buyer-test.js https://...
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import config from "../config.js";

if (!config.buyerPrivateKey) {
  console.error(
    "BUYER_PRIVATE_KEY est vide dans le .env.\n" +
      "Genere un portefeuille d'abord : npm run generate-buyer-wallet\n" +
      "puis alimente l'adresse en USDC (base-sepolia : https://faucet.circle.com)."
  );
  process.exit(1);
}

const targetUrl = (process.env.TARGET_URL || process.argv[2] || "http://localhost:4021").replace(/\/$/, "");

const account = privateKeyToAccount(config.buyerPrivateKey);
console.log(`Acheteur : ${account.address}`);
console.log(`Reseau   : ${config.network} (${config.caip2Network})`);
console.log(`Cible    : ${targetUrl}`);

// Ping de reveil : le plan gratuit Render met le service en veille apres
// inactivite et peut prendre jusqu'a ~50 s a redemarrer sur la 1ere requete.
// On mesure ce temps avant l'appel paye (timeout large, 90 s).
console.log(`\nReveil   : GET ${targetUrl}/health (timeout 90 s)...`);
const wakeStart = Date.now();
try {
  const healthResponse = await fetch(`${targetUrl}/health`, {
    signal: AbortSignal.timeout(90_000),
  });
  const wakeMs = Date.now() - wakeStart;
  if (!healthResponse.ok) {
    console.error(`/health a repondu HTTP ${healthResponse.status} apres ${(wakeMs / 1000).toFixed(1)} s.`);
    process.exit(1);
  }
  console.log(`Reveille en ${(wakeMs / 1000).toFixed(1)} s (HTTP ${healthResponse.status}).`);
} catch (error) {
  const wakeMs = Date.now() - wakeStart;
  console.error(`/health injoignable apres ${(wakeMs / 1000).toFixed(1)} s : ${error?.message || error}`);
  process.exit(1);
}

// fetch enrobe : sur un 402, il lit les exigences de paiement, signe le
// paiement USDC avec le compte, et rejoue la requete avec l'en-tete PAYMENT.
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [
    {
      network: "eip155:*", // toutes les chaines EVM (base-sepolia comme base)
      client: new ExactEvmScheme(account),
    },
  ],
});

const endpointPath = process.env.ENDPOINT_PATH || "/api/defi/tvl?protocol=aave";
const httpMethod = (process.env.METHOD || "GET").toUpperCase();
const bodyRaw = process.env.BODY;

const url = `${targetUrl}${endpointPath}`;
const fetchOptions = { method: httpMethod };
if (bodyRaw && ["POST", "PUT", "PATCH"].includes(httpMethod)) {
  try {
    JSON.parse(bodyRaw); // valide le JSON avant l'appel, message clair sinon
  } catch (err) {
    console.error(`BODY n'est pas du JSON valide : ${err.message}`);
    process.exit(1);
  }
  fetchOptions.body = bodyRaw;
  fetchOptions.headers = { "Content-Type": "application/json" };
}

console.log(`\nRequete  : ${httpMethod} ${url}`);
if (fetchOptions.body) console.log(`Corps    : ${fetchOptions.body}`);
console.log();

try {
  const response = await fetchWithPayment(url, fetchOptions);

  if (!response.ok) {
    console.error(`Echec HTTP ${response.status}:`);
    console.error(await response.text());
    process.exit(1);
  }

  const data = await response.json();
  console.log("Reponse de l'API :");
  console.log(JSON.stringify(data, null, 2));

  const paymentHeader = response.headers.get("PAYMENT-RESPONSE");
  if (paymentHeader) {
    const receipt = decodePaymentResponseHeader(paymentHeader);
    console.log("\nRecu de paiement x402 :");
    console.log(JSON.stringify(receipt, null, 2));
    if (receipt?.transaction) {
      const explorer = config.isMainnet
        ? "https://basescan.org/tx/"
        : "https://sepolia.basescan.org/tx/";
      console.log(`\nHash de paiement : ${receipt.transaction}`);
      console.log(`Explorateur      : ${explorer}${receipt.transaction}`);
    }
  } else {
    console.log("\n(Aucun en-tete PAYMENT-RESPONSE — l'endpoint etait peut-etre gratuit.)");
  }
} catch (error) {
  console.error("Echec de l'appel paye :", error?.message || error);
  console.error(
    `\nPistes : le serveur (${targetUrl}) est-il bien joignable ? Le portefeuille acheteur a-t-il des USDC sur ` +
      config.network +
      " ?"
  );
  process.exit(1);
}
