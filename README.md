# cryptomonnaie — pay-per-call API over x402

An Express server that sells paid API endpoints over the **x402** protocol
(**USDC** payments on **Base**), built to be consumed by AI agents.

A client (human or agent) calls a paid endpoint → the server replies
`402 Payment Required` with the payment requirements → the client signs a
USDC payment and replays the request with the `PAYMENT` header → a
**facilitator** verifies and settles the payment on-chain → the server
serves the response. No blockchain key management server-side: it only
holds the receiving address.

## Available endpoints

All `/api/*` routes are paid (x402 payment required), except `/health`,
`/stats`, and `/.well-known/x402.json`, which are free. Every response is
clean JSON — never a raw 500, always `{error: "..."}` with the right HTTP
status code on any problem (validation, upstream source down, etc.).

Replace `$URL` with the server's URL (`http://localhost:4021` locally, the
Render URL in production) in the examples below.

### Crypto prices & gas (dedicated routes, optimized for agent search)

| Endpoint | Price | Example |
|---|---|---|
| `GET /api/price/eth-usd` | $0.005 | `curl "$URL/api/price/eth-usd"` |
| `GET /api/price/btc-usd` | $0.005 | `curl "$URL/api/price/btc-usd"` |
| `GET /api/price/sol-usd` | $0.005 | `curl "$URL/api/price/sol-usd"` |
| `GET /api/price/usdc-supply` | $0.005 | `curl "$URL/api/price/usdc-supply"` |
| `GET /api/gas/base` | $0.005 | `curl "$URL/api/gas/base"` |
| `GET /api/gas/ethereum` | $0.005 | `curl "$URL/api/gas/ethereum"` |

These are thin, single-purpose wrappers around the same sources as
`/api/defi/price` and `/api/chain/gas` below — kept as separate routes (with
narrow, intent-matching descriptions) so an agent searching for e.g. "ETH
price USD" or "gas price Base" finds and calls them directly, instead of
having to first discover the generic parameterized endpoint.

### Crypto / DeFi data (source [DefiLlama](https://defillama.com), free and open)

> ⚠️ **License note**: DefiLlama's terms of service restrict their free API
> to personal, non-commercial use and prohibit commercial exploitation of
> the data without prior written agreement (defillama.com/terms, clauses 7
> and 8.10). These endpoints (plus the 6 `/api/price/*` and `/api/gas/*`
> ones above, and the 4 `/api/defi/yields/*` sub-routes below, all of
> which reuse the same DefiLlama sources) are built on it anyway, on the
> explicit and informed decision of this service's operator (compliance
> risk accepted) — to be revisited if DefiLlama raises the issue, or by
> moving to their paid Pro API (pro-api.llama.fi) if needed.

| Endpoint | Price | Example |
|---|---|---|
| `GET /api/defi/price` | $0.005 | `curl "$URL/api/defi/price?coins=ethereum,bitcoin"` |
| `GET /api/defi/tvl` | $0.005 | `curl "$URL/api/defi/tvl?protocol=aave"` |
| `GET /api/defi/tvl-chain` | $0.005 | `curl "$URL/api/defi/tvl-chain?chain=base"` |
| `GET /api/defi/protocols` | $0.005 | `curl "$URL/api/defi/protocols?limit=20"` |
| `GET /api/defi/yields` | $0.005 | `curl "$URL/api/defi/yields?chain=base&min_tvl=1000000"` |
| `GET /api/defi/yields/top` | $0.005 | `curl "$URL/api/defi/yields/top?limit=10&min_tvl=10000000"` |
| `GET /api/defi/yields/by-token` | $0.005 | `curl "$URL/api/defi/yields/by-token?symbol=USDC&limit=10"` |
| `GET /api/defi/yields/by-chain` | $0.005 | `curl "$URL/api/defi/yields/by-chain?chain=base&limit=10"` |
| `GET /api/defi/yields/pool` | $0.005 | `curl "$URL/api/defi/yields/pool?pool=<pool id>"` |
| `GET /api/defi/stablecoins` | $0.005 | `curl "$URL/api/defi/stablecoins?limit=20"` |

