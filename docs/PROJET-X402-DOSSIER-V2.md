# Projet x402 « Datapéage » — Dossier de référence v2
*Mis à jour le 02/09/2026 (soir) · Remplace la v1 · À placer dans les connaissances du projet Claude « x402 » ET dans ~/Desktop/cryptomonnaie/docs/*

---

## 0. Le fait majeur depuis la v1

**Premier client réel le 02/09/2026 à 06h01 (Paris), moins de 24 h après la mise en ligne** : le wallet inconnu `0x09C32b8F…29667bEeE` a payé 0,005 USDC pour `GET /api/defi/yields`, réglé on-chain via le facilitateur (tx `0x3fb4e258269a1e3334630506f675a6126b7bec390ecea297cd0d8a275a366f04`). La même nuit : ~2 400 sondages 402 (agents/crawlers qui regardent sans payer). La thèse « une IA fait une tâche et est payée automatiquement » est prouvée avec un tiers réel. Conversion typique du marché : ~3 payés pour ~2 400 regardés — le tunnel est massif en haut, minuscule en bas.

## 1. La thèse et la stratégie

Matheo (entrepreneur, Bordeaux, dev/IA confirmé) parie que l'économie des agents exigera des paiements machine-à-machine et que x402 (USDC sur Base ; fondation Linux avec Coinbase, Cloudflare, Visa, Google, Stripe…) est le rail le plus probable. Marché actuel minuscule (~1,1 M$/30 j, −93 % YTD, top vendeur ~3 100 $/mois). Stratégie : **détenir une option à faible coût, être dans le haut du panier en distribution et en fiabilité le jour où le volume revient**, en suivant le modèle du n°1 (StableEnrich = agrégateur-revendeur d'API premium à l'appel).

**Paliers d'investissement à déclencheurs** (jamais d'avance sans signal) :
- P1 (FAIT, ~0 € de fixe) : revente premium à l'appel via fournisseurs prépayés — Tavily + Serper.
- P2 (déclencheur : ~10 payers inconnus/semaine) : passerelle LLM à coût +15-20 %.
- P3 (déclencheur : GA Cloudflare Monetization Gateway — waitlist faite) : mettre le catalogue derrière.
- P4 (déclencheur : un endpoint > ~50 $/mois) : abonnement data premium 50-100 $/mois revendu à l'appel (le vrai cap StableEnrich).

**Attentes calibrées** : médiane 6 mois ≈ 0-5 € ; « réussite » = payers inconnus récurrents, pas le CA. Règles : endpoint sans payer inconnu à 60 jours → retiré ; bilan fin septembre 2026 ; ≤ quelques heures/mois de temps, le travail qui paie les factures reste prioritaire.

## 2. Infrastructure en production

- **Serveur** : https://x402-seller-0ay3.onrender.com — Node/Express ESM, `@x402/*` v2, facilitateur CDP mainnet (`eip155:8453`), x402.org en testnet. Dossier local : `~/Desktop/cryptomonnaie` (périmètre strict, séparé de labo-ia/Jarvis/MCS).
- **Code** : GitHub `entreprisedaney33-rgb/x402-seller` (public, historique audité sans secrets).
- **Render** : service `srv-dabgpngjo6nc739as6u0`, plan Starter (7 $/mois, plus de veille ; le champ API affiche `0.5c-512mb`), **disque persistant 1 Go** sur `/var/data` (`DATA_DIR`) — stats et logs survivent aux déploiements (les deploys ne sont plus zero-downtime, accepté). AutoDeploy sur push.
- **Cron Job Render** `x402-seed-hebdo` (`crn-dac0ufnavr4c73b38ki0`, ~1 $/mois) : chaque lundi 06:00 UTC (08 h Paris l'été), reseed complet du catalogue (~0,17 $) pour que le Bazaar CDP ne désindexe pas ; retry 1×/endpoint ; garde-fou : s'arrête si solde acheteur < 0,50 $ ; run de validation 31/31 réussi le 02/09.
- **Endpoints payants** (~31, bientôt 34) : données DeFi/crypto DefiLlama (prix, TVL, protocols, stablecoins + gamme **yields** densifiée le 02/09 : `yields`, `yields/top`, `yields/by-token`, `yields/by-chain`, `yields/pool`) ; prix dédiés eth/btc/sol-usd, usdc-supply ; on-chain RPC (gas/block, base+ethereum) ; données publiques (BCE fx, GitHub avec token, npm, HN, Wikipédia, DNS, RDAP) ; tâches IA Claude Haiku (summarize/classify/translate 0,01 $, extract 0,02 $) ; lecture web maison `web/read` + `web/extract` (garde SSRF). **En cours de livraison (P1 premium)** : `POST /api/search/web` (Tavily), `POST /api/search/serp` (Serper), `POST /api/web/scrape` (Tavily Extract — positionnement « hard sites » à confirmer par les tests qualité, sinon description modeste). Prix ≈ coût amont ×2 ; marge réelle par appel loggée dans `logs/couts.jsonl`.
- **Encaissement** : compte Base « x402 » du Ledger → `0x5c3DB195a38f39074d8c891741A82f6D8f2A16Cc` (aucune clé privée d'encaissement nulle part).
- **Wallet acheteur de test** : `0x216373E6A79E75BE5913355C983985DD78EE9fC2` (clé = `BUYER_PRIVATE_KEY` du `.env` + variable du cron ; jetable, ~4,5 $ ; recharge quand < 0,50 $ : envoyer 5 USDC depuis Coinbase, réseau **Base**). Tout paiement venant de cette adresse = Matheo lui-même ; **payer inconnu = toute autre adresse**.
- **Observabilité** : chaque 402 et chaque paiement loggés (DATA_DIR) ; `GET /stats` public (compteurs + montants, sans adresses) ; `GET /stats/daily?key=STATS_KEY` privé (payers inconnus listés) ; **tuile « Crypto x402 » dans la PWA jarvis-app** (montants 24 h/7 j/total + top 5). Workflow n8n « x402 - rapport quotidien » créé mais inactif.
- **Coût de fonctionnement total** : ~8,25 $/mois (Starter 7 + cron 1 + disque 0,25) + ~0,17 $/sem de seed recyclé vers le Ledger.

## 3. Distribution (10 surfaces) — état au 02/09 soir

| Surface | État |
|---|---|
| Bazaar CDP | Indexé (auto via paiements ; le cron l'entretient) |
| x402scan | Enregistré (openapi + SIWX) |
| Agentic.Market | Indexé auto |
| x402 Arena | `gas/base` verified (id 341) ; autres GET ajoutables |
| awesome-x402 | PR #1408 **ouverte**, en attente (424 PR en file) |
| npm | `x402-seller-mcp@0.1.1` (compte `dm2233`, 2FA par **e-mail**, publication via web-login) ; 0.1.2 en cours (fix Smithery) |
| Smithery | Publié (`entreprisedaney33/x402-seller-mcp`) mais fiche vide, score 28/100 — **correctif en cours** : description + snapshot d'outils embarqué pour que leur scanner liste les 31 outils |
| Glama | Soumis, **en examen** ; ⚠️ un homonyme « x402-seller » (io.github.wyattpalm2-eng) y est déjà indexé |
| Registre MCP officiel | **Actif** : `io.github.entreprisedaney33-rgb/x402-seller-mcp` |
| dev.to | Article publié (~200+ lectures), **mis à jour le 02/09 avec le premier acheteur** (hash en preuve) |

## 4. Marque : Datapéage

Nom choisi le 02/09 : **Datapéage** (ASCII `datapeage`) — péage pour les données, unique partout, remplace « x402-seller » (collision avec l'homonyme). **Migration APRÈS la fin des chantiers en cours** : réserver `datapeage.com` (à faire, ~10 €/an), puis nouveau package npm avec dépréciation/renvoi de l'ancien, alias sur les annuaires, renommage du dépôt avec redirection GitHub. Rien n'est encore migré.

## 5. Secrets et comptes (noms seulement — les valeurs vivent dans `~/Desktop/cryptomonnaie/.env`, jamais dans ce document)

`.env` : NETWORK (base-sepolia en local), PAY_TO_ADDRESS, CDP_API_KEY_ID/SECRET, BUYER_PRIVATE_KEY, ANTHROPIC_API_KEY, GITHUB_TOKEN, STATS_KEY, RENDER_API_KEY, SMITHERY_API_KEY, DEVTO_API_KEY, TAVILY_API_KEY, SERPER_API_KEY, BASE_URL, PORT.
Sur Render (service) : NETWORK=base, PAY_TO_ADDRESS, CDP_*, ANTHROPIC_API_KEY, GITHUB_TOKEN, STATS_KEY, BASE_URL, DATA_DIR, TAVILY/SERPER (en cours). Sur le cron : TARGET_URL, BUYER_PRIVATE_KEY.
Comptes : CDP (portal.cdp.coinbase.com), npm `dm2233`, dev.to `entreprisedaney33rgb`, GitHub/Smithery/Glama `entreprisedaney33(-rgb)`, Tavily + Serper (paliers gratuits, crédits seulement si consommation), Render workspace Pro.
**⚠️ Rotations en attente** : RENDER_API_KEY et clé API n8n (affichées en clair dans le terminal le 01/09) → régénérer puis mettre à jour `labo-ia/.secrets/` et le `.env`.

## 6. Backlog priorisé

1. Finir P1 premium : tests qualité Tavily Extract → description honnête → seed mainnet → suivre `logs/couts.jsonl` (la **marge** est le chiffre, pas le CA).
2. Vérifier le correctif Smithery après leur rescan (description + outils visibles, score).
3. Réserver `datapeage.com` ; migration de marque quand 1 et 2 sont clos.
4. Rotation des clés Render + n8n.
5. Sécuriser la filière yields (l'endpoint qui a converti dépend de DefiLlama, CGU fragile — remplacement on-chain/Chainlink à terme).
6. Surveiller : GA Cloudflare Gateway (mail waitlist), PR #1408, examen Glama, prochain run du cron (lundi).
7. Conditionnels à déclencheurs : P2 passerelle LLM, P4 abonnement premium, x402 Arena pour plus de GET.

## 7. Rituel hebdomadaire (30 min, le lundi)

Tuile Crypto x402 + `/stats/daily` (payers inconnus ?) → rapport du cron (réussites, dépense, solde) → `logs/couts.jsonl` (marge premium) → 3 liens de veille : x402scan (volume marché), blog Cloudflare (GA Gateway), doc Stripe MPP (dispo France). Tout écart notable → en discuter dans le projet avant d'agir. En dehors de ça : **ne rien toucher**.

## 8. Méthode de travail (à respecter dans chaque discussion)

Une instruction à la fois : Claude (stratégie) rédige des prompts complets et cadrés → Matheo les colle dans Claude Code (exécution) → le résumé revient pour analyse. Chaque prompt commence par le périmètre (« Tu travailles uniquement dans ~/Desktop/cryptomonnaie ») et interdit d'afficher les secrets. Vérifier docs/packages à jour avant de coder (ne jamais deviner une API). CGU des sources vérifiées AVANT tout endpoint de revente. Tests testnet d'abord, un paiement mainnet de validation ensuite. Honnêteté totale sur les chiffres (c'est un avantage de crédibilité). Expliquer les « pourquoi » en 1-2 phrases. Ne jamais promettre à un agent ce qui n'a pas été vérifié.

## 9. Chronologie éclair

01/09 : idée → recherche marché → boucle prouvée testnet puis mainnet → 27 endpoints → production Render → anglais + web/read → Starter + disque → 10 surfaces → tuile Jarvis → wrapper MCP (npm/Smithery/registre) dans la nuit. 02/09 : **premier payer inconnu à 06h01** (yields) → gamme yields (31 endpoints) → article mis à jour → cron seed hebdo → stratégie « haut du panier » + P1 premium lancé (Tavily/Serper validés CGU, Firecrawl écarté) → nom Datapéage choisi → correctif Smithery en cours. Dépenses cumulées : ~1 $ de paiements de test (recyclés vers le Ledger) + ~8,25 $/mois d'infra.
