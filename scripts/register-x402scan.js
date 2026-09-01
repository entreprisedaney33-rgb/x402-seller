// scripts/register-x402scan.js — registers this server's resources with
// x402scan (x402scan.com / Merit-Systems/x402scan), via its PUBLIC registry
// API. No account/signup involved: the registry write endpoints are gated
// by SIWX (Sign-In-With-X, CAIP-122 wallet-signature auth — an official
// x402 v2 extension, @x402/extensions/sign-in-with-x, already a dependency
// of this project) rather than a payment or a classic username/password
// account. Confirmed live against www.x402scan.com before writing this
// script: an unauthenticated POST to /api/x402/registry/register returns
// 402 with `accepts: []` + a sign-in-with-x challenge in the
// PAYMENT-REQUIRED header — i.e. "prove you control a wallet", not "pay".
//
// Two registry endpoints (see x402scan's own /openapi.json + guidance
// text, and apps/scan/src/app/api/x402/_lib/schemas.ts in its repo):
//   POST /api/x402/registry/register-origin {origin}  — discovers (via our
//     /openapi.json, see openapi.js) and registers ALL of our resources in
//     one call. Used by default here.
//   POST /api/x402/registry/register {url}             — registers exactly
//     one resource URL, no discovery. Used with --url=<full URL>.
//
// Why this isn't just @x402/extensions' wrapFetchWithSIWx: that helper
// bails out (returns the raw 402 unchanged) whenever `accepts` is empty —
// `const paymentNetwork = paymentRequired.accepts?.[0]?.network; if
// (!paymentNetwork) return response;` (read directly from the installed
// package, node_modules/@x402/extensions/dist/esm/chunk-*.mjs). It's built
// for the "already paid, use SIWX to skip re-paying" case. x402scan's
// registry routes are auth-ONLY (`accepts: []`, free) — a case that helper
// doesn't handle, even though the chain to sign for is still right there
// in `extensions["sign-in-with-x"].supportedChains`. So this script
// reproduces the same challenge -> sign -> retry flow by hand, using the
// same lower-level primitives (createSIWxPayload, encodeSIWxHeader,
// decodePaymentRequiredHeader) wrapFetchWithSIWx itself is built on.
//
// Usage: node scripts/register-x402scan.js
//        node scripts/register-x402scan.js --url=https://x402-seller-0ay3.onrender.com/api/gas/base
//        TARGET_URL=https://your-domain node scripts/register-x402scan.js
import { createSIWxPayload, encodeSIWxHeader, SIGN_IN_WITH_X } from "@x402/extensions/sign-in-with-x";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { privateKeyToAccount } from "viem/accounts";
import config from "../config.js";

const X402SCAN_BASE = "https://www.x402scan.com";
const DEFAULT_ORIGIN = "https://x402-seller-0ay3.onrender.com";
const originArg = (process.env.TARGET_URL || DEFAULT_ORIGIN).replace(/\/$/, "");
const urlArg = process.argv.find((a) => a.startsWith("--url="));

if (!config.buyerPrivateKey) {
  console.error(
    "BUYER_PRIVATE_KEY est vide dans le .env — n'importe quelle cle EVM suffit ici (SIWX ne fait\n" +
      "que signer un message, aucun fonds necessaire) : genere-en une avec npm run generate-buyer-wallet."
  );
  process.exit(1);
}

const account = privateKeyToAccount(config.buyerPrivateKey);
console.log(`Identite SIWX : ${account.address}`);

// fetchWithSIWx(url, init) : appelle une fois ; si 402 + challenge
// sign-in-with-x, signe avec `account` et rejoue UNE fois avec l'en-tete
// SIGN-IN-WITH-X. Sinon renvoie la reponse telle quelle.
async function fetchWithSIWx(url, init) {
  const first = await fetch(url, init);
  if (first.status !== 402) return first;

  const header = first.headers.get("PAYMENT-REQUIRED");
  if (!header) return first;

  const paymentRequired = decodePaymentRequiredHeader(header);
  const siwx = paymentRequired.extensions?.[SIGN_IN_WITH_X];
  if (!siwx?.supportedChains?.length) return first;

  // On ne signe QUE pour une chaine EVM (eip191) — le seul type de compte
  // disponible ici (viem PrivateKeyAccount). Si le serveur ne proposait que
  // du Solana (ed25519), on abandonne proprement plutot que d'echouer plus loin.
  const chain = siwx.supportedChains.find((c) => c.type === "eip191") ?? siwx.supportedChains[0];
  if (chain.type !== "eip191") {
    throw new Error(`Aucune chaine EVM proposee par le challenge SIWX (${JSON.stringify(siwx.supportedChains)}).`);
  }

  const completeInfo = { ...siwx.info, chainId: chain.chainId, type: chain.type };
  const payload = await createSIWxPayload(completeInfo, account, first.url || url);
  const siwxHeader = encodeSIWxHeader(payload);

  return fetch(url, { ...init, headers: { ...init.headers, [SIGN_IN_WITH_X]: siwxHeader } });
}

let endpoint, body, label;
if (urlArg) {
  const url = urlArg.slice("--url=".length);
  endpoint = `${X402SCAN_BASE}/api/x402/registry/register`;
  body = { url };
  label = `POST /api/x402/registry/register {url: "${url}"}`;
} else {
  endpoint = `${X402SCAN_BASE}/api/x402/registry/register-origin`;
  body = { origin: originArg };
  label = `POST /api/x402/registry/register-origin {origin: "${originArg}"}`;
}

console.log(`Appel   : ${label}\n`);

const response = await fetchWithSIWx(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const text = await response.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  data = text;
}

console.log(`Statut HTTP : ${response.status}`);
console.log(JSON.stringify(data, null, 2));

if (!response.ok) {
  process.exit(1);
}
