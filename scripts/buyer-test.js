// scripts/buyer-test.js — client acheteur de test.
// Appelle /api/defi/tvl sur une cible (TARGET_URL) : recoit le 402, paie avec
// BUYER_PRIVATE_KEY via le SDK x402 (@x402/fetch), relance la requete et
// affiche la reponse + le hash de la transaction de paiement.
//
// Cible : variable d'environnement TARGET_URL, ou 1er argument CLI, sinon
// http://localhost:4021 par defaut.
// Usage: npm run buyer-test               (serveur local: npm start)
//        npm run buyer-test:prod          (serveur Render)
//        TARGET_URL=https://... node scripts/buyer-test.js
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

const url = `${targetUrl}/api/defi/tvl?protocol=aave`;
console.log(`\nRequete  : GET ${url}\n`);

try {
  const response = await fetchWithPayment(url, { method: "GET" });

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
