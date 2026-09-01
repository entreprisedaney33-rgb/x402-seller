// lib/x402-client.js — the two call modes for a generated tool:
//   callUnpaid  — no wallet configured: fetch the endpoint anonymously,
//                 expect 402, decode the real (live, not the static
//                 discovery doc's) payment challenge, and explain it.
//   callPaid    — BUYER_PRIVATE_KEY configured: fetch through
//                 wrapFetchWithPaymentFromConfig (@x402/fetch), which signs
//                 and settles the payment automatically, then returns the
//                 real response plus the settlement receipt.
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";

// USDC always uses 6 decimals — true for every accepts[] entry this server
// (x402-seller) declares, since it only ever prices in USDC. Not a general
// ERC-20 decimals lookup.
const USDC_DECIMALS = 6;

function formatAtomicUsdc(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return (n / 10 ** USDC_DECIMALS).toFixed(USDC_DECIMALS).replace(/0+$/, "").replace(/\.$/, "");
}

// buildRequest(resource, args) -> { url, init } — splits the tool call's
// args between query string (GET) and JSON body (POST) per the resource's
// own bazaar schema (see schema.js), never guessing which is which.
export function buildRequest(resource, args, queryNames, bodyNames) {
  const url = new URL(resource.url);
  const init = { method: resource.method, headers: {} };

  if (resource.method === "GET") {
    for (const name of queryNames) {
      if (args[name] !== undefined) url.searchParams.set(name, args[name]);
    }
  } else {
    const body = {};
    for (const name of bodyNames) {
      if (args[name] !== undefined) body[name] = args[name];
    }
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  return { url: url.toString(), init };
}

// callUnpaid(url, init) -> a human/agent-readable explanation of the 402
// challenge actually returned right now by the live endpoint (not the
// static discovery doc — prices/network could differ at call time).
export async function callUnpaid(url, init) {
  const response = await fetch(url, init);

  if (response.status !== 402) {
    // Endpoint answered without requiring payment (a free route, or a
    // validation error on the arguments) — just relay it as-is.
    const text = await response.text();
    return `HTTP ${response.status} (no payment required for this response):\n${text}`;
  }

  const header = response.headers.get("PAYMENT-REQUIRED");
  if (!header) {
    return `HTTP 402 but no PAYMENT-REQUIRED header was present — cannot decode the payment challenge.`;
  }

  let challenge;
  try {
    challenge = decodePaymentRequiredHeader(header);
  } catch (err) {
    return `HTTP 402, but the payment challenge could not be decoded (${err.message}).`;
  }

  const accept = challenge.accepts?.[0];
  const priceUsdc = accept ? formatAtomicUsdc(accept.amount) : "unknown";
  const network = accept?.network || "unknown";
  const asset = accept?.extra?.name || accept?.asset || "USDC";
  const payTo = accept?.payTo || "unknown";

  return [
    `This tool calls a paid x402 endpoint. Payment required, not yet made:`,
    ``,
    `  Price:   $${priceUsdc} ${asset}`,
    `  Network: ${network}`,
    `  Pay to:  ${payTo}`,
    ``,
    `No wallet is configured on this MCP server, so no payment was attempted — this is the`,
    `payment challenge only, not the actual tool result.`,
    ``,
    `To let this server pay automatically and return real results, set the BUYER_PRIVATE_KEY`,
    `environment variable to an EVM private key (0x... form) funded with a small amount of`,
    `USDC on Base, then restart the MCP server (see this package's README, "Enabling payments").`,
    `⚠️ Use a throwaway/dedicated wallet — never a wallet holding significant funds.`,
  ].join("\n");
}

// callPaid(url, init, account) -> the real tool result plus the settlement
// receipt, paid for automatically via @x402/fetch.
export async function callPaid(url, init, account) {
  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: "eip155:*", client: new ExactEvmScheme(account) }],
  });

  const response = await fetchWithPayment(url, init);
  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = bodyText;
  }

  if (!response.ok) {
    return `HTTP ${response.status}:\n${typeof body === "string" ? body : JSON.stringify(body, null, 2)}`;
  }

  const paymentHeader = response.headers.get("PAYMENT-RESPONSE");
  let payment = null;
  if (paymentHeader) {
    try {
      const receipt = decodePaymentResponseHeader(paymentHeader);
      payment = {
        success: receipt?.success ?? null,
        payer: receipt?.payer ?? null,
        transaction: receipt?.transaction ?? null,
        network: receipt?.network ?? null,
      };
    } catch {
      // A malformed receipt header shouldn't hide a real, already-paid result.
    }
  }

  return JSON.stringify({ result: body, payment }, null, 2);
}
