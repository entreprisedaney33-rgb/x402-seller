---
title: I Built an API That AI Agents Pay in USDC — Full x402 Walkthrough (27 Endpoints, Real Transactions)
published: false
tags: ai, web3, node, api
---

I built an Express API that AI agents (or humans, or anything with `fetch`) can pay per call, in USDC, with no signup and no API key. It's live on Base mainnet with 27 paid endpoints, and I've run real settled transactions against it. This is the technical walkthrough — the code, the protocol, and the things that actually broke — not an "agentic economy" pitch.

## What x402 is, in 5 lines

`x402` resurrects the dormant HTTP `402 Payment Required` status code as a real payment handshake. A client calls a paid route → the server replies `402` with payment requirements (amount, asset, network) instead of the resource → the client signs a USDC transfer on Base and replays the request with a `PAYMENT` header → a **facilitator** (a third party, or Coinbase's CDP service in production) verifies and settles the transfer on-chain → the server serves the response. No account creation, no API key issuance, no OAuth dance — the wallet address *is* the identity, and payment *is* the auth.

## The seller side

The server is plain Express. Each endpoint is a file in `endpoints/` exporting `{ path, method, price, handler }`; `server.js` loads them all, builds the x402 route table, and mounts one middleware:

```js
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createFacilitatorConfig } from "@coinbase/x402";

const facilitatorConfig = config.isMainnet
  ? createFacilitatorConfig(config.cdpApiKeyId, config.cdpApiKeySecret)
  : { url: config.testnetFacilitatorUrl }; // https://x402.org/facilitator, no key

const facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig);
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  config.caip2Network, // "eip155:8453" on mainnet
  new ExactEvmScheme()
);

const paidRoutes = {};
for (const ep of endpoints) {
  if (ep.price == null) continue;
  paidRoutes[`${ep.method} ${ep.path}`] = {
    accepts: { scheme: "exact", price: ep.price, network: config.caip2Network, payTo: config.payToAddress },
    resource: `${config.baseUrl}${ep.path}`,
    description: ep.description,
    mimeType: "application/json",
  };
}

app.use(paymentMiddleware(paidRoutes, resourceServer));
```

That's the entire payment layer. `@x402/express` handles the 402 response and calls the facilitator's `verify`/`settle` — the endpoint handler never sees a wallet address or a signature, only a normal `req`/`res`.

Here's a full endpoint, `GET /api/gas/base` (versions in use: `@x402/express`, `@x402/core`, `@x402/evm`, `@x402/extensions`, `@x402/fetch` all `2.24.0`, `@coinbase/x402` `2.1.0` — the scoped `@x402/*` line is current v2; the older unscoped `x402-express`/`x402-fetch` are deprecated, don't mix them):

```js
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { getGasPrice } from "../lib/chains.js";
import { cached } from "../lib/cache.js";

export const path = "/api/gas/base";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Current gas price on Base (Ethereum L2), read live via a public RPC endpoint — no API key, no aggregator.";

export const discovery = declareDiscoveryExtension({
  input: {},
  inputSchema: { properties: {}, required: [] },
  output: { example: { chain: "base", gas_price_wei: "6000000", gas_price_gwei: 0.006 } },
});

export async function handler(req, res) {
  const gasPriceWei = await cached("gas-base", 60_000, () => getGasPrice("base"));
  res.json({
    chain: "base",
    gas_price_wei: gasPriceWei.toString(),
    gas_price_gwei: Number(gasPriceWei) / 1e9,
    fetched_at: new Date().toISOString(),
  });
}
```

No blockchain code in the handler — `viem` reads gas price from a public RPC. `price`/`discovery` are just metadata consumed elsewhere (the middleware, and the discovery documents below).

## The buyer side

`@x402/fetch` wraps `fetch` so it transparently handles the 402 → sign → replay cycle. A minimal buyer:

