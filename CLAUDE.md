# CLAUDE.md — x402-seller ("Datapéage")

## Résumé (5 lignes)

Serveur de vente d'API à l'appel via le protocole x402 (paiements USDC sur Base), conçu pour être payé par des agents IA plutôt que par des humains. 31+ endpoints payants : données crypto/DeFi, données on-chain, données publiques, tâches IA (Claude), et une gamme "premium reseller" (Tavily, Serper). Premier client réel confirmé le 02/09/2026 (un wallet inconnu a payé automatiquement, moins de 24 h après la mise en ligne) — preuve que le mécanisme marche avec un tiers réel, pas seulement en test. Aussi publié comme serveur MCP (`mcp/`) sur npm/Smithery/le registre officiel, pour les agents type Claude Desktop. Marque future : **Datapéage** (pas encore migré, le dépôt et les annuaires sont encore sous le nom `x402-seller`).

## Périmètre strict

- Ne travaille QUE dans `~/Desktop/cryptomonnaie` — ne touche jamais à `labo-ia`, Jarvis, MCS, ou tout autre dossier, même si une session précédente semble l'avoir fait.
- **N'affiche jamais le contenu du `.env`** ni aucune valeur de secret (clé, token, adresse privée) dans une réponse, une commande visible, ou un fichier committé. Pour lire une valeur nécessaire à une commande, `source .env` dans un `set -a; ...; set +a` et utilise la variable shell — ne jamais `cat`/`grep`/imprimer le fichier lui-même.
- Une session concurrente (un autre humain ou une autre session Claude Code) peut éditer ce dépôt en parallèle — toujours `git status`/`git log` frais avant de committer, ne jamais `git add -A` à l'aveugle, ne jamais écraser un fichier modifié depuis la dernière lecture sans le relire.

## Où vivent les choses

