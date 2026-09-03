# Note — passage en mode passif

*Redigee le 2026-09-03.*

## Ce qui a change

Changement de cap : le projet **arrete d'entretenir activement son
indexation dans les annuaires** (CDP Bazaar). Concretement :

- Le cron Render **`x402-seed-hebdo`** (`crn-dac0ufnavr4c73b38ki0`) a ete
  **suspendu** via l'API Render (`POST /v1/services/{id}/suspend`,
  confirme par `GET` : `"suspended":"suspended"`) — **pas supprime**. Sa
  configuration (schedule `0 6 * * 1`, commande, variables d'environnement,
  le fichier `scripts/seed-hebdo.js` avec son sous-ensemble `SEED_PATHS`
  reduit du 03/09, voir `docs/NOTE-REDUCTION-SEED-2026-09-03.md`) reste
  intacte, prete a reprendre a l'identique.
- `scripts/seed-hebdo.js` **n'a pas ete modifie** dans ce changement — il
  portait deja la version reduite a 7 endpoints (dernier commit
  `2877125`/`feb9ce7`).
- **Aucun endpoint touche.** Le serveur `x402-seller`
  (`srv-dabgpngjo6nc739as6u0`) continue de tourner normalement, sert les 33
  endpoints payants comme avant, et continue de logger les requetes 402 et
  les paiements reels dans `logs/` (disque persistant Render, 1 Go).

## Pourquoi

Le cout du reseed hebdomadaire ($0.26/run, ~$1.13/mois — voir
`docs/NOTE-REDUCTION-SEED-2026-09-03.md`, elle-meme deja une reduction d'un
premier cout de $0.44/run) restait a fonds perdus tant qu'aucun revenu tiers
significatif ne le justifiait (~$0.005 encaisses depuis le lancement). Plutot
que de continuer a optimiser le cout d'un mecanisme qui maintient une
visibilite dont l'utilite reelle n'est pas demontree, le projet passe en
mode passif : le service reste disponible et continue de capter tout signal
reel (paiement spontane, requete 402 d'un agent qui l'a decouvert
autrement), sans depense recurrente pour forcer son referencement.

## Cout mensuel resultant

| Poste | Cout | Etat |
|---|---|---|
| Service `x402-seller` (plan Starter, 0.5 CPU / 512 Mo) | ~$7.00/mois | actif, inchange |
| Disque persistant (1 Go, `x402-seller-data`) | ~$0.25/mois | actif, inchange |
| Cron `x402-seed-hebdo` (compute) | $0.00/mois | **suspendu, aucune execution** |
| Depense USDC de reseed | $0.00/mois | **arretee** (etait ~$1.13/mois) |
| **Total** | **~$7.25/mois** | |

Avant ce changement, le total etait ~$8.38/mois (~$7.25 d'infra + ~$1.13 de
reseed). Le mode passif retire integralement le poste de reseed.

## Ce qui reste actif

- Le serveur HTTP repond normalement sur ses 33 endpoints payants (aucun
  n'a ete modifie, retire, ou reprice dans ce changement).
- `.well-known/x402.json` et `openapi.json` continuent d'annoncer
  l'integralite du catalogue — un agent qui decouvre le service par un
  autre canal (README GitHub, article dev.to, serveur MCP publie sur
  npm/Smithery) a toujours acces a tout, paiement x402 normal.
- Le logging continue sans interruption : `logs/paiements.jsonl` (chaque
  paiement regle, tiers ou test), les sondes 402 recues, et le suivi des
  couts amont premium (Tavily/Serper) — le signal (un vrai payeur tiers qui
  se presente) reste entierement capte meme sans aucune action active de
  notre part.
- `GET /stats` (public) et `GET /stats/daily` (prive, `STATS_KEY`) restent
  interrogeables a tout moment pour verifier si un signal apparait.

## Ce qui s'arrete

- Plus aucun paiement automatique hebdomadaire vers les 7 endpoints de
  `SEED_PATHS` (ni, a fortiori, vers les 26 autres, deja hors de la liste
  depuis le 03/09).
- Consequence deja anticipee dans la note du 03/09 (reduction) et
  desormais totale : **tous** les endpoints (les 33, pas seulement les 26
  precedemment exclus) sortiront individuellement du catalogue de recherche
  CDP Bazaar apres 30 jours sans paiement reel regle sur chacun d'eux — le
  mecanisme verifie est **par endpoint**, jamais par service entier (voir
  `docs/NOTE-REDUCTION-SEED-2026-09-03.md` pour le detail et la citation).
  Ceci est le risque assume et voulu de ce changement, pas un effet de bord
  imprevu.

## Pour redemarrer

Si un signal reel justifie de reprendre l'entretien de l'indexation :

1. Reactiver le cron : `POST /v1/services/crn-dac0ufnavr4c73b38ki0/resume`
   (API Render) — la configuration (schedule, commande, env) est intacte,
   aucune reconfiguration necessaire.
2. Optionnel : ajuster `SEED_PATHS` en tete de `scripts/seed-hebdo.js`
   selon ce que le signal a montre pertinent (par exemple ne reactiver que
   la gamme ayant converti un vrai payeur), plutot que de revenir d'office
   au sous-ensemble de 7 ou au catalogue complet.
3. Verifier le solde du portefeuille acheteur (`BUYER_PRIVATE_KEY`,
   `MIN_BALANCE_USD=0.3` actuel) avant la premiere reprise — le garde-fou
   refuse de tourner sans solde suffisant, aucun risque de depense a vide.
4. Declencher un run manuel de validation
   (`POST /v1/cron-jobs/{id}/runs`) et verifier ses logs avant de laisser
   le cron reprendre son rythme hebdomadaire automatique.

Aucune donnee n'est perdue entre-temps : le serveur, ses logs, et la
configuration du cron restent en l'etat pendant toute la duree du mode
passif.
