# Note prix — gamme `defi/yields`, test d'élasticité

*Rédigée le 2026-09-03. **Relecture prévue le 2026-09-17** (2 semaines après le changement) — comparer les payeurs tiers observés à cette date avec le "avant" et le "premier avant" ci-dessous, décider de garder $0.05, ajuster, ou revenir à $0.005 selon le résultat réel.*

## Ce qui a changé

Le **03/09/2026**, le prix des 5 endpoints de la gamme yields est passé de **$0.005 à $0.05** (×10) :

| Endpoint | Avant | Après |
|---|---|---|
| `GET /api/defi/yields` | $0.005 | $0.05 |
| `GET /api/defi/yields/top` | $0.005 | $0.05 |
| `GET /api/defi/yields/by-token` | $0.005 | $0.05 |
| `GET /api/defi/yields/by-chain` | $0.005 | $0.05 |
| `GET /api/defi/yields/pool` | $0.005 | $0.05 |

Tous les autres endpoints du service sont **inchangés** — ils servent de groupe témoin pour distinguer un effet propre à ce changement de prix d'un effet de marché/trafic général sur l'ensemble du service.

Pourquoi la gamme yields spécifiquement : c'est la **seule famille d'endpoints qui a converti** un vrai payeur tiers à ce jour (voir "Avant" ci-dessous) — la seule sur laquelle un test d'élasticité au prix a un signal réel à mesurer, plutôt que de tester sur du bruit (zéro conversion).

## Pourquoi ce prix précisément ($0.05, pas $0.01 ou $0.02)

Le marché x402/paiements agent s'est déplacé vers des transactions **au-dessus d'un dollar** depuis le début de l'année — la bande **$0.10–$1** s'est effondrée de **46% à 4%** du volume de transactions selon Chainalysis (couverture 2026 des paiements on-chain agent-à-agent). Un prix à $0.005-$0.01 se situe dans une zone de micro-paiement dont le poids relatif dans le volume réel du marché a fortement diminué — l'hypothèse testée ici est qu'un prix plus proche de ce que le marché paie réellement (même encore loin d'1$) convertit mieux, ou en tout cas ne détruit pas la conversion existante, qu'un prix qui ressemble à du bruit de dust.

$0.05 reste volontairement **modéré** (×10, pas ×20 ou ×40) : un premier palier pour observer une vraie réaction sans sortir d'un coup de la fourchette où les 33 endpoints du service se situent aujourd'hui (voir `docs/RAPPORT-P1-PREMIUM.md` pour les gammes premium à $0.01/$0.02, déjà plus chères que le tarif de base $0.005).

## Avant (baseline, capturée juste avant le déploiement du 03/09, 17:32 UTC)

Payeurs tiers (hors wallet de test) sur la famille yields, cumulés depuis le début (`all_time`) :

| Endpoint | Paiements tiers (7j) | USDC tiers (7j) | USDC tiers (all_time) |
|---|---|---|---|
| `/api/defi/yields` | 1 | $0.005 | $0.005 |
| `/api/defi/yields/top` | 0 | $0.000 | $0.000 |
| `/api/defi/yields/by-token` | 0 | $0.000 | $0.000 |
| `/api/defi/yields/by-chain` | 0 | $0.000 | $0.000 |
| `/api/defi/yields/pool` | 0 | $0.000 | $0.000 |
| **Total famille** | **1** | **$0.005** | **$0.005** |

Un seul paiement tiers, jamais reproduit depuis, sur un seul des 5 endpoints (`/api/defi/yields`). C'est la totalité du signal de conversion disponible avant ce changement — la baseline est donc minuscule par construction, pas un choix de méthode : le service est jeune (moins de 2 semaines d'existence complète à cette date) et le volume tiers réel, tous endpoints confondus, reste de l'ordre de l'unité par semaine (voir `GET /stats` en production).

## Après (à compléter à la relecture du 17/09)

*À remplir le 2026-09-17 en interrogeant `GET https://x402-seller-0ay3.onrender.com/stats` (endpoint public, `endpoints["/api/defi/yields"].payments.tiers`, etc. pour les 5 endpoints de la gamme) et en comparant au groupe témoin (les 28 autres endpoints, restés à $0.005 et plus) pour isoler un effet propre au prix.*