- **`.env`** — toutes les clés/secrets, jamais commité (voir `.gitignore`). Variables actuelles (noms seulement) :
  | Variable | À quoi elle sert |
  |---|---|
  | `NETWORK` | `base-sepolia` (test, par défaut) ou `base` (mainnet réel) |
  | `PAY_TO_ADDRESS` | Adresse EVM qui reçoit les paiements (encaissement) |
  | `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | Authentifient le facilitateur Coinbase CDP en mainnet (verify/settle des paiements) |
  | `BUYER_PRIVATE_KEY` | Clé du portefeuille acheteur de **test**, jetable — jamais côté serveur en prod |
  | `ANTHROPIC_API_KEY` | Appels Claude pour les endpoints IA (`/api/ai/*`, `/api/web/extract`) |
  | `GITHUB_TOKEN` | Relève le plafond de requêtes GitHub (60/h → 5000/h) pour `/api/github/repo` |
  | `STATS_KEY` | Protège la route privée `GET /stats/daily` (revenu détaillé, payers) |
  | `TAVILY_API_KEY` | Fournisseur de recherche web + extraction, pour `/api/search/web` et `/api/web/scrape` |
  | `SERPER_API_KEY` | Fournisseur de résultats Google structurés, pour `/api/search/serp` |
  | `RENDER_API_KEY` | Gère le service/cron Render par API (déploiements, variables d'environnement) |
  | `SMITHERY_API_KEY` | Publie le serveur MCP (`mcp/`) sur l'annuaire Smithery |
  | `DEVTO_API_KEY` | Met à jour l'article publié sur dev.to via son API |
  | `N8N_API_KEY` / `N8N_URL` | Réservées pour un futur rapport Telegram via n8n — **non câblées actuellement**, aucun code ne les utilise encore |
  | `BASE_URL` | URL publique annoncée aux agents (jamais déduite de l'hôte de la requête entrante) |
  | `PORT` | Port du serveur (fourni automatiquement par Render en prod, 4021 en local) |
- **`docs/PROJET-X402-DOSSIER-V2.md`** — dossier de référence complet : stratégie, paliers d'investissement, chronologie, backlog priorisé, comptes/annuaires, rituel hebdomadaire. À lire en premier pour tout contexte au-delà du code lui-même.
- **`logs/`** — journaux applicatifs (paiements, sondages 402, coûts amont premium, résumés de seed), jamais commités. Chemin réel piloté par `DATA_DIR` (défaut `./logs` en local ; en prod, doit pointer vers un disque persistant Render, sinon perdu à chaque déploiement).
- **Render** — service `srv-dabgpngjo6nc739as6u0` (le serveur lui-même, plan Starter, disque persistant 1 Go, auto-deploy sur push) ; cron job `crn-dac0ufnavr4c73b38ki0` (`x402-seed-hebdo`, reseed complet chaque lundi pour que le catalogue Bazaar ne se désindexe pas).
- **GitHub** : `entreprisedaney33-rgb/x402-seller` (public, historique audité sans secrets).
- **URL de prod** : https://x402-seller-0ay3.onrender.com
- **`mcp/`** — sous-projet séparé : le même catalogue d'endpoints exposé comme outils MCP (serveur stdio, publié sur npm/Smithery/le registre officiel MCP). Son propre `package.json`, ne pas mélanger avec les dépendances racine.

## Commandes utiles

```bash
npm start                    # démarre le serveur (local, NETWORK=base-sepolia par défaut)
npm run buyer-test           # paie un endpoint en réel sur le serveur local (ENDPOINT_PATH/METHOD/BODY en env)
npm run buyer-test:prod      # idem, mais contre https://x402-seller-0ay3.onrender.com
npm run seed                 # amorce le catalogue Bazaar (tous les endpoints payants découverts dynamiquement)
npm run seed -- --only=/api/gas/base,/api/gas/ethereum   # amorce seulement certains chemins
npm run bazaar                # vérifie l'état d'indexation Bazaar
npm run seed-hebdo            # relance manuellement le seed complet (celui que le cron Render exécute chaque lundi)
npm run cle                   # importe la clé CDP depuis CLE_API_CDP.txt vers le .env
```

## Règles de méthode

- **Vérifier la doc/version des packages avant de coder** — ne jamais deviner la forme d'une API (`@x402/*`, SDK MCP, etc.), les versions changent vite sur ce projet.
- **Lire les CGU du fournisseur AVANT de construire un endpoint de revente.** Deux fournisseurs ont déjà été écartés (Exa, Firecrawl) parce que leurs CGU interdisent explicitement la revente commerciale — voir README "Premium reseller" pour la méthode et le raisonnement complets.
- **Tester sur testnet (`base-sepolia`) d'abord**, puis confirmer avec un vrai paiement mainnet avant de considérer un endpoint fini — le facilitateur testnet ne reproduit pas forcément les mêmes échecs que le facilitateur CDP mainnet (un vrai bug de ce genre a déjà été trouvé et documenté dans `endpoints/web-scrape.js`).
- **Descriptions d'endpoint honnêtes, jamais une capacité non vérifiée.** Si une capacité n'a pas été testée contre un cas réel, dire ce qui est réellement vérifié plutôt que ce qui est espéré.
- **Diagnostiquer un run `seed-hebdo`/cron en échec : lire `GET /v1/logs?resource=<id>` (l'API Render n'a pas d'endpoint dédié "liste des runs" — reconstruire l'historique à partir des marqueurs texte `Cron job run started` / `finished successfully` / `Your cronjob failed`, triés par horodatage), pas juste l'alerte reçue — elle peut concerner un run ancien déjà résolu.** Signal utile : des endpoints **sans rapport entre eux qui échouent ensemble, consécutifs dans le tableau de résultats** (jamais dispersés au hasard) = quasi toujours une coupure d'infra (réseau Render transitoire, ou le **serveur CIBLE** `x402-seller` en plein redéploiement — ce plan Render, Starter + disque persistant, désactive les déploiements sans coupure : l'ancienne instance est arrêtée avant que la nouvelle démarre), jamais un bug de code. Vérifier `GET /v1/services/<serveur cible>/deploys` pour une fenêtre de déploiement qui chevauche l'horodatage des échecs avant de chercher plus loin.

## Incidents résolus

### 02/09/2026 — Alerte cron "Exited with status 1"
Alerte reçue sur `x402-seed-hebdo`. Diagnostic (voir méthode ci-dessus) : l'alerte
correspondait à un run **antérieur à l'existence de `scripts/seed-hebdo.js` dans le
commit déployé** (11:58/12:01 UTC, avant que le script soit même poussé) — déjà
compris, rien à corriger côté cron. En revalidant quand même (le cron avait grossi
entretemps, 31→34 endpoints avec l'ajout de la gamme premium reseller), 2 échecs
réels supplémentaires sont apparus, **aucun des deux dû au cron lui-même** : un
creux réseau transitoire sur l'infra Render (~20s, 5 endpoints sans rapport —
GitHub/HN/npm/DefiLlama — tombés ensemble puis repartis normalement), puis le
serveur cible en plein redéploiement pendant le run (une autre session avait
poussé un commit exactement à ce moment). Validé propre après ré-essai :
**34/34, $0.235 dépensés, solde restant $3.745 USDC**.
