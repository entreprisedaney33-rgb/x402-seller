# Note reduction — cout du reseed hebdomadaire Bazaar

*Redigee le 2026-09-03.*

## Ce qui a change

Le reseed hebdomadaire (`scripts/seed-hebdo.js`, cron Render `x402-seed-hebdo`,
chaque lundi) ne paie plus la totalite du catalogue decouvert dynamiquement
(`.well-known/x402.json`) mais un **sous-ensemble fixe et configurable**,
liste dans la constante `SEED_PATHS` en tete du fichier :

```js
const SEED_PATHS = [
  "/api/defi/yields",
  "/api/defi/yields/top",
  "/api/defi/yields/by-token",
  "/api/defi/yields/by-chain",
  "/api/defi/yields/pool",
  "/api/gas/base",
  "/api/defi/price",
];
```

7 endpoints sur les 33 payants du service.

## Pourquoi

Le reseed complet coutait desormais **$0.440/run (~$1.90/mois)** depuis le
passage de la gamme `defi/yields` a $0.05 (voir
`docs/NOTE-PRIX-YIELDS-2026-09-03.md`) — a comparer aux **~$0.005 de revenu
tiers reel** encaisse depuis le lancement du service. Le cout de maintien de
l'indexation etait devenu trente fois superieur au seul revenu tiers observe
a ce jour : disproportionne, sans lien avec l'usage reel du service.

## Verification prealable : que declenche la desindexation Bazaar ?

**Verifie dans la documentation CDP a jour, pas suppose.** La desindexation
du catalogue Bazaar (CDP Coinbase Developer Platform) est **PAR ENDPOINT**,
pas par service entier :

- Un endpoint est retire du catalogue Bazaar et de la recherche apres **30
  jours consecutifs sans paiement reel reglé (settle)** sur cet endpoint
  precis — les autres endpoints du meme service, eux, restent indexes
  independamment de son sort.
- Un mecanisme separe de sonde de disponibilite (probes consecutifs en
  echec) peut aussi retrograder/retirer un endpoint du niveau "featured" —
  independant du paiement, non concerne par ce changement (le service
  repond normalement sur tous ses endpoints, reseedes ou non).
- Confirme par verification independante : recuperation directe (`curl`) de
  la page de documentation CDP concernee et recherche du passage exact
  ("30 days", "per endpoint") dans le HTML brut — pas une simple synthese
  d'un fetch automatise, deliberement recoupee vu l'enjeu de la decision.

**Consequence directe sur la strategie** : la frequence hebdomadaire du cron
etait deja 4x plus rapide que necessaire (30 jours de fenetre, reseed tous
les 7 jours) — le vrai levier de cout n'est donc pas la frequence mais la
**taille de la liste** d'endpoints reseedes. Reduire la liste plutot que
d'espacer les runs est la bonne strategie compte tenu de ce mecanisme.

## Nouveau cout

Prix reels verifies en production au 2026-09-03 (`endpoints/*.js`) :

| Endpoint | Prix |
|---|---|
| `/api/defi/yields` | $0.05 |
| `/api/defi/yields/top` | $0.05 |
| `/api/defi/yields/by-token` | $0.05 |
| `/api/defi/yields/by-chain` | $0.05 |
| `/api/defi/yields/pool` | $0.05 |
| `/api/gas/base` | $0.005 |
| `/api/defi/price` | $0.005 |
| **Total (7 endpoints)** | **$0.260/run** |

| | Avant (33 endpoints) | Apres (7 endpoints) |
|---|---|---|
| Cout par run | $0.440 | $0.260 |
| Cout mensuel (~4,3 runs) | ~$1.90 | **~$1.13** |

Reduction d'environ **41%** du cout mensuel de maintien de l'indexation.

## Garde-fou de solde ajuste

