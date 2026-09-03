# Audit — second rail de paiement MPP (Stripe + Tempo)

*Rédigé le 2026-09-04. Audit uniquement — aucun fichier de code ni variable
d'environnement modifiés. Toutes les sources ci-dessous ont été consultées
en direct le 2026-09-04 (dates de publication des paquets vérifiées via
`npm view`, pas devinées) ; les citations verbatim viennent des pages
officielles (docs.stripe.com, mpp.dev, tempo.xyz, GitHub `tempoxyz/*` et
`wevm/mppx`) ou d'une requête HTTP réelle contre notre propre serveur en
production.*

## Synthèse (10 lignes)

MPP est un second protocole 402, distinct d'x402 au niveau du fil (en-tête
`WWW-Authenticate: Payment` contre notre `payment-required` base64), donc
**faisable sans toucher au rail x402 existant** — mais aucun SDK officiel
ne fusionne les deux défis dans une même réponse, donc l'implémentation
doit passer par un **préfixe de route dédié** (`/api/mpp/*`), jamais par une
modification des routes `/api/*` actuelles. Le paquet officiel `mppx`
(wevm, MIT, publié hier 2026-09-02) fournit un adaptateur Express natif
(`mppx/express`) et un backend Stripe (`mppx/stripe`) prêts à l'emploi.
Côté Stripe, le chemin carte (SPT) impose un **minimum de 0,50 $** — hors
sujet pour nos prix ($0.005–$0.05) — et le chemin stablecoin (MPP+Tempo ou
x402+Base via Stripe) impose un **minimum de 0,01 $ USDC**, viable
seulement pour 11 de nos 33 endpoints payants (ceux à $0.01/$0.02/$0.05).
Pour la France, le SPT est en préversion mais listé (`FR` explicitement
couvert) ; le stablecoin *via Stripe* est en **bêta privée pour l'UE**,
accès sur demande manuelle (email à `machine-payments@stripe.com`). Un
mécanisme `session` (bons off-chain agrégés, dès $0.0001/unité) permet en
théorie de contourner le minimum de $0.01 par appel, mais son interaction
exacte avec le backend Stripe n'est pas documentée — point non vérifié.
Fait notable : Stripe a AUSSI un chemin x402-natif (mêmes paquets
`@x402/core`/`@x402/evm`/`@coinbase/x402` que notre serveur actuel) qui
convertit du USDC-sur-Base en solde Stripe EUR — sans toucher au protocole
x402 lui-même, juste en changeant l'adresse `payTo` et en ajoutant un hook
`onAfterSettle` qui enregistre un `PaymentIntent`. Conclusion : **faisable,
dans les limites ci-dessus**, en 2 sous-projets séparés (Stripe-x402 quasi
gratuit à ajouter ; MPP carte/stablecoin plus lourd et soumis à
approbation Stripe non maîtrisée dans le temps).

## 1. Sources vérifiées