```js
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(BUYER_PRIVATE_KEY);

const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:*", client: new ExactEvmScheme(account) }],
});

const response = await fetchWithPayment("https://x402-seller-0ay3.onrender.com/api/gas/base");
const data = await response.json();

const receipt = decodePaymentResponseHeader(response.headers.get("PAYMENT-RESPONSE"));
console.log(receipt.transaction); // the on-chain settlement hash
```

Under the hood: first call gets `402` + payment requirements, `ExactEvmScheme` signs a USDC transfer authorization for the exact price, the wrapper replays the request with a `PAYMENT` header, the facilitator settles it, and the response carries a `PAYMENT-RESPONSE` header with the receipt. This isn't a simulation — here's an actual settled transaction from a real run against the production server:

```
GET /api/gas/base — $0.005 USDC
tx: 0x4c3c38d0a7732244caf895d32a46e5e1fa780abdf4216b3c3fa28bb496062646
https://basescan.org/tx/0x4c3c38d0a7732244caf895d32a46e5e1fa780abdf4216b3c3fa28bb496062646
```

Every settled payment is logged server-side (endpoint, payer address, amount, tx hash — nothing that isn't already public on-chain), which is where that hash comes from.

## Discovery: how does an agent even find this API?

Payment infra is useless if nothing finds your endpoints. Five discovery surfaces, in the order I wired them up:

- **`GET /.well-known/x402.json`** — a self-hosted manifest listing every paid route with its price, network, `payTo`, and input/output schema. There's no single official schema for this exact path; I followed the envelope from the IETF draft *"Discovering x402 Payment Capability via DNS and a Well-Known URI"* (`x402Version`, `kind`, `resources[]`) and enriched each resource with the same Bazaar metadata used elsewhere.
- **`GET /openapi.json`** — an OpenAPI document generated from the same endpoint list, because several x402 directories (x402scan among them) prefer discovering via OpenAPI over a custom format.
- **CDP's Bazaar** — the "official" x402 discovery index, but it lives on the *facilitator* side, not the server. There's no registration call: the facilitator's catalog builds itself from payments it has already settled. I wrote a script (`npm run bazaar`) that pages through `facilitatorClient.extensions.bazaar.listResources()` and filters for our `payTo` address to confirm we're actually indexed.
- **x402scan** — a community directory with its own registry API, gated by Sign-In-With-X (a wallet-signature challenge, CAIP-122 style) rather than payment or a classic account. A `POST /api/x402/registry/register-origin {origin}` call makes it crawl our `/openapi.json` and register everything in one shot.
- **x402 Arena** — another community directory for x402 servers, registered with a plain `POST core.x402arena.gg/register` against our `/api/gas/base` endpoint. No facilitator involvement, no on-chain proof required at registration time — it shows up `verified:true` in their public agent list (`GET core.x402arena.gg/agents`) after a health check against the live endpoint.

## Pitfalls, in the order I actually hit them

- **Missing `User-Agent` → silent 403 from Cloudflare.** RDAP lookups (`rdap.org`) and a couple of other upstream sources return a flat 403 to anonymous-looking requests. Fix was a one-line default: every outbound `fetch` in this project now sends a descriptive UA (`x402-seller/1.0 (+https://...)`).  Confirmed by testing: 403 with no UA, 200 with one, same request otherwise.
- **GitHub's unauthenticated rate limit is 60 req/hour.** Fine for local dev, embarrassing in production the moment a second agent tries the endpoint. An optional `GITHUB_TOKEN` (no scopes needed — it's all public repo data) raises that to 5000/hour.
- **Render's free-tier disk is ephemeral.** Payment and probe logs are plain append-only `.jsonl` files on disk for simplicity — which is fine until a redeploy wipes the disk and takes the logs with it. Fixed since: a `DATA_DIR` env var now points the logs at a 1GB Render persistent disk mounted on `/var/data`. Verified, not assumed — paid for a real call, redeployed, and the payment was still there in `/stats` afterward. Trade-off worth knowing: once a disk is attached, deploys stop being zero-downtime (Render stops the old instance before starting the new one).
- **SSRF on a "read any URL" endpoint.** `POST /api/web/read` fetches an arbitrary URL and returns readable Markdown — an obvious target for hitting `169.254.169.254` or `localhost:6379`. It's guarded on both the initial hostname *and* every redirect hop: DNS-resolve, classify every resulting IP with `ipaddr.js`, refuse anything that isn't `unicast` (public), reject literal `localhost`/loopback/link-local hostnames outright, and cap the download at 2 MB inside a 10 s timeout regardless.
- **GitBook docs vs. what's actually on npm.** The docs at `x402.gitbook.io` still reference some v1, unscoped package names in places; what's actually current and maintained is the scoped `@x402/*` line (`2.24.0` as of this writing). When something in the docs didn't match `node_modules`, I trusted the installed package and its own type definitions over the prose.