`/api/defi/yields/top`, `/by-token`, `/by-chain`, and `/pool` are dedicated, intent-matching
routes alongside the generic `/api/defi/yields` — for an agent searching "best yield for
USDC" or "best yields on Base" rather than discovering the generic parameterized endpoint
first (same rationale as the dedicated `/api/price/*` and `/api/gas/*` routes above).
`/pool` returns one pool's detail plus its last 30 recorded APY/TVL data points, via
DefiLlama's `yields.llama.fi/chart/{pool}` (verified live against the current DefiLlama
docs before use — see `endpoints/defi-yields-pool.js` for a note on a doc/reality
mismatch found in the process: the docs list `/chart/{pool}`'s base URL as `api.llama.fi`,
but only `yields.llama.fi` actually serves it; `api.llama.fi/chart/{pool}` 404s).

### On-chain data (public RPC reads via `viem`, no third-party API)

| Endpoint | Price | Example |
|---|---|---|
| `GET /api/chain/gas` | $0.005 | `curl "$URL/api/chain/gas?chain=base"` (or `chain=ethereum`) |
| `GET /api/chain/block` | $0.005 | `curl "$URL/api/chain/block?chain=base"` |

### Web reading & extraction (fetch, readability, and — for extract — Claude Haiku 4.5)

| Endpoint | Price | Example |
|---|---|---|
| `POST /api/web/read` | $0.005 | `curl -X POST "$URL/api/web/read" -H "Content-Type: application/json" -d '{"url":"https://en.wikipedia.org/wiki/HTTP_402"}'` |
| `POST /api/web/extract` | $0.02 | `curl -X POST "$URL/api/web/extract" -H "Content-Type: application/json" -d '{"url":"...","schema":{"type":"object","properties":{"title":{"type":"string"}}}}'` |

`POST /api/web/read` downloads a page and returns its main content as clean
Markdown (readability extraction — boilerplate/nav/ads stripped), so an
agent never has to parse raw HTML. `POST /api/web/extract` does the same
fetch, then extracts structured JSON from the page according to a
caller-supplied JSON Schema, via Claude Haiku 4.5 — one call instead of
read-then-extract. Both are guarded against SSRF (see `lib/web.js`): the
target URL must be public http(s), private/loopback/link-local/reserved IP
ranges are refused (checked both on the initial host and on every redirect
hop), the download is capped at 2 MB within a 10 s budget, and the site's
`robots.txt` is honored (fails open — i.e. allows the fetch — only when
`robots.txt` itself is unreachable, the same convention real crawlers use).

### Open public data

