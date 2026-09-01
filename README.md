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
  - `express-rate-limit` — rate-limit par IP sur les routes `/api/*`

> Les anciens packages `x402-express` / `x402-fetch` (v1, non scoped) sont
> obsoletes — ne pas les melanger avec `@x402/*`.

## Structure

```
server.js                  # demarre Express, charge endpoints/, monte le middleware x402
config.js                  # lit le .env, valide, mappe base-sepolia/base -> CAIP-2
discovery.js                # construit le document GET /.well-known/x402.json
payment-log.js              # journalise chaque paiement reussi dans logs/paiements.jsonl
endpoints/                 # un fichier = un endpoint, charges automatiquement
  health.js                # GET /health (gratuit)
  defi-tvl.js              # GET /api/defi/tvl?protocol=aave (payant, 0,005 $)
scripts/
  generate-buyer-wallet.js # genere BUYER_PRIVATE_KEY (viem) + affiche l'adresse
  buyer-test.js            # client acheteur : recoit le 402, paie, affiche la reponse
  importer-cle-cdp.js      # npm run cle — importe la cle CDP dans .env sans jamais l'afficher
render.yaml                 # blueprint de deploiement Render (service web Node)
logs/paiements.jsonl        # journal des paiements reussis (gitignore, cree au 1er paiement)
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
| `BASE_URL` | URL publique de ce serveur, annoncee aux agents (Bazaar, `.well-known/x402.json`). **Jamais localhost en production.** Vide en local → repli automatique sur `http://localhost:PORT` |
| `PAY_TO_ADDRESS` | Adresse EVM qui recoit les USDC |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | Cles CDP — requises **uniquement** si `NETWORK=base` |
| `BUYER_PRIVATE_KEY` | Cle privee du portefeuille acheteur de test — **jamais** definie cote serveur en production (voir `render.yaml`) |
| `ANTHROPIC_API_KEY` | Pour de futurs endpoints IA payants (inutilisee pour l'instant) |
| `PORT` | Port du serveur — fourni automatiquement par Render en production, 4021 en local |

### Importer la cle CDP (`npm run cle`)

Pour passer en production sans copier-coller `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`
a la main dans le `.env` :

```bash
npm run cle
```

1. **1er lancement** : cree `CLE_API_CDP.txt` a la racine (gabarit avec 2 zones
   a remplir) et l'ouvre dans TextEdit. Colle le Key ID (une ligne) et le
   Secret (peut etre un bloc PEM multi-lignes), enregistre.
2. **2eme lancement** (`npm run cle` a nouveau) : lit le fichier, ecrit
   `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` dans le `.env` (le secret multi-ligne
   est stocke entre guillemets avec des `\n` litteraux — `dotenv` les
   reconvertit en vrais retours a la ligne au chargement), bascule
   `NETWORK=base`, supprime `CLE_API_CDP.txt` et l'ajoute au `.gitignore`.
   Le secret n'est **jamais affiche**, seule sa taille (nombre de lignes) est
   confirmee.

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

## Decouverte par les agents (Bazaar + `.well-known/x402.json`)

Le **Bazaar** est l'index de decouverte x402 officiel (docs.x402.org) : il
vit cote **facilitateur** (`GET {facilitator}/discovery/resources`), nourri
par les metadonnees de chaque route via `@x402/extensions/bazaar`. Les routes de
ce serveur declarent ces metadonnees (schema d'entree + exemple de sortie) ;
en mainnet derriere le facilitateur CDP, elles peuvent etre cataloguees et
decouvertes par des agents tiers via cet endpoint (accessible sans cle).

En complement, **`GET /.well-known/x402.json`** liste directement, cote
serveur, tous les endpoints payants (URL absolue via `BASE_URL`, methode,
description, prix, reseau, `payTo`, schema d'entree/sortie). Il n'existe pas
de schema officiel unique pour ce fichier : ce document reprend l'enveloppe
du brouillon IETF *"Discovering x402 Payment Capability via DNS and a
Well-Known URI"* (`x402Version`, `kind: "resource-server"`, `resources[]`,
`docs`, `updated`) et enrichit chaque ressource avec les memes champs
`accepts`/`extensions.bazaar` deja utilises dans les vraies reponses `402`
de ce serveur — voir `discovery.js` pour le detail et les sources.

```bash
curl https://x402-seller.onrender.com/.well-known/x402.json
```

## Rate-limit et journal des paiements

- **Rate-limit** : 60 requetes/minute par IP sur toutes les routes `/api/*`
  (`express-rate-limit`). Au-dela, reponse `429` avec un message clair.
  `.well-known` et `/health` ne sont pas limites.
- **Journal des paiements** : chaque paiement regle avec succes ecrit une
  ligne JSON dans `logs/paiements.jsonl` (`date`, `endpoint`, `payer`,
  `montant`, `hash` — uniquement des donnees deja publiques on-chain, jamais
  de secret ni de payload de paiement signe). Dossier gitignore, cree au
  premier paiement.

## Deploiement sur Render

Le `render.yaml` fourni decrit un service web Node (plan gratuit) :

1. Sur https://dashboard.render.com → **New** → **Blueprint** → connecter ce
   depot GitHub. Render lit `render.yaml` automatiquement.
2. Renseigner les variables d'environnement demandees (`sync: false` dans le
   blueprint = a saisir a la main, jamais commitees) : `NETWORK`,
   `PAY_TO_ADDRESS`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `BASE_URL`,
   `ANTHROPIC_API_KEY`.
3. `BASE_URL` doit etre l'URL Render du service (ex.
   `https://x402-seller.onrender.com`) — **jamais** localhost.
4. `BUYER_PRIVATE_KEY` n'est **jamais** definie cote serveur : c'est une cle
   d'acheteur de test, sans rapport avec le service qui vend des endpoints.
5. Render fournit `PORT` automatiquement ; le serveur ecoute deja sur
   `process.env.PORT` et `0.0.0.0` (`server.js`), et `healthCheckPath: /health`
   est deja configure dans `render.yaml`.

## Passage en production (Base mainnet)

1. Creer une cle API secrete sur https://portal.cdp.coinbase.com et remplir
   `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` dans le `.env` (ou via `npm run cle`).
2. `NETWORK=base` dans le `.env`, `BASE_URL` sur le vrai domaine public, puis
   redemarrer.
3. Les paiements arrivent en vrais USDC sur `PAY_TO_ADDRESS`.

## Docs de reference

- Protocole et quickstarts : https://x402.gitbook.io/x402
- Facilitateur CDP et Bazaar : https://docs.cdp.coinbase.com/x402
- Bazaar (discovery layer) : https://docs.x402.org/extensions/bazaar
- Brouillon IETF `.well-known` : https://datatracker.ietf.org/doc/html/draft-hawkins-x402-dns-discovery-01
- Blueprint Render : https://render.com/docs/blueprint-spec