## Being honest about this

The x402 ecosystem is small right now. Traffic on this server is basically me testing it, plus whatever probes discovery crawlers send. This post is a "here's how the plumbing works and here's the code," not a revenue story — I have no evidence yet that agents are out there autonomously discovering and paying for API calls at any real scale. If that changes, that's a different post.

## Try it yourself

Base URL: `https://x402-seller-0ay3.onrender.com`. All 27 endpoints below are real and callable; each costs a fraction of a cent, so poking at a few won't cost you anything meaningful. `GET /health`, `GET /stats`, and the two discovery documents are free.

| Method | Path | Price |
|---|---|---|
| GET | `/api/price/eth-usd` | $0.005 |
| GET | `/api/price/btc-usd` | $0.005 |
| GET | `/api/price/sol-usd` | $0.005 |
| GET | `/api/price/usdc-supply` | $0.005 |
| GET | `/api/gas/base` | $0.005 |
| GET | `/api/gas/ethereum` | $0.005 |
| GET | `/api/chain/gas` | $0.005 |
| GET | `/api/chain/block` | $0.005 |
| GET | `/api/defi/price` | $0.005 |
| GET | `/api/defi/tvl` | $0.005 |
| GET | `/api/defi/tvl-chain` | $0.005 |
| GET | `/api/defi/protocols` | $0.005 |
| GET | `/api/defi/yields` | $0.005 |
| GET | `/api/defi/stablecoins` | $0.005 |
| GET | `/api/fx/rates` | $0.005 |
| GET | `/api/github/repo` | $0.005 |
| GET | `/api/npm/package` | $0.005 |
| GET | `/api/hn/top` | $0.005 |
| GET | `/api/wiki/summary` | $0.005 |
| GET | `/api/dns/lookup` | $0.005 |
| GET | `/api/rdap/domain` | $0.005 |
| POST | `/api/web/read` | $0.005 |
| POST | `/api/web/extract` | $0.02 |
| POST | `/api/ai/summarize` | $0.01 |
| POST | `/api/ai/classify` | $0.01 |
| POST | `/api/ai/translate` | $0.01 |
| POST | `/api/ai/extract` | $0.02 |

Two full examples with `@x402/fetch` (swap in your own funded Base wallet):

```bash
# GET, no body
ENDPOINT_PATH="/api/gas/base" \
TARGET_URL="https://x402-seller-0ay3.onrender.com" \
node scripts/buyer-test.js
```

```bash
# POST, with a JSON body
ENDPOINT_PATH="/api/web/read" METHOD=POST \
BODY='{"url":"https://en.wikipedia.org/wiki/HTTP_402"}' \
TARGET_URL="https://x402-seller-0ay3.onrender.com" \
node scripts/buyer-test.js
```

Both print the response JSON and the settlement receipt, hash included. `GET /.well-known/x402.json` and `GET /openapi.json` list every route with full input/output schemas if you want to build a client instead of copy-pasting curl.