| Sujet | Source officielle | Consulté le |
|---|---|---|
| Guide d'intégration MPP | [docs.stripe.com/payments/machine/mpp.md](https://docs.stripe.com/payments/machine/mpp.md) | 2026-09-04 |
| Vue d'ensemble paiements machine + disponibilité | [docs.stripe.com/payments/machine.md](https://docs.stripe.com/payments/machine.md) | 2026-09-04 |
| Guide x402 côté Stripe | [docs.stripe.com/payments/machine/x402.md](https://docs.stripe.com/payments/machine/x402.md) | 2026-09-04 |
| Shared Payment Tokens (SPT), pays couverts | [docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md?agent-seller=seller](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md?agent-seller=seller) | 2026-09-04 |
| Paiements stablecoin (produit générique Checkout/Elements) | [docs.stripe.com/payments/stablecoin-payments.md](https://docs.stripe.com/payments/stablecoin-payments.md) | 2026-09-04 |
| Business Profiles (API v2 preview) | [docs.stripe.com/api/v2/network/business-profiles.md](https://docs.stripe.com/api/v2/network/business-profiles.md?api-version=2026-07-29.preview) | 2026-09-04 |
| Création d'un profil Stripe (Dashboard) | [docs.stripe.com/get-started/account/profile.md](https://docs.stripe.com/get-started/account/profile.md) | 2026-09-04 |
| Format du défi HTTP 402 MPP | [mpp.dev/protocol/challenges](https://mpp.dev/protocol/challenges) | 2026-09-04 |
| SDK TypeScript `mppx` — code source | [github.com/wevm/mppx (README, main)](https://raw.githubusercontent.com/wevm/mppx/main/README.md) — vérifié en second lieu par `curl`+`grep` direct sur le fichier brut, pas seulement le résumé du fetch | 2026-09-04 |
| `mppx/express` et `mppx/stripe`, signatures exactes | `unpkg.com/mppx@0.9.2/dist/middlewares/express.d.ts` et `.../stripe/server/index.d.ts` | 2026-09-04 |
| Paquet npm `mppx` (version, date de publication) | `npm view mppx` | 2026-09-04 — v0.9.2, publié 2026-09-02 |
| Paquet npm `stripe` (version, date de publication) | `npm view stripe` | 2026-09-04 — v22.6.1, publié 2026-09-03 |
| Spécification protocolaire complète | [github.com/tempoxyz/mpp-specs](https://github.com/tempoxyz/mpp-specs) (schéma "Payment" HTTP Auth Scheme, [draft-ryan-httpauth-payment](https://datatracker.ietf.org/doc/draft-ryan-httpauth-payment/)) | 2026-09-04 |
| Docs Tempo « Machine Payments » | [tempo.xyz/developers/learn/tempo/machine-payments](https://tempo.xyz/developers/learn/tempo/machine-payments) | 2026-09-04 |
| Annuaire de services MPP | [mpp.dev/services](https://mpp.dev/services) | 2026-09-04 |
| 402 réel de notre serveur (référence x402 actuelle) | `curl -D - https://x402-seller-0ay3.onrender.com/api/defi/price` (production, lecture seule) | 2026-09-04 |

## 2. x402 (actuel) vs MPP (Stripe + Tempo) — comparaison technique

| | **x402 (`@x402/express` v2.24.0, actuel)** | **MPP (`mppx`, à évaluer)** |
|---|---|---|
| Réponse au refus de paiement | `HTTP 402`, corps JSON **vide** (`{}`), tout le défi est dans un en-tête **`payment-required`** (base64, JSON `{x402Version:2, error, resource, accepts:[...], extensions}`) — **vérifié en direct** sur `GET /api/defi/price` en prod le 2026-09-04, forme identique à l'exemple officiel Stripe pour son propre guide x402 | `HTTP 402`, défi porté par l'en-tête standard **`WWW-Authenticate: Payment ...`** (base64url, champs `id/realm/method/intent/request/opaque`) — [mpp.dev/protocol/challenges](https://mpp.dev/protocol/challenges) |
| Retry du client | Rejoue la requête avec le paiement signé (mécanisme propre à `@x402/fetch`) | Rejoue avec les identifiants dans l'en-tête indiqué par le champ `header` du défi, **`Authorization` par défaut si absent** |
| Succès | Réponse normale + `onAfterSettle` côté serveur (hook déjà utilisé dans `server.js`) | Réponse normale + en-tête **`Payment-Receipt`** ([unpkg.com/mppx@0.9.2/.../express.d.ts](https://unpkg.com/mppx@0.9.2/dist/middlewares/express.d.ts)) |
| Réseau/monnaie | USDC sur Base (`eip155:8453`), facilitateur CDP | Cartes (SPT) **et** stablecoins sur Tempo/Solana (nativement) ou Base (via le chemin x402-de-Stripe, voir plus bas) |
| SDK serveur Node | `@x402/express` (déjà en place) | `mppx/express` (adaptateur natif confirmé, export dédié) |
| SDK client de test | `@x402/fetch`, notre `scripts/buyer-test.js` | `npx mppx@latest validate <url>` (CLI officielle), `link-cli` (SPT), CLI `tempo` (stablecoin) |

**Collision d'en-têtes : aucune.** Les deux protocoles utilisent des noms
d'en-tête entièrement disjoints (`payment-required` vs `WWW-Authenticate`),
donc rien n'empêche *techniquement* qu'une même réponse 402 porte les deux
défis à la fois. **Mais aucun SDK officiel ne fait ça** : ni `@x402/express`
ni `mppx/express` ne sont conçus pour produire un 402 « fusionné » — chacun
construit et **termine** lui-même la réponse dès qu'il détecte l'absence
d'un paiement valide pour *son* protocole. Fusionner exigerait un
middleware maison non documenté par les éditeurs (lequel des deux répond
en premier ? le corps reste-t-il vide comme l'exige x402 si `mppx` y écrit
aussi ?) — un risque réel et non testé, inacceptable vu la contrainte
« zéro régression sur x402 » et le premier client réel du 02/09.

**Décision : préfixe de route dédié**, pas de négociation par en-tête.
Raison du rejet de l'alternative « en-tête de requête » : elle suppose
qu'un client MPP envoie *par avance* un en-tête de préférence avant même
de recevoir un 402 — aucun agent MPP existant (SPT, `tempo` CLI, `mppx
validate`) ne fait ça par défaut, ce serait donc une convention non
standard, fragile. Le préfixe de route, lui, ne dépend d'aucun
comportement client non documenté : un agent MPP appelle une URL MPP, un
agent x402 continue d'appeler l'URL x402 existante, **inchangée au
caractère près**.

**Point de vigilance découvert en marge** : le helper `mppx`
`discovery(app, ...)` monte par défaut une route `GET /openapi.json`
([unpkg.com/mppx@0.9.2/.../express.d.ts](https://unpkg.com/mppx@0.9.2/dist/middlewares/express.d.ts)) — **le même chemin que notre document OpenAPI x402 déjà en place**
(`app.get("/openapi.json", ...)` dans `server.js`). Si ce helper est utilisé
tel quel, collision de route garantie. Son option `config.path` permet de
choisir un autre chemin (ex. `/mpp/openapi.json`) — à faire explicitement,
jamais laisser la valeur par défaut.

## 3. Prérequis Stripe

- **Compte** : un compte Stripe standard (`stripe.com/register`), pas de
  type Connect nécessaire pour notre cas (mono-marchand). Le « profil
  Stripe » (`profile_...`, utilisé comme `networkId`) se crée **uniquement
  depuis le Dashboard** (Dashboard → Profil Stripe → Démarrer → nom +
  identifiant) — **aucun endpoint API de création** n'existe, seuls
  `GET /v2/network/business_profiles/:id` et `.../me` sont documentés
  ([docs.stripe.com/api/v2/network/business-profiles.md](https://docs.stripe.com/api/v2/network/business-profiles.md?api-version=2026-07-29.preview)). En-tête requis sur ces appels : `Stripe-Version: 2026-07-29.preview`
  (⚠️ valeur de preview différente selon la famille d'endpoint, voir plus bas). Pays exclu : Inde uniquement — la France n'est pas
  restreinte pour la création d'un profil.
- **PaymentIntents** : flux standard (`stripe.paymentIntents.create()`),
  avec pour le chemin x402 un mode spécifique **`payment_method_data:{type:"crypto"}`**
  + **`payment_method_options.crypto.mode:"transaction_verification"`**
  (enregistre après-coup une transaction on-chain déjà réglée par le
  facilitateur — ne déclenche aucun mouvement de fonds, juste la
  comptabilité Stripe) — nécessite `Stripe-Version: 2026-05-27.preview`.
- **Moyens de paiement acceptés** : cartes via SPT (Shared Payment Tokens,
  Preview — CGU dédiées : *Stripe Agentic Commerce Seller Services
  Preview*), stablecoins (USDC) sur Tempo (MPP), Solana (MPP) et Base
  (x402).
- **Disponibilité France** :
  - **SPT (carte)** : **France explicitement listée** dans les pays
    couverts, aux côtés de 33 autres pays UE/EEE/UK/Suisse
    ([liste complète vérifiée](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md?agent-seller=seller)) — statut Preview, pas GA.
  - **Stablecoin via MPP/x402 (machine payments)** : pour toute entreprise
    hors USA, **accès sur demande manuelle** — « envoyez un e-mail à
    `machine-payments@stripe.com` en indiquant l'ID de votre compte Stripe
    pour demander l'accès aux paiements en stablecoin dans plus de 30
    pays » ([docs.stripe.com/payments/machine.md](https://docs.stripe.com/payments/machine.md)). Le produit stablecoin générique (Checkout/Elements, différent de
    la voie machine-payments mais gouverné par la même autorisation de
    principe) confirme : **« bêta privée pour les entreprises... de
    l'Union européenne »** ([docs.stripe.com/payments/stablecoin-payments.md](https://docs.stripe.com/payments/stablecoin-payments.md)), avec `FR` listé nommément dans le tableau des pays couverts.
    **Donc : ni le SPT ni le stablecoin ne sont GA pour une entreprise
    française — les deux sont en Preview/bêta privée**, le stablecoin
    nécessitant en plus une validation manuelle par Stripe.
- **Réception des stablecoins → conversion EUR** : « Les paiements en
  stablecoin sont réglés sur votre solde Stripe dans votre devise locale »
  ([docs.stripe.com/payments/stablecoin-payments.md](https://docs.stripe.com/payments/stablecoin-payments.md)) — conversion automatique vers EUR pour un compte français, aucune
  étape manuelle de notre côté au-delà de l'activation du moyen de paiement.
  Limite de transaction client : **10 000 USD par transaction** (largement
  au-dessus de nos montants).
- **Frais** : **non trouvés dans la documentation publique** pour le
  chemin machine-payments/MPP spécifiquement — la page pricing générale de
  Stripe ne liste aucune ligne dédiée « stablecoin »/« crypto »/« machine
  payments », renvoyant à un contact commercial (« *Votre modèle
  économique est unique... nous pouvons concevoir ensemble une solution
  personnalisée* », [stripe.com/pricing](https://stripe.com/pricing)). Les
  taux standard cartes en Europe (**1,5 % + 0,25 €** par transaction,
  chiffre public généraliste, pas spécifique à MPP) donnent un ordre de
  grandeur : le seul frais fixe de 0,25 € dépasserait déjà largement le
  prix de n'importe lequel de nos endpoints — **point qui, à lui seul,
  rend le rail carte non viable pour un paiement unitaire**, indépendamment
  du minimum de 0,50 $ (voir section 4).

## 4. Micro-montants : quels endpoints sont viables sur quel rail

Prix actuels du service (33 endpoints payants, vérifiés dans `endpoints/*.js`
le 2026-09-04) : 23 à **$0.005**, 4 à **$0.01**, 2 à **$0.02**, 5 (gamme
`defi/yields`) à **$0.05**.

Minimums confirmés (table « Microtransactions », [docs.stripe.com/payments/machine.md](https://docs.stripe.com/payments/machine.md)) :

> « Pour les paiements par carte via des Shared Payment Tokens (SPT), le
> montant minimum est de **0,50 USD**. Pour les paiements en stablecoins,
> le montant minimum est de **0,01 USDC**. »

| Rail | Minimum | Endpoints viables (sur nos 33) |
|---|---|---|
| Carte (SPT via `mppx/stripe`) | $0.50 | **Aucun** en paiement unitaire (le prix le plus élevé, $0.05, reste 10× sous le seuil ; le seul frais fixe de carte européen ~0,25 € l'interdirait de toute façon, voir section 3) |
| Stablecoin via MPP (Tempo) **ou** x402-vers-Stripe (Base), passant par le PaymentIntent Stripe | $0.01 | Les **11 endpoints** à $0.01/$0.02/$0.05 (`ai-classify`, `ai-summarize`, `ai-translate`, `search-web`, `ai-extract`, `web-extract`, les 5 `defi/yields/*`) |
| Stablecoin direct, **sans Stripe** (rail x402→Base déjà en place, ou `mppx` avec le backend `tempo()` natif sans passer par `stripe.create()`) | *Aucun minimum imposé par Stripe* (gouverné uniquement par le facilitateur CDP côté x402, déjà validé à $0.005) | Les 33, **inchangé** — mais ne remplit pas l'objectif « encaisser en euros », puisque les fonds vont sur un wallet, pas un solde Stripe |
| Session (`mppx.tempo.session({amount, unitType:'token'})`, bons off-chain agrégés) | Confirmé possible dès **$0.0001/unité** dans l'exemple officiel du SDK ([README `wevm/mppx`, ligne 217](https://raw.githubusercontent.com/wevm/mppx/main/README.md), vérifié verbatim par `curl`+`grep` sur le fichier brut) — mécanisme d'escrow/canal, "sub-cent fees" confirmé côté réseau Tempo ([tempo.xyz/developers/learn/tempo/machine-payments](https://tempo.xyz/developers/learn/tempo/machine-payments)) | En théorie les 23 à $0.005, **si** le backend Stripe accepte une session sans imposer son plancher de $0.01 par bon individuel — **non confirmé dans la documentation lue** (voir « points non vérifiés ») |

**Conclusion** : sur le rail Stripe (celui qui convertit réellement en
EUR), seuls les endpoints déjà à **$0.01 et plus** (11 sur 33) sont
viables tels quels, uniquement en stablecoin. Le rail carte n'est viable
pour aucun de nos prix actuels, quel que soit le montant en dessous de
$0.50. Les 23 endpoints à $0.005 ne deviennent éligibles au rail Stripe
que (a) si on les reprice à $0.01 **sur cette route MPP spécifiquement**
(le rail x402 direct garderait $0.005 inchangé, sans lien avec Stripe), ou
(b) si le mécanisme de session s'avère fonctionner sous le plancher — à
vérifier en pratique avant de s'y fier.

## 5. Découverte / annuaires

Deux mécanismes distincts, tous deux vérifiés sur [mpp.dev/services](https://mpp.dev/services) :

1. **MPPScan** (auto-discovery immédiate, hors annuaire curé) :
   inscription self-service sur `https://www.mppscan.com/register` — pas
   de revue humaine, analogue à CDP Bazaar.
2. **Annuaire curé `mpp.dev/services`** : ouvrir une pull request sur
   `github.com/tempoxyz/mpp` via le lien-template
   `https://github.com/tempoxyz/mpp/compare?expand=1&template=service.md`
   après avoir réuni URL publique, documentation, endpoints, moyens de
   paiement et grille tarifaire. Critère explicite : « *Tempo priorise les
   services de qualité et nouveaux, et peut refuser les services qui
   dupliquent une fonctionnalité existante ou qui ne sont pas encore prêts
   pour la production* » — à garder en tête si on soumet, notre service
   étant déjà listé côté x402/CDP Bazaar avec un catalogue similaire.

## 6. Observabilité — extension proposée (conception, pas encore codée)

Principe : **n'ajouter que des clés**, jamais renommer/retirer un champ
existant — un consommateur qui lit `paiements.jsonl`/`sondages.jsonl`
aujourd'hui (la tuile Jarvis, `lib/stats.js`, `lib/stats-daily.js`) ignore
naturellement une clé qu'il ne connaît pas ; l'absence de la nouvelle clé
sur les lignes déjà écrites doit être traitée comme `rail:"x402"` par
défaut par tout futur code qui la lit.

- **`paiements.jsonl`** (`payment-log.js`) : ajouter `rail: "x402" | "mpp"`
  et, uniquement pour `rail:"mpp"`, `method: "card" | "stablecoin"` et
  `payment_intent` (l'id Stripe `pi_...`, toujours présent côté MPP même
  quand aucune adresse on-chain n'existe — cas du paiement carte). Le champ
  `payer` existant reste tel quel : une adresse EVM/Tempo quand elle
  existe (x402/Base, MPP/stablecoin-Tempo), `null` pour un paiement carte
  MPP (normal, pas une anomalie — voir plus bas).
- **`sondages.jsonl`** (`sondage-log.js`) : même ajout `rail`, posé au
  moment où le 402 est effectivement émis (le hook déjà en place dans
  `server.js`, `if (res.statusCode === 402)`, devra distinguer laquelle des
  deux couches de middleware — x402 ou mppx — a produit ce 402 ; les deux
  seront montées sur des sous-arbres de routes différents, `/api/*` vs
  `/api/mpp/*`, donc déductible du chemin sans inspection de contenu).
- **« Payeur inconnu » sur les deux rails** : la définition doit rester
  *contextuelle au rail et à la méthode*, sinon un faux positif garanti
  sur chaque paiement carte légitime :
  - `rail:"x402"` et `payer` absent malgré un règlement réussi → anomalie
    (comportement déjà comme aujourd'hui, jamais observé en usage normal).
  - `rail:"mpp", method:"stablecoin"` et `payer` absent → anomalie (même
    logique, une adresse on-chain doit toujours être présente).
  - `rail:"mpp", method:"card"` et `payer` absent → **normal, pas une
    anomalie** (un SPT masque l'identité du moyen de paiement sous-jacent
    par construction) ; la traçabilité passe alors par `payment_intent`
    (consultable dans le Dashboard Stripe), pas par une adresse wallet.
  - `lib/stats.js` n'a **aucune modification requise** pour rester correct :
    son exclusion actuelle (`isTestWallet(p.payer)`) traite déjà un
    `payer` absent comme « non-test » → compté en `tiers`, ce qui est le
    comportement voulu pour un vrai paiement carte (identité inconnue mais
    bien un tiers réel). Une vue « répartition par rail » viendrait
    s'ajouter à côté, jamais en remplacement des agrégats actuels.

## 7. Plan de test

1. Mode test Stripe (`sk_test_...`) exclusivement, sur un service Express
   isolé (nouveau fichier jetable, jamais branché sur `server.js`).
2. `npx mppx@latest validate http://localhost:<port_dev>` — la CLI teste
   automatiquement découverte, format du défi, gestion d'erreur et le
   tunnel complet, aller-retour réel en environnement de test (fonds
   fictifs) — [docs.stripe.com/payments/machine/mpp.md](https://docs.stripe.com/payments/machine/mpp.md).
3. Test manuel carte : `link-cli` (`npx @stripe/link-cli mpp pay ...`) pour
   émettre un SPT de test et valider le tunnel bout en bout.
4. Test manuel stablecoin : `tempo` CLI (`tempo wallet fund` en mode test,
   puis `tempo request`) — testnet Tempo, sans fonds réels.
5. **Un seul paiement réel de validation**, en dernier, une fois l'accès
   stablecoin approuvé par Stripe (délai externe non maîtrisé) : soit via
   `purl` (outil Stripe) sur le chemin x402-vers-Stripe (le plus proche de
   notre stack existante), soit via `tempo request` en mode production sur
   le chemin MPP natif — jamais les deux le même jour, pour isoler la
   cause d'un éventuel échec.
6. Vérification post-paiement : `GET /v1/payment_intents/<id>` (Stripe)
   **et** la ligne correspondante dans `paiements.jsonl` (`rail:"mpp"`) —
   les deux doivent s'accorder avant de considérer le rail opérationnel.

## 8. Plan d'implémentation (étapes numérotées, chacune < 1h)

1. Créer/retrouver le profil Stripe dans le Dashboard (`profile_...`),
   noter son id — 15 min.
2. `npm install mppx stripe` en environnement de développement local
   uniquement (pas de déploiement) — 5 min.
3. Générer la clé de signature MPP (`crypto.createHmac(...)` dérivée de la
   clé secrète Stripe, exactement comme l'exemple officiel) dans un script
   jetable non versionné — 15 min.
4. Écrire un mini-serveur Express de PoC isolé (nouveau fichier, port de
   dev distinct, une seule route `/mpp-poc` à $0.50) avec `mppx/express` +
   `mppx/stripe`, clés de test uniquement — 45 min.
5. Lancer `npx mppx@latest validate` contre ce PoC, corriger jusqu'à
   passage au vert — 30 min (peut déborder si un premier essai échoue,
   prévoir une 2ᵉ session).
6. Créer une adresse de dépôt Tempo en mode test
   (`POST /v1/crypto/deposit_addresses?network=tempo`) et rebrancher le
   PoC dessus pour tester le chemin stablecoin — 30 min.
7. Écrire `lib/mpp-log.js` (calqué sur `payment-log.js`, ajoute `rail`,
   `method`, `payment_intent`) et son équivalent pour `sondages.jsonl` —
   45 min.
8. Monter les routes MPP réelles sous préfixe `/api/mpp/*` dans
   `server.js`, en clonant les 11 endpoints déjà à $0.01+ (mêmes
   `handler`, description identique) — sans toucher aux routes `/api/*`
   existantes ni au `paymentMiddleware(paidRoutes, resourceServer)` déjà
   monté — 1h (probablement 2 sessions vu le nombre d'endpoints à cloner
   proprement).
9. Décider et documenter le sort des 23 endpoints à $0.005 sur ce rail
   (exclus du miroir MPP, ou repricés à $0.01 uniquement sur
   `/api/mpp/*`) — 20 min de décision, pas de code.
10. Envoyer la demande d'accès stablecoin non-US
    (`machine-payments@stripe.com`, ID de compte) — 10 min, **délai de
    traitement externe non maîtrisé** (jours à semaines, hors de notre
    contrôle).
11. Une fois l'accès approuvé : basculer sur les clés live, créer
    l'adresse de dépôt Tempo en production, exécuter le plan de test
    section 7 étape 5 — 45 min.
12. Mounter la découverte MPP (`mppx`'s `discovery()`) sur un chemin
    **distinct** de `/openapi.json` (ex. `/mpp/openapi.json`, voir le
    point de vigilance section 2) puis soumettre le service à l'annuaire
    (MPPScan self-service, et/ou PR `service.md` sur `tempoxyz/mpp`) —
    30 min.

## 9. Variables d'environnement à ajouter (noms seulement)

À ajouter au `.env` local **et** sur Render, jamais affichées en clair :

| Variable | Usage |
|---|---|
| `STRIPE_SECRET_KEY` | Clé secrète Stripe (test puis live), pour `mppx/stripe` et l'appel `stripe.paymentIntents.create()` |
| `STRIPE_PROFILE_ID` | Id du profil Stripe (`profile_...`), sert de `networkId` à `mppx` |
| `MPP_SECRET_KEY` | Clé HMAC de signature des défis MPP (dérivée de `STRIPE_SECRET_KEY`, générée une fois) |
| `TEMPO_DEPOSIT_ADDRESS` | Adresse de versement crypto Stripe sur le réseau Tempo (`network=tempo`) |
| `MPP_DEPOSIT_ADDRESS_BASE` | Adresse de versement crypto Stripe sur Base (`network=base`), pour le chemin x402-vers-Stripe spécifiquement — distincte de `PAY_TO_ADDRESS` (notre propre wallet) déjà en place |

## 10. Points non vérifiés / limites de cet audit

- **Interaction `mppx.tempo.session()` avec le backend `stripe()`** : les
  exemples officiels lus utilisent `session()` uniquement avec le backend
  `tempo()` natif (règlement direct sur Tempo, pas de conversion EUR) —
  aucun exemple trouvé combinant session + backend Stripe. Si le plancher
  de $0.01 de Stripe s'applique quand même par bon individuel (pas
  seulement à l'agrégat réglé), les 23 endpoints à $0.005 resteraient non
  viables même via session sur le rail Stripe. À tester directement
  (étape 6 du plan) avant de baser une décision de repricing dessus.
- **Frais exacts MPP/machine-payments** : aucun chiffre officiel publié
  au-delà des taux cartes génériques européens (1,5 % + 0,25 €, non
  spécifiques à MPP) — Stripe renvoie vers un contact commercial. Le coût
  réel par transaction ne sera connu qu'après activation du compte.
- **Délai d'approbation de l'accès stablecoin hors US** : demande par
  email, aucun SLA publié — impossible à planifier précisément (étape 10
  du plan).
- **Comportement exact du helper `mppx` `discovery()`** : signature lue
  (`unpkg.com`), mais jamais exécutée en pratique dans cet audit (audit
  sans code) — le risque de collision avec `/openapi.json` est déduit du
  type, pas observé en conditions réelles.
- **Fiabilité de la conversion automatique stablecoin → EUR** (taux de
  change appliqué, délai de virement — la doc dit seulement "varie selon
  le réseau") : non quantifié dans les sources publiques lues.
- **`GET /v1/crypto/deposit_addresses`** (création d'adresse de dépôt) a
  été vu avec deux valeurs de `Stripe-Version` différentes selon la page
  source (`2026-07-29.preview` pour MPP/Tempo, `2026-05-27.preview` pour
  x402/Base) — à utiliser exactement telles quelles selon le chemin choisi,
  ne pas supposer qu'une seule valeur convient aux deux.
