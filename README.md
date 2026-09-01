# cryptomonnaie — API payante via x402

Serveur Express qui vend des endpoints API payants via le protocole **x402**
(paiements **USDC** sur **Base**), concu pour etre consomme par des agents IA.

Un client (humain ou agent) appelle un endpoint payant → le serveur repond
`402 Payment Required` avec les exigences de paiement → le client signe un
paiement USDC et rejoue la requete avec l'en-tete `PAYMENT` → un
**facilitateur** verifie et regle le paiement on-chain → le serveur sert la
reponse. Aucune gestion de clefs blockchain cote serveur : il ne detient que
l'adresse de reception.

## Stack

- Node 20+, ESM, Express — pas de TypeScript.
- Packages x402 v2 (ecosysteme actuel, scoped `@x402/*`) :
  - `@x402/express` — middleware Express (`paymentMiddleware`, `x402ResourceServer`)
  - `@x402/core` — client facilitateur HTTP (`HTTPFacilitatorClient`)
  - `@x402/evm` — scheme de paiement `exact` sur EVM (serveur et client)
  - `@x402/fetch` — cote acheteur : `fetch` enrobe qui paie automatiquement les 402
  - `@x402/extensions` — extension **Bazaar** (metadonnees de decouverte pour agents)
  - `@coinbase/x402` — config du facilitateur CDP (mainnet)
  - `viem` — generation de cle / signature EVM

> Les anciens packages `x402-express` / `x402-fetch` (v1, non scoped) sont
> obsoletes — ne pas les melanger avec `@x402/*`.

## Structure

```
server.js                  # demarre Express, charge endpoints/, monte le middleware x402
config.js                  # lit le .env, valide, mappe base-sepolia/base -> CAIP-2
endpoints/                 # un fichier = un endpoint, charges automatiquement
  health.js                # GET /health (gratuit)
  defi-tvl.js              # GET /api/defi/tvl?protocol=aave (payant, 0,005 $)
scripts/
  generate-buyer-wallet.js # genere BUYER_PRIVATE_KEY (viem) + affiche l'adresse
  buyer-test.js            # client acheteur : recoit le 402, paie, affiche la reponse
.env / .env.example        # configuration (le .env n'est jamais commite)
```

### Ajouter un endpoint

Creer `endpoints/mon-endpoint.js` :

```js
export const path = "/api/mon-endpoint";
export const method = "GET";            // optionnel, defaut GET
export const price = "$0.01";           // null => gratuit
export const description = "Ce que fait l'endpoint.";
export async function handler(req, res) {
  res.json({ hello: "world" });
}
```

Il est charge automatiquement au demarrage. Un export optionnel `discovery`
(via `declareDiscoveryExtension` de `@x402/extensions/bazaar`) decrit les
parametres d'entree et un exemple de sortie — voir `endpoints/defi-tvl.js`.

## Configuration (.env)

| Variable | Role |
|---|---|
| `NETWORK` | `base-sepolia` (test, defaut) ou `base` (production) |
| `PAY_TO_ADDRESS` | Adresse EVM qui recoit les USDC |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | Cles CDP — requises **uniquement** si `NETWORK=base` |
| `BUYER_PRIVATE_KEY` | Cle privee du portefeuille acheteur de test |
| `ANTHROPIC_API_KEY` | Pour de futurs endpoints IA payants (inutilisee pour l'instant) |
| `PORT` | Port du serveur (4021) |

Facilitateurs :

- **base-sepolia** → facilitateur public de test `https://x402.org/facilitator`, sans cle.
- **base** → facilitateur **CDP** (Coinbase Developer Platform), authentifie par
  `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` (cles a creer sur https://portal.cdp.coinbase.com).

## Demarrage rapide (testnet)

```bash
npm install
npm start                        # demarre le serveur sur le port 4021

# Dans un autre terminal :
npm run generate-buyer-wallet    # genere BUYER_PRIVATE_KEY + affiche l'adresse
# Alimenter l'adresse en USDC de test : https://faucet.circle.com (Base Sepolia)
npm run buyer-test               # paie 0,005 $ et affiche la reponse + le hash
```

Verifier a la main :

```bash
curl http://localhost:4021/health                        # {"ok":true}
curl -i "http://localhost:4021/api/defi/tvl?protocol=aave"   # 402 Payment Required
```

## Passage en production (Base mainnet)

1. Creer une cle API secrete sur https://portal.cdp.coinbase.com et remplir
   `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` dans le `.env`.
2. `NETWORK=base` dans le `.env`, puis redemarrer.
3. Les paiements arrivent en vrais USDC sur `PAY_TO_ADDRESS`.

## Decouverte par les agents (Bazaar)

Le **Bazaar** est l'index de decouverte x402 : les agents y cherchent des
endpoints payants a consommer. Les routes de ce serveur declarent leurs
metadonnees de decouverte (schema d'entree + exemple de sortie) via
`@x402/extensions/bazaar` ; lorsqu'on est en mainnet derriere le facilitateur
CDP, les endpoints regles via ce facilitateur peuvent etre catalogues et
decouverts par des agents tiers (endpoint `list` du facilitateur, accessible
sans cle).

## Docs de reference

- Protocole et quickstarts : https://x402.gitbook.io/x402
- Facilitateur CDP et Bazaar : https://docs.cdp.coinbase.com/x402
