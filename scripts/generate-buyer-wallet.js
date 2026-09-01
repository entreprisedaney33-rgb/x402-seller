// scripts/generate-buyer-wallet.js — genere une cle privee EVM aleatoire (viem),
// l'ecrit dans BUYER_PRIVATE_KEY du .env si elle est vide, et affiche l'adresse.
//
// Usage: npm run generate-buyer-wallet
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));

if (!existsSync(envPath)) {
  console.error("Fichier .env introuvable. Copie .env.example vers .env d'abord.");
  process.exit(1);
}

const envContent = readFileSync(envPath, "utf8");
const match = envContent.match(/^BUYER_PRIVATE_KEY=(.*)$/m);
const existing = match ? match[1].trim() : null;

if (existing) {
  const account = privateKeyToAccount(existing);
  console.log("BUYER_PRIVATE_KEY est deja renseignee dans le .env — rien n'a ete ecrase.");
  console.log(`Adresse publique de l'acheteur : ${account.address}`);
  process.exit(0);
}

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

let updated;
if (match) {
  updated = envContent.replace(/^BUYER_PRIVATE_KEY=.*$/m, `BUYER_PRIVATE_KEY=${privateKey}`);
} else {
  updated = envContent.replace(/\n*$/, "\n") + `BUYER_PRIVATE_KEY=${privateKey}\n`;
}
writeFileSync(envPath, updated);

console.log("Nouvelle cle privee acheteur generee et ecrite dans .env (BUYER_PRIVATE_KEY).");
console.log(`Adresse publique de l'acheteur : ${account.address}`);
console.log("");
console.log("Pour payer sur base-sepolia, alimente cette adresse en USDC de test :");
console.log("  https://faucet.circle.com (USDC, reseau Base Sepolia)");