| Endpoint | Paiements tiers (depuis le 03/09) | USDC tiers |
|---|---|---|
| `/api/defi/yields` | — | — |
| `/api/defi/yields/top` | — | — |
| `/api/defi/yields/by-token` | — | — |
| `/api/defi/yields/by-chain` | — | — |
| `/api/defi/yields/pool` | — | — |
| **Total famille** | — | — |

Groupe témoin (reste du service, hors gamme yields) sur la même période — pour juger si un mouvement observé sur yields est spécifique au prix ou reflète juste plus/moins de trafic général :

| | Paiements tiers | USDC tiers |
|---|---|---|
| Reste du service (28 endpoints, prix inchangés) | — | — |

## Impact sur le cron de seed hebdomadaire (`scripts/seed-hebdo.js`)

Le seed complet (mode `full`, tous les endpoints payants découverts dynamiquement depuis `.well-known/x402.json`, jamais une liste figée — voir `scripts/lib/seed-core.js`) paie **réellement** chaque endpoint pour maintenir l'indexation Bazaar active. Les 5 endpoints yields en font partie.

Coût d'un run complet, calculé sur les 33 endpoints payants réellement découverts en production le 03/09 (aucun échec) :

- **Avant** : $0.215 (33 endpoints, tous à $0.005–$0.02 selon la gamme)
- **Après** : $0.215 − (5 × $0.005) + (5 × $0.05) = **$0.440**

Le garde-fou de solde acheteur (`MIN_BALANCE_USD = 0.5` dans `scripts/seed-hebdo.js`) **reste cohérent** au sens strict — $0.50 > $0.440, le run peut toujours se financer intégralement au seuil minimum. Mais la marge de sécurité s'est réduite : elle passe de **$0.285 (57% du seuil)** à **$0.06 (12% du seuil)**. Aucun run ne devrait dépasser $0.440 (un paiement n'est compté que s'il aboutit réellement — voir `runSeed()` dans `seed-core.js`, un échec même après retry ne coûte rien), donc pas de risque de dépassement du seuil en cours de run ; mais la marge restante pour absorber un futur ajout d'endpoint payant, ou une future hausse de prix ailleurs, est nettement plus mince qu'avant. **Pas modifié dans cette session** (l'instruction demandait de vérifier la cohérence, pas de changer le seuil) — à relever à $0.60-$0.70 si d'autres endpoints sont ajoutés ou repricés à la hausse.

## Validation technique (03/09/2026)

- **Testnet** (`base-sepolia`, local) : paiement réel effectué sur `GET /api/defi/yields` via `scripts/buyer-test.js` — 402 reçu, paiement réglé, réponse renvoyée, `logs/paiements.jsonl` confirme `"montant":"$0.05"`. Hash : `0xdf8ee4bac0fcc1a9e6ab95d0a76153ef83986e761c1132587e5dba621b534027` (Base Sepolia).
- **Découverte** : `.well-known/x402.json` et `openapi.json` vérifiés en local — les 5 endpoints yields à $0.05, le reste du catalogue inchangé (contrôle sur `defi/price`, `defi/tvl`, `defi/tvl-chain`).
- **Snapshot MCP** (`mcp/tools-snapshot.json`) : **pas régénéré dans cette session** — ce fichier est un instantané figé, généré à `npm publish` (script `prepublishOnly` → `npm run snapshot`, qui refetch `.well-known/x402.json` en direct). Tant que `npm publish` n'est pas relancé, le paquet MCP publié continue d'annoncer $0.005 sur ces 5 outils — écart connu, sans impact sur le serveur HTTP lui-même (qui fait foi), à corriger au prochain republish npm.
- **Mainnet** : paiement réel de validation effectué en production sur `GET /api/defi/yields`, wallet de test (le même que le testnet, `0x216373E6A79E75BE5913355C983985DD78EE9fC2` — donc bien compté en `total`, jamais en `tiers`, vérifié via `GET /stats` juste après : `montant_usdc.total.last_24h` +$0.05, `montant_usdc.tiers.last_24h` inchangé à $0). Hash : `0x96eba6188e6887a6523491b2e3ea046d73e548beb043ce3d956f44f19aefbc51` (Base mainnet, [basescan.org](https://basescan.org/tx/0x96eba6188e6887a6523491b2e3ea046d73e548beb043ce3d956f44f19aefbc51)).
