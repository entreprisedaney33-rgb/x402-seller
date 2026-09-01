// scripts/buyer-test.js — client acheteur de test.
// Appelle /api/defi/tvl sur le serveur local : recoit le 402, paie avec
// BUYER_PRIVATE_KEY via le SDK x402 (@x402/fetch), relance la requete et
// affiche la reponse + le hash de la transaction de paiement.
//
// Usage: npm run buyer-test   (le serveur doit tourner: npm start)
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

const account = privateKeyToAccount(config.buyerPrivateKey);
console.log(`Acheteur : ${account.address}`);
console.log(`Reseau   : ${config.network} (${config.caip2Network})`);

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

const url = `http://localhost:${config.port}/api/defi/tvl?protocol=aave`;
console.log(`Requete  : GET ${url}\n`);

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
    "\nPistes : le serveur tourne-t-il (npm start) ? Le portefeuille acheteur a-t-il des USDC sur " +
      config.network +
      " ?"
  );
  process.exit(1);
}