| Endpoint | Price | Source / license | Example |
|---|---|---|---|
| `GET /api/fx/rates` | $0.005 | Frankfurter (MIT, open ECB data) | `curl "$URL/api/fx/rates?base=EUR"` |
| `GET /api/github/repo` | $0.005 | GitHub REST API | `curl "$URL/api/github/repo?full_name=expressjs/express"` |
| `GET /api/npm/package` | $0.005 | registry.npmjs.org + api.npmjs.org | `curl "$URL/api/npm/package?name=express"` |
| `GET /api/hn/top` | $0.005 | Hacker News Firebase API (MIT) | `curl "$URL/api/hn/top?limit=20"` |
| `GET /api/wiki/summary` | $0.005 | Wikimedia REST API (CC BY-SA 4.0, attribution included in the response) | `curl "$URL/api/wiki/summary?title=Bitcoin&lang=en"` |
| `GET /api/dns/lookup` | $0.005 | Direct DNS resolution (Node's `dns` module) | `curl "$URL/api/dns/lookup?domain=example.com"` |
| `GET /api/rdap/domain` | $0.005 | rdap.org (open protocol, WHOIS's successor) | `curl "$URL/api/rdap/domain?domain=example.com"` |

### AI tasks (Claude Haiku 4.5, ANTHROPIC_API_KEY required)

| Endpoint | Price | Example |
|---|---|---|
| `POST /api/ai/summarize` | $0.01 | `curl -X POST "$URL/api/ai/summarize" -H "Content-Type: application/json" -d '{"text":"...","max_sentences":3}'` |
| `POST /api/ai/classify` | $0.01 | `curl -X POST "$URL/api/ai/classify" -H "Content-Type: application/json" -d '{"text":"...","labels":["positive","negative","neutral"]}'` |
| `POST /api/ai/translate` | $0.01 | `curl -X POST "$URL/api/ai/translate" -H "Content-Type: application/json" -d '{"text":"...","target_lang":"French"}'` |
| `POST /api/ai/extract` | $0.02 | `curl -X POST "$URL/api/ai/extract" -H "Content-Type: application/json" -d '{"text":"...","schema":{"type":"object","properties":{"total":{"type":"number"}}}}'` |

### Premium reseller (Tavily, Serper — real third-party providers, real margin)

| Endpoint | Price | Example |
|---|---|---|
| `POST /api/search/web` | $0.01 | `curl -X POST "$URL/api/search/web" -H "Content-Type: application/json" -d '{"query":"latest developments in the x402 protocol","num_results":5}'` |
| `POST /api/search/serp` | $0.005 | `curl -X POST "$URL/api/search/serp" -H "Content-Type: application/json" -d '{"query":"best crypto payment protocols 2026","country":"us"}'` |
| `POST /api/web/scrape` | $0.02 | `curl -X POST "$URL/api/web/scrape" -H "Content-Type: application/json" -d '{"url":"https://en.wikipedia.org/wiki/HTTP_402"}'` |

Unlike the rest of this server (free/public sources, or a flat-rate AI call), this
family resells a paid upstream provider's API per call — so margin, compliance, and
upstream outages are real, ongoing concerns, tracked deliberately rather than assumed
away.

**Compliance basis (verified before writing any code, not assumed).** The brief named
Exa, Serper, and Firecrawl as candidates. Both Exa and Firecrawl were **rejected**: their
Terms of Service explicitly forbid reselling API output in a commercial product without
prior written consent (Exa ToS §4.2(a)(e)(f): no distributing/publishing/offering-for-sale
of anything obtained via the Services, no reselling, no building a competitive product;
Firecrawl ToS: "Use the Services for any commercial purposes except as expressly
authorized by Firecrawl" plus a separate "sell, distribute... based on the Services"
prohibition). Two replacements were researched and picked instead:

- **Tavily** (`api.tavily.com`) — replaces Exa for `/api/search/web` and provides
  `/api/web/scrape`. Its ToS (tavily.com/terms) contains an explicit carve-out for exactly
  this architecture: §3.2 bans reselling/sublicensing the Services *except* "integration
  of the Services in Customer Applications", and a Customer Application is defined (§1.2)
  to include serving your own third-party end users — provided (§3.5, Acceptable Use
  Policy §4) those end users never receive the Tavily API key or call Tavily directly
  (they only ever talk to this server). That's exactly how both endpoints are built.
- **Serper** (`serper.dev`) — used for `/api/search/serp`. SerpApi was checked as an
  alternative and rejected (subscription-only, no true prepaid credits, and is currently
  the defendant in active litigation brought by Google over its scraping methods).
  Serper's own ToS is **silent** on resale — neither an explicit permission nor a
  prohibition. The one clause that matters bans mirroring "the materials on any other
  server as-is with no-value-added" — so `endpoints/search-serp.js` deliberately
  restructures Serper's raw JSON (renamed/trimmed fields, 3 separate response sections
  merged into one shape) rather than passing it through verbatim, to stay clearly on the
  value-added side of that clause. This is a documented risk decision, not a clean bill of
  health — revisit if Serper ever adds an explicit resale clause either way.
- **Scraping (`/api/web/scrape`) ended up on Tavily too, not a dedicated scraper.**
  Firecrawl (forbidden, above), ScrapingBee, and ZenRows were all checked for this slot —
  all three require an active paying subscription for any real usage (no genuine
  zero-commitment prepaid credits, failing this project's "no subscription" requirement
  outright), and ScrapingBee's and ZenRows' own Terms are themselves ambiguous-to-restrictive
  on resale even if that requirement were waived. Rather than accept a provider that fails
  on cost model, ToS, or both, `/api/web/scrape` reuses Tavily's Extract endpoint —
  already cleared above — accepting a lower ceiling on "hard site" coverage in exchange for
  a provider that's unambiguously fine to resell from.

**Real-world verified, not assumed (2026-09-02, against a live Tavily key, testnet
payments):** `/api/web/scrape` was tested against real pages before writing its sale
description — a JS-heavy page (content only renders after client-side script execution),
a live BBC News article, and Cloudflare-protected sites. JS-rendered content **extracts
correctly** (real page content came back, not an empty shell). The news article
**extracts correctly** too, but noisier than this server's own `/api/web/read`
(Readability-based, so boilerplate-stripped) — Tavily's extraction is a fuller page dump,
not a focused article reader. Cloudflare needed a second pass: the first target
(nowsecure.nl, a commonly-cited community test page) failed — but a follow-up check found
that page no longer reliably presents an active Cloudflare challenge at all (plain `curl`:
`200`, no challenge header), so that result was discarded as a bad test target, not real
evidence. Re-tested against 3 sites with a **confirmed active** Cloudflare challenge
(verified via `curl` immediately before each call): discogs.com, glassdoor.com,
upwork.com — **all 3 succeeded**, 30k-46k characters of real page content each. Sell what
was actually observed working: this endpoint does handle hard, actively bot-protected
sites, at least in these verified cases — not a guarantee for every site, but a real,
checked capability rather than an assumed one.

**Margin, at the cheapest prepaid tier of each provider (real numbers, not estimates):**

| Endpoint | Sale price | Upstream cost | Margin | Upstream unit |
|---|---|---|---|---|
| `POST /api/search/web` | $0.01 | $0.008 | $0.002 (~25%) | Tavily pay-as-you-go, $0.008/credit, 1 credit per basic search |
| `POST /api/search/serp` | $0.005 | $0.001 | $0.004 (~5x) | Serper Starter pack, $50/50,000 credits, 1 credit per query |
| `POST /api/web/scrape` | $0.02 | $0.008 | $0.012 (~2.5x) | Tavily pay-as-you-go, $0.008/credit, 1 credit per single-URL basic extract |

`/api/search/web`'s margin is thinner than the "cost × ~2" target set out in the brief —
Tavily's real floor ($0.008/credit) is higher than assumed, and $0.01 was kept as the sale
price anyway (rather than raising to $0.02) to stay priced like the rest of this server's
cheap data endpoints; the price is one constant to change in `endpoints/search-web.js` if
thicker margin matters more than that. Every successful premium-reseller call appends its
real upstream cost to `logs/couts.jsonl` (`lib/couts-log.js` — same `DATA_DIR`/gitignore
discipline as `paiements.jsonl`/`sondages.jsonl`), so actual margin (sale price is already
known and fixed; only the cost side needs tracking) can be checked against these estimates
over time rather than assumed to hold forever.

**Failure handling**: `lib/tavily.js` and `lib/serper.js` collapse every upstream failure
mode — missing API key, network error, any non-2xx response (including an exhausted
credit balance) — to the same clean `503 {"error":"This endpoint is temporarily
unavailable (...)."}`, never a raw `500` and never a leaked provider error message. Both
endpoints cache identical repeated requests for 60s (same convention as the rest of this
server, see `lib/cache.js`) — a cache hit costs nothing upstream, so real margin on
repeated queries is better than the table above.

All the requests above return a `402 Payment Required` first — replay them
with an x402 client (see `scripts/buyer-test.js` for a full example, or
`@x402/fetch` on the agent side).

## Stack

- Node 20+, ESM, Express — no TypeScript.
- x402 v2 packages (current ecosystem, scoped `@x402/*`):
  - `@x402/express` — Express middleware (`paymentMiddleware`, `x402ResourceServer`)
  - `@x402/core` — HTTP facilitator client (`HTTPFacilitatorClient`)
  - `@x402/evm` — `exact` payment scheme on EVM (server and client)
  - `@x402/fetch` — buyer side: a `fetch` wrapper that auto-pays 402s
  - `@x402/extensions` — the **Bazaar** extension (discovery metadata for agents)
  - `@coinbase/x402` — CDP facilitator config (mainnet)
  - `viem` — key generation / EVM signing, RPC reads (`/api/chain/*`, `/api/gas/*`)
  - `express-rate-limit` — per-IP rate limiting on `/api/*` routes
  - `@anthropic-ai/sdk` — Claude Haiku 4.5 for the `/api/ai/*` and `/api/web/extract` endpoints
  - `jsdom` + `@mozilla/readability` — safe HTML parsing and article extraction (the same engine behind Firefox Reader View) for `/api/web/*`
  - `turndown` — HTML-to-Markdown conversion for `/api/web/*`
  - `robots-parser` — robots.txt compliance for `/api/web/*`
  - `ipaddr.js` — private/reserved IP classification for the `/api/web/*` SSRF guard

> The older `x402-express` / `x402-fetch` packages (v1, unscoped) are
> deprecated — don't mix them with `@x402/*`.

## Structure

```
server.js                  # starts Express, loads endpoints/, mounts the x402 middleware
config.js                  # reads .env, validates it, maps base-sepolia/base -> CAIP-2
discovery.js                # builds the GET /.well-known/x402.json document
payment-log.js              # logs every successful payment to logs/paiements.jsonl
sondage-log.js              # logs every 402 response served ("probes") to logs/sondages.jsonl
lib/
  http.js                   # fetchJson/fetchText (10s timeout, User-Agent), safeHandler (never a raw 500)
  cache.js                  # 60s in-memory cache for market/network data
  anthropic.js               # shared Claude Haiku 4.5 client for /api/ai/* and /api/web/extract
  chains.js                  # resolves ?chain=base|ethereum -> viem client, shared gas-price helper
  defi.js                    # shared DefiLlama helpers for /api/price/*
  web.js                      # SSRF-guarded page fetch + readability-to-Markdown extraction for /api/web/*
  stats.js                    # computes GET /stats from the two jsonl logs
  tavily.js                   # shared Tavily client for /api/search/web and /api/web/scrape (see "Premium reseller")
  serper.js                   # shared Serper.dev client for /api/search/serp (see "Premium reseller")
  couts-log.js                # logs our own upstream cost per premium-reseller call to logs/couts.jsonl
endpoints/                 # one file = one endpoint, auto-loaded
  health.js                 # GET /health (free)
  stats.js                   # GET /stats (free)
  defi-tvl.js                # GET /api/defi/tvl (paid, $0.005)
  defi-price.js               # GET /api/defi/price
  defi-tvl-chain.js           # GET /api/defi/tvl-chain
  defi-protocols.js           # GET /api/defi/protocols
  defi-yields.js               # GET /api/defi/yields
  defi-yields-top.js           # GET /api/defi/yields/top
  defi-yields-by-token.js      # GET /api/defi/yields/by-token
  defi-yields-by-chain.js      # GET /api/defi/yields/by-chain
  defi-yields-pool.js          # GET /api/defi/yields/pool
  defi-stablecoins.js          # GET /api/defi/stablecoins
  price-eth-usd.js              # GET /api/price/eth-usd
  price-btc-usd.js               # GET /api/price/btc-usd
  price-sol-usd.js                # GET /api/price/sol-usd
  price-usdc-supply.js             # GET /api/price/usdc-supply
  chain-gas.js               # GET /api/chain/gas
  chain-block.js              # GET /api/chain/block
  gas-base.js                  # GET /api/gas/base
  gas-ethereum.js                # GET /api/gas/ethereum
  web-read.js                     # POST /api/web/read
  web-extract.js                   # POST /api/web/extract
  fx-rates.js                 # GET /api/fx/rates
  github-repo.js               # GET /api/github/repo
  npm-package.js                # GET /api/npm/package
  hn-top.js                      # GET /api/hn/top
  wiki-summary.js                 # GET /api/wiki/summary
  dns-lookup.js                    # GET /api/dns/lookup
  rdap-domain.js                    # GET /api/rdap/domain
  ai-summarize.js                    # POST /api/ai/summarize
  ai-extract.js                       # POST /api/ai/extract
  ai-classify.js                       # POST /api/ai/classify
  ai-translate.js                       # POST /api/ai/translate
  search-web.js                          # POST /api/search/web (paid, $0.01 — premium reseller, Tavily)
  search-serp.js                          # POST /api/search/serp (paid, $0.005 — premium reseller, Serper)
  web-scrape.js                            # POST /api/web/scrape (paid, $0.02 — premium reseller, Tavily)
scripts/
  generate-buyer-wallet.js # generates BUYER_PRIVATE_KEY (viem) + prints the address
  buyer-test.js            # buyer client: receives the 402, pays, prints the response (path/method/body configurable)
  check-bazaar.js          # npm run bazaar — queries the CDP facilitator's Bazaar discovery
  seed-bazaar.js           # npm run seed [-- --only=...] — pays real endpoints so the Bazaar indexes them
  seed-hebdo.js            # npm run seed-hebdo — full-mode weekly seed with a balance guard + retry (see below)
  lib/seed-core.js         # shared dynamic-discovery + payment loop behind seed-bazaar.js and seed-hebdo.js
  importer-cle-cdp.js      # npm run cle — imports the CDP key into .env without ever printing it
render.yaml                 # Render deployment blueprint (Node web service)
logs/paiements.jsonl        # successful-payment log (gitignored, created on the first payment)
logs/sondages.jsonl         # 402-response log (gitignored, created on the first probe)
logs/seeds.jsonl            # weekly seed run summaries (gitignored, LOCAL only — see below)
logs/couts.jsonl            # our own upstream cost per premium-reseller call (gitignored, see "Premium reseller")
.env / .env.example        # configuration (.env is never committed)
```

### Adding an endpoint

Create `endpoints/my-endpoint.js`:

```js
export const path = "/api/my-endpoint";
export const method = "GET";            // optional, defaults to GET
export const price = "$0.01";           // null => free
export const description = "What this endpoint does.";
export async function handler(req, res) {
  res.json({ hello: "world" });
}
```

It is loaded automatically at startup. An optional `discovery` export (via
`declareDiscoveryExtension` from `@x402/extensions/bazaar`) describes the
input parameters and an example output — see `endpoints/defi-tvl.js`.
Write `description` and `discovery` in English, phrased around the search
terms an agent would actually type (e.g. "ETH price USD", "summarize
text") — that's what buyer agents match against in the Bazaar and in
`/.well-known/x402.json`.

## Configuration (.env)

| Variable | Role |
|---|---|
| `NETWORK` | `base-sepolia` (test, default) or `base` (production) |
| `BASE_URL` | This server's public URL, announced to agents (Bazaar, `.well-known/x402.json`). **Never localhost in production.** Empty locally → auto falls back to `http://localhost:PORT` |
| `PAY_TO_ADDRESS` | EVM address that receives the USDC |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | CDP keys — required **only** if `NETWORK=base` |
| `BUYER_PRIVATE_KEY` | Test buyer wallet's private key — **never** set server-side in production (see `render.yaml`) |
| `ANTHROPIC_API_KEY` | Required for `/api/ai/*` and `/api/web/extract` (Claude Haiku 4.5) — without it, these endpoints return a clean 500 error explaining the missing key |
| `GITHUB_TOKEN` | Optional — raises the GitHub rate limit (60/h → 5000/h) for `/api/github/repo`. No scope required (public repo data) |
| `TAVILY_API_KEY` | Required for `/api/search/web` and `/api/web/scrape` (see "Premium reseller") — without it, these return a clean `503`, never a `500` |
| `SERPER_API_KEY` | Required for `/api/search/serp` (see "Premium reseller") — without it, returns a clean `503`, never a `500` |
| `PORT` | Server port — provided automatically by Render in production, 4021 locally |

### Importing the CDP key (`npm run cle`)

To go to production without copy-pasting `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`
into `.env` by hand:

```bash
npm run cle
```

1. **1st run**: creates `CLE_API_CDP.txt` at the repo root (a template with 2
   fields to fill in) and opens it in TextEdit. Paste the Key ID (one line)
   and the Secret (can be a multi-line PEM block), save.
2. **2nd run** (`npm run cle` again): reads the file, writes
   `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` into `.env` (the multi-line secret
   is stored quoted with literal `\n`s — `dotenv` converts them back to real
   newlines on load), switches `NETWORK=base`, deletes `CLE_API_CDP.txt`,
   and adds it to `.gitignore`. The secret is **never printed**, only its
   size (number of lines) is confirmed.

Facilitators:

- **base-sepolia** → public test facilitator `https://x402.org/facilitator`, no key.
- **base** → the **CDP** facilitator (Coinbase Developer Platform), authenticated with
  `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` (create keys at https://portal.cdp.coinbase.com).

## Quickstart (testnet)

```bash
npm install
npm start                        # starts the server on port 4021

# In another terminal:
npm run generate-buyer-wallet    # generates BUYER_PRIVATE_KEY + prints the address
# Fund the address with test USDC: https://faucet.circle.com (Base Sepolia)
npm run buyer-test               # pays $0.005 on /api/defi/tvl and prints the response + tx hash
```

Test another endpoint (path, method, and body configurable):

```bash
ENDPOINT_PATH="/api/defi/price?coins=bitcoin" npm run buyer-test
ENDPOINT_PATH="/api/ai/summarize" METHOD=POST \
  BODY='{"text":"Long article...","max_sentences":1}' npm run buyer-test
ENDPOINT_PATH="/api/web/read" METHOD=POST \
  BODY='{"url":"https://en.wikipedia.org/wiki/HTTP_402"}' npm run buyer-test
```

Check manually:

```bash
curl http://localhost:4021/health                        # {"ok":true}
curl http://localhost:4021/stats                          # usage stats, free
curl -i "http://localhost:4021/api/defi/tvl?protocol=aave"   # 402 Payment Required
```

## Discovery for agents (Bazaar + `.well-known/x402.json`)

The **Bazaar** is the official x402 discovery index (docs.x402.org): it
lives on the **facilitator** side (`GET {facilitator}/discovery/resources`),
fed by each route's metadata via `@x402/extensions/bazaar`. This server's
routes declare that metadata (input schema + example output); on mainnet,
behind the CDP facilitator, they can be indexed and discovered by third-party
agents through that endpoint (no key required to read it).

In addition, **`GET /.well-known/x402.json`** lists, server-side, every paid
endpoint directly (absolute URL via `BASE_URL`, method, description, price,
network, `payTo`, input/output schema). There is no single official schema
for this file: this document follows the envelope from the IETF draft
*"Discovering x402 Payment Capability via DNS and a Well-Known URI"*
(`x402Version`, `kind: "resource-server"`, `resources[]`, `docs`, `updated`)
and enriches each resource with the same `accepts`/`extensions.bazaar`
fields already used in this server's real `402` responses — see
`discovery.js` for the detail and its sources.

```bash
curl https://x402-seller.onrender.com/.well-known/x402.json
```

To check what the CDP facilitator has indexed from this server (mainnet
only):

```bash
npm run bazaar
```

### Weekly automated seed (staying indexed in the Bazaar)

The CDP facilitator's Bazaar de-lists endpoints that haven't seen a real
settled payment recently — real agent traffic alone can't be relied on to
keep every endpoint fresh. A dedicated **Render Cron Job** (`x402-seed-hebdo`,
created via the Render API, not in `render.yaml` — a separate resource on
purpose, so it can never touch the web service's deploys) runs
`node scripts/seed-hebdo.js` every Monday: full mode (every endpoint
discovered from the live `/.well-known/x402.json`, not a fixed list), one
retry per endpoint on failure, 3s pause between calls. Before spending
anything it reads the buyer wallet's real USDC balance on Base mainnet and
refuses to run if it's under $0.50 — recharge the wallet and it resumes on
its own next week, no code change needed.

`scripts/lib/seed-core.js` holds the shared discovery+payment logic used by
both this script and `scripts/seed-bazaar.js` (the on-demand/`--only`
variant) — one `EXAMPLES` table, never two lists that can drift apart.
`seed-hebdo.js` deliberately does **not** import `config.js`: it only ever
needs `BUYER_PRIVATE_KEY` (read from `.env` locally via `dotenv`, or from a
real Render env var on the cron job) and `TARGET_URL` — none of the
seller-side fields (`PAY_TO_ADDRESS`, CDP keys), which stay out of the cron
job's environment entirely.

Each run appends one JSON summary line to `logs/seeds.jsonl` (gitignored,
**local disk only** — Render cron jobs have no persistent disk, so that
write silently no-ops there; the real record of a Render run is its own
logs in the Render dashboard). Run it yourself anytime:

```bash
npm run seed-hebdo
```

## Rate limiting and logging

- **Rate limit**: 60 requests/minute per IP on all `/api/*` routes
  (`express-rate-limit`). Beyond that, a `429` response with a clear
  message. `.well-known`, `/health`, and `/stats` are not rate-limited.
- **Payment log**: every successfully settled payment writes a JSON line to
  `logs/paiements.jsonl` (`date`, `endpoint`, `payer`, `montant`, `hash` —
  only data that's already public on-chain, never a secret or signed
  payment payload). Directory gitignored, created on the first payment.
- **Probe log**: every `402 Payment Required` response actually served
  writes a JSON line to `logs/sondages.jsonl` (`date`, `endpoint`, a
  **truncated** IP — last octet/group zeroed, never the exact client
  address — and `user_agent`). Same append-only jsonl discipline as the
  payment log; see `sondage-log.js`.
- **`GET /stats`** (free): aggregates both logs into 402-probe and
  successful-payment counts per endpoint, over the last 24h and 7d.
  Contains no sensitive data (no IPs, payer addresses, or transaction
  hashes) — see `lib/stats.js`.

## Deploying to Render

The provided `render.yaml` describes a Node web service (free plan):

1. On https://dashboard.render.com → **New** → **Blueprint** → connect this
   GitHub repo. Render reads `render.yaml` automatically.
2. Fill in the requested environment variables (`sync: false` in the
   blueprint = entered by hand, never committed): `NETWORK`,
   `PAY_TO_ADDRESS`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `BASE_URL`,
   `ANTHROPIC_API_KEY`.
3. `BASE_URL` must be the service's Render URL (e.g.
   `https://x402-seller.onrender.com`) — **never** localhost.
4. `BUYER_PRIVATE_KEY` is **never** set server-side: it's a test buyer key,
   unrelated to the service that sells endpoints.
5. Render provides `PORT` automatically; the server already listens on
   `process.env.PORT` and `0.0.0.0` (`server.js`), and
   `healthCheckPath: /health` is already configured in `render.yaml`.

## Going to production (Base mainnet)

1. Create a secret API key at https://portal.cdp.coinbase.com and fill in
   `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` in `.env` (or via `npm run cle`).
2. Set `NETWORK=base` in `.env`, `BASE_URL` to the real public domain, then
   restart.
3. Payments arrive as real USDC at `PAY_TO_ADDRESS`.

## Reference docs

- Protocol and quickstarts: https://x402.gitbook.io/x402
- CDP facilitator and Bazaar: https://docs.cdp.coinbase.com/x402
- Bazaar (discovery layer): https://docs.x402.org/extensions/bazaar
- IETF `.well-known` draft: https://datatracker.ietf.org/doc/html/draft-hawkins-x402-dns-discovery-01
- Render blueprint: https://render.com/docs/blueprint-spec