`MIN_BALANCE_USD` passe de `0.5` a **`0.3`** dans `scripts/seed-hebdo.js` —
ratio de marge conserve a l'identique de l'ancien garde-fou (~1.15x le cout
d'un run : $0.50 pour un run a $0.440, $0.30 pour un run a $0.26). Le run ne
peut jamais depasser $0.26 (un paiement n'est compte que s'il aboutit
reellement, voir `runSeed()` dans `scripts/lib/seed-core.js`), donc pas de
risque de depassement en cours de run — seule la marge de securite pour
absorber un futur ajout d'endpoint ou une hausse de prix a ete recalibree a
la baisse, proportionnellement au nouveau cout de reference.

## Risque assume

Les **26 endpoints retires de `SEED_PATHS`** (tout le catalogue sauf les 7
listes ci-dessus) ne recevront plus de paiement automatique hebdomadaire.
S'ils ne recoivent aucun paiement tiers reel dans l'intervalle, ils
**sortiront individuellement du catalogue Bazaar et de sa recherche apres 30
jours** sans paiement — un a un, independamment les uns des autres, jamais
le service entier. Consequence acceptee car limitee :

- Ces endpoints restent **servis normalement** (le serveur ne change rien a
  son comportement HTTP) et restent **listes** dans `.well-known/x402.json`
  et `openapi.json` — un agent qui connait deja l'URL ou decouvre le service
  autrement (README, dev.to, MCP) continue d'y avoir acces integral.
- Seule la **decouvrabilite via le catalogue/recherche Bazaar** est
  affectee pour ces 26 endpoints specifiquement.
- Si un besoin reel de reindexation apparait (nouveau client teste, gamme
  premium reseller a remettre en avant), il suffit d'ajouter le chemin
  concerne a `SEED_PATHS` — modification d'une ligne, pas de refonte.

## Validation en conditions reelles (mainnet, 2026-09-03)

Premiere tentative (18:16:27 UTC) : le garde-fou de solde a **refuse
proprement de continuer** ("Arret propre, aucune depense") suite a une
erreur transitoire du RPC public Base mainnet (`mainnet.base.org`,
"over rate limit") lors de la lecture du solde USDC — comportement voulu du
garde-fou (ne jamais depenser sans certitude sur le solde), pas un bug du
nouveau code. Nouveau declenchement manuel 4 minutes plus tard (18:20:43
UTC) : lecture du solde reussie ($3.68 USDC), run complet.

Resultat du run reussi : **7/7 paiements reussis, 0 echec, $0.260 depenses**
(exactement le montant calcule ci-dessus) :

| Endpoint | Statut | Montant | Hash |
|---|---|---|---|
| `GET /api/defi/price` | 200 | $0.005 | `0x320e4c88f2e5b6d606c0d2e462d8de8a4ea7614e1d1c145bd8bc034b1e67ccce` |
| `GET /api/defi/yields/by-chain` | 200 | $0.050 | `0x39dfd1ca9c0f738ed820f2c2362b7d3020f806dcaa63c3ca8edec6b199c6559e` |
| `GET /api/defi/yields/by-token` | 200 | $0.050 | `0x4adf759dca07f07e3a9e15d5287b09a63aab78282c32329a2b68e110d6d72857` |
| `GET /api/defi/yields/pool` | 200 | $0.050 | `0xecb0d5e2d3cc0995066ab5eefaefa972bf609ba2f82192f82f0f6d346dab5d5f` |
| `GET /api/defi/yields/top` | 200 | $0.050 | `0x4f4decfe3a02a1aa81ba927670963855c57612ab6e1d4021e5e7ed794ec9fb06` |
| `GET /api/defi/yields` | 200 | $0.050 | `0xbbcae280e2254b4b2c775bd63f2d8e319839becaf24c51694faab521f6cdf64e` |
| `GET /api/gas/base` | 200 | $0.005 | `0x99c4d0cac21b37188e9c43bd3c911700098f613de2c163bec528443f950cac90` |

Deploiement Render confirme sur le commit `feb9ce7` (`live`) avant de
declencher ce run — le cron pointe bien sur la nouvelle version.

## Reponses aux 3 questions posees

1. **Ce qui declenche la desindexation Bazaar** : par endpoint, apres 30
   jours sans paiement regle sur cet endpoint precis — pas par service
   entier. Voir section dediee ci-dessus.
2. **Nouveau cout mensuel** : **~$1.13/mois** (contre ~$1.90/mois avant),
   soit une reduction d'environ 41%.
3. **Liste finale des 7 endpoints reseedes** : `/api/defi/yields`,
   `/api/defi/yields/top`, `/api/defi/yields/by-token`,
   `/api/defi/yields/by-chain`, `/api/defi/yields/pool`, `/api/gas/base`,
   `/api/defi/price`.
