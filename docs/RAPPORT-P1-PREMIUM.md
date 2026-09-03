# Rapport P1 premium reseller — Tavily & Serper

*Rédigé le 2026-09-03, mis à jour deux fois le même jour. **Chantier P1 clos ce jour avec 2 endpoints premium, pas 3** — `POST /api/web/scrape` a été retiré après le test comparatif du §4 ; voir §5 pour le détail du retrait, du déploiement et de la vérification en production. Le corps du rapport ci-dessous (§0 à §4) est conservé tel quel comme trace de l'investigation qui a mené à cette décision — certaines affirmations qu'il contient (ex. "pas encore déployé") sont datées et supplantées par §5.*

## Résumé final (2 endpoints premium)

| Endpoint | Prix vente | Coût amont réel | Marge $ | Marge % | Appels payés (dont tests) | Payers inconnus | Statut |
|---|---|---|---|---|---|---|---|
| `POST /api/search/web` | $0.01 | $0.008 (1 crédit Tavily, [docs.tavily.com/documentation/api-credits](https://docs.tavily.com/documentation/api-credits)) | $0.002 | 20% | 7 (tous test wallet) | 0 | **En production**, vérifié |
| `POST /api/search/serp` | $0.005 | $0.001 (1 crédit Serper, source tierce — voir §2) | $0.004 | 80% | 5 (tous test wallet) | 0 | **En production**, vérifié |
| ~~`POST /api/web/scrape`~~ | ~~$0.02~~ | — | — | — | 2 (test wallet) | 0 | **Retiré le 2026-09-03** (voir §4-§5) |

## 0. Ce qui a changé le 2026-09-03 (mission de suivi n°1, avant retrait)

1. **`/api/web/scrape` respecte désormais `robots.txt`**, en réutilisant EXACTEMENT le mécanisme déjà en place sur `/api/web/read`/`/api/web/extract` (`lib/web.js`, fonction `assertRobotsAllowed`, désormais exportée et importée telle quelle — même User-Agent `x402-web-reader/1.0`, même formulation de refus, même 403). Vérifié en réel en local : un refus `robots.txt` ne consomme aucun crédit Tavily et **ne déclenche aucun settlement** — `logs/paiements.jsonl` et `logs/couts.jsonl` strictement inchangés après le refus (403 confirmé sur `https://twitter.com/naval`, le même cas déjà utilisé précédemment), seul `logs/echecs.jsonl` gagne une ligne.
2. **Coût amont corrigé** : le coût d'une extraction Tavily réussie passe de $0.008 à **$0.0016** (0,2 crédit, pas 1 crédit — voir §2), et n'est **plus jamais loggé sur un échec** (conforme à la politique documentée de Tavily). Vérifié en réel : un appel réussi logge désormais exactement `0.0016` ; un appel en échec (domaine inexistant) ne produit plus aucune ligne dans `couts.jsonl`.
3. **Test comparatif à 6 pages, toutes conformes `robots.txt`** — la vraie réponse à la question posée dans la mission précédente. Voir §4.

*(Ce travail — robots.txt + coût corrigé — a ensuite été rendu sans objet par le retrait de l'endpoint le jour même, §5. Conservé ici car il documente une vraie démarche de mise en conformité, pas du travail perdu : le mécanisme réutilisé, la logique de coût correcte, et la méthode de test restent valables et potentiellement réutiles pour un futur endpoint du même genre.)*

## Ancien tableau de synthèse (3 endpoints, avant retrait — historique)

| Endpoint | Prix vente | Coût amont (corrigé, tel que loggé) | Marge $ | Marge % | Appels payés (dont tests) | Payers inconnus | Verdict qualité |
|---|---|---|---|---|---|---|---|
| `POST /api/search/web` | $0.01 | $0.008 | $0.002 | 20% | 6 (tous test wallet) | 0 | Vérifié — résultats réels, distincts, pertinents |
| `POST /api/search/serp` | $0.005 | $0.001 | $0.004 | 80% | 4 (tous test wallet) | 0 | Vérifié — résultats structurés réels (position/titre/snippet) |
| `POST /api/web/scrape` | $0.02 | **$0.0016** (corrigé aujourd'hui, uniquement sur succès) | **$0.0184** | **92%** | 2 (tous test wallet) | 0 | Sur 6 pages conformes testées aujourd'hui : **notre propre `/api/web/read` égale ou dépasse Tavily sur 5/6** — voir verdict détaillé §4 |

« Appels payés » = paiements réels comptés côté production (`GET /stats`, `payments.last_7d` — ces 3 endpoints ont moins de 7 jours d'existence, donc `last_7d` couvre toute leur vie ; ne reflète pas encore le code corrigé aujourd'hui, non déployé). « Coût amont » = la valeur que notre propre code enregistre dans `logs/couts.jsonl` (voir §1) — désormais alignée sur la doc officielle Tavily, voir §2.

## 1. `logs/couts.jsonl` — ce qui est réellement enregistré

⚠️ **Limite d'accès** : je n'ai lu que la copie **locale** de `logs/couts.jsonl` (23 lignes, accumulées pendant les sessions de dev/test sur ce Mac — la mienne et celle de la session concurrente qui partage ce même dossier). Je n'ai **aucun accès filesystem** à la copie de production (disque persistant Render, `DATA_DIR=/var/data`) — les chiffres de coût amont ci-dessous viennent donc de la logique du code + de la constante `TAVILY_CREDIT_COST_USD`/`SERPER_CREDIT_COST_USD`, pas d'une lecture directe de ce que la production a réellement dépensé.

| Endpoint | Appels loggés (local) | Coût unitaire loggé |
|---|---|---|
| `/api/search/web` | 4 | $0.008 |
| `/api/search/serp` | 4 | $0.001 |
| `/api/web/scrape` | 15 | $0.008 |

## 2. Tarification réelle Tavily/Serper — écarts trouvés avec le log

### Tavily — https://docs.tavily.com/documentation/api-credits (source primaire, lue directement)

- **Search (basic)** : 1 crédit/requête. Notre code (`search_depth:"basic"`) correspond exactement — **aucun écart**.
- **Extract (basic)** : *"Every 5 successful URL extractions cost 1 API credit"* — soit **0,2 crédit par extraction réussie**, pas 1 crédit entier. Notre `TAVILY_CREDIT_COST_USD = 0.008` appliqué tel quel à `/api/web/scrape` **surestime le coût réel d'un facteur 5** sur les appels réussis : coût réel = 0,2 × $0.008 = **$0.0016**, pas $0.008.
- **Extraction ratée = gratuite** : *"You never get charged if a URL extraction fails."* — cette contradiction (le code logait un coût même sur échec) est **corrigée aujourd'hui** : `logCoutAmont` n'est plus appelé qu'après un succès confirmé, avec la nouvelle constante `TAVILY_EXTRACT_COST_USD` (0,2 crédit × $0.008 = $0.0016), citant cette ligne de doc en commentaire dans `lib/tavily.js` et `endpoints/web-scrape.js`. Vérifié en réel : un échec ne produit plus de ligne dans `couts.jsonl`.
- **Palier gratuit du compte (`GET https://api.tavily.com/usage`, interrogé en direct avec notre clé)** : plan **"Researcher"**, `plan_limit: 1000` crédits/mois, `plan_usage: 11` (8 search + 3 extract) — **989 crédits restants sur ce cycle**, `paygo_usage: 0` (aucun dépassement facturé).
- **⚠️ Écart supplémentaire, non résolu** : le compte ne montre que 11 appels consommés au total, alors que le seul fichier `couts.jsonl` **local** en compte déjà 19 (15 extract + 4 search) — strictement plus que ce que le compte rapporte. Cause non identifiée avec certitude ; candidats plausibles : une partie de nos échecs de test n'a réellement rien coûté (cohérent avec le point ci-dessus), et/ou le compteur du compte reflète une fenêtre différente de l'historique complet du fichier local. À ne pas prendre pour argent comptant sans vérification au dashboard.

### Serper — page officielle indisponible

- `https://serper.dev/pricing` renvoie une **404** au moment de la recherche — aucune page de tarification officielle actuellement accessible. Les chiffres ci-dessous viennent de **sources tierces** (coldiq.com/blog/serper-pricing, apiserpent.com/blog/serper-pricing-credits-explained), **non confirmées à la source primaire**.
- **Search** : jusqu'à 10 résultats = 1 crédit (au-delà, 2 crédits). Notre code demande exactement `num:10` → **1 crédit/appel, cohérent avec notre `SERPER_CREDIT_COST_USD=0.001`**.
- **Palier payant le moins cher** : forfait "Starter", $50 pour 50 000 crédits = $0.001/crédit — **correspond exactement à notre constante**.
- **Palier gratuit** : 2 500 crédits offerts (confirmé directement sur la page d'accueil serper.dev, contrairement à la page de prix). Durée de validité des crédits payants (6 mois) confirmée par des tiers seulement.
- **Solde réel du compte (`GET https://google.serper.dev/account`, interrogé en direct)** : `balance: 2492` → **8 crédits consommés au total** sur les 2 500 offerts.
- **⚠️ Écart** : le fichier `couts.jsonl` local ne compte que 4 appels `/api/search/serp`, soit la moitié des 8 crédits réellement consommés sur le compte. Même limite de résolution que pour Tavily ci-dessus (probablement de l'usage hors de ce fichier local précis — production ou une autre session de test).

## 3. `endpoints/web-scrape.js` — commentaire d'en-tête et description publique

**Commentaire d'en-tête actuel (verbatim, lignes 8-26)** :

> Positioning verified against real pages before writing the description below (never promise untested capability):
> - JS-heavy page (quotes.toscrape.com/js/, content rendered client-side only) -> PASS, real content extracted.
> - Standard news article (a live BBC News article) -> PASS, real article text extracted, but noisier than /api/web/read's Readability-based output (sidebar/image boilerplate mixed in — this endpoint does a fuller page dump, not a focused article extraction).
> - Cloudflare-protected sites: first tried nowsecure.nl (FAIL, "Failed to fetch url") — but a follow-up check found that target no longer reliably presents an active Cloudflare challenge at all (plain curl: 200, no challenge header), so that result was discarded as a bad test target, not real evidence. Re-tested against 4 sites with a CONFIRMED active Cloudflare challenge (verified via curl immediately before each Tavily call): discogs.com, glassdoor.com, upwork.com — all 3 PASS, substantial real page content extracted (30k-46k chars each). Conclusion: Tavily Extract DOES handle actively bot-protected sites, at least these cases — not every site is guaranteed, but this is a positive, verified capability, not a caveat to hide.

*(Note factuelle, non corrigée — hors périmètre de cette mission : le texte dit "4 sites" puis n'en liste que 3 en disant "all 3 PASS" — probablement une coquille d'édition, le 4ᵉ étant nowsecure.nl, déjà explicitement écarté juste avant.)*

**Description actuellement servie dans `.well-known/x402.json` (production, vérifiée en direct) :**

> Page-to-Markdown extraction for hard sites — JS-rendered pages and, in most tested cases, active Cloudflare challenges (verified: 3 of 4 real sites bypassed cleanly). A second engine alongside /api/web/read, better for a clean single article. JSON body: {url: string (http/https, publicly reachable)}.

### Verdict : les preuves suffisent-elles à affirmer que Tavily Extract fait mieux que `/api/web/extract` sur des pages difficiles ?

**Non — l'échantillon est trop mince, et c'était vrai même avant aujourd'hui : jusqu'à cette mission, `/api/web/extract` (ou son moteur de récupération, `lib/web.js`) n'avait JAMAIS été testé sur les mêmes pages difficiles que Tavily.** Tout le travail de test antérieur (BBC, Twitter, Discogs, Glassdoor, Upwork) évaluait Tavily **seul**, jamais en comparaison directe.

J'ai fait deux tests comparatifs réels aujourd'hui (testnet, `/api/web/read` — le même moteur de fetch que `/api/web/extract`, `lib/web.js`) sur les pages déjà utilisées pour valider Tavily :

- **Discogs (Cloudflare)** : `/api/web/read` a **réussi** à passer (pas bloqué), mais a extrait un contenu nettement moins pertinent (une liste d'images/références, 310 mots) que Tavily (31k caractères, vraies actualités de la page d'accueil). Un vrai point positif pour Tavily sur ce cas précis — mais un seul cas.
- **Twitter/naval (JS-heavy)** : `/api/web/read` a **refusé** (403), pas pour une raison technique mais parce qu'il **respecte le `robots.txt`** de Twitter, qui interdit ce chemin. Tavily, lui, a renvoyé du contenu — ce qui suggère que Tavily ne respecte pas (ou pas de la même façon) le `robots.txt` du site cible. C'est une différence de **politique de conformité**, pas une différence de capacité technique — et c'est un point qui joue plutôt en faveur de notre propre outil sur le plan éthique/légal, pas contre lui.

**Conclusion** : 2 tests comparatifs réels, résultats mixtes (1 avantage qualité réel pour Tavily, 1 différence de politique de conformité qui n'est pas vraiment un avantage qualité). C'est très insuffisant pour affirmer une supériorité générale. La description actuellement en ligne ne fait d'ailleurs **pas** cette affirmation explicitement (elle dit "a second engine... better for a clean single article", en faveur de `/api/web/read` sur ce point précis) — donc rien à corriger dans l'immédiat, mais toute évolution future de ce texte ne devrait pas aller plus loin que : *"handles JavaScript-rendered pages and most tested Cloudflare-protected sites — not benchmarked head-to-head against /api/web/read/extract, and unlike them, does not appear to honor robots.txt."* Cette dernière clause (`robots.txt`) est une découverte de ce rapport, jamais mentionnée dans la description actuelle — à considérer pour une future mise à jour, hors périmètre de cette mission (lecture seule).

## 4. Test comparatif à 6 pages (mission de suivi, 2026-09-03)

La mission précédente concluait que 2 tests comparatifs (Discogs, Twitter) étaient un échantillon trop mince. Voici l'échantillon complet demandé : **6 pages réelles, chacune vérifiée conforme à `robots.txt`** (via le même parseur/UA que le code de production — `robots-parser` + token `x402-web-reader` — appelé directement avant tout test payant, pour ne jamais dépenser sur une page qui aurait de toute façon été refusée), couvrant 3 pages rendues en JavaScript + documentation lourde + page produit + article avec bandeau de consentement. Chaque paire testée en réel sur testnet, vrai paiement à chaque appel.

| # | Page | Catégorie | `web/scrape` (Tavily) | `web/read` (maison) | Verdict |
|---|---|---|---|---|---|
| 1 | coingecko.com/en/coins/bitcoin | JS-heavy | 200, 87 614 car., contenu réel (prix, market cap, dominance) | **403 — bloqué** (notre UA honnête se fait refuser) | **Avantage net Tavily** |
| 2 | figma.com | JS-heavy | 200, 2 428 car., contenu réel mais partiel (s'arrête après la 1ʳᵉ section) | 200, **17 635 car.**, même contenu réel + sections supplémentaires (design/build, cas d'usage, templates) | **Avantage net notre outil** |
| 3 | notion.so | JS-heavy | 200, 680 car., accroche réelle mais tronquée | 200, 1 046 car., même accroche + une section de plus | **Léger avantage notre outil** |
| 4 | kubernetes.io/docs/concepts/overview/ | Documentation lourde | 200, 90 877 car. — dump complet mélangeant navigation (menus, liens répétés) et contenu | 200, 10 330 car. — va directement à l'article, propre, sans bruit de navigation | **Avantage notre outil** (signal utile bien plus dense) |
| 5 | apple.com/shop/buy-mac/macbook-pro | Page produit | 200, 16 036 car. — même contenu FAQ que ci-contre, mais précédé de pixels de tracking (bruit) | 200, 7 763 car. — même section FAQ, sans le bruit | **Égalité de contenu, avantage propreté à notre outil** |
| 6 | zdnet.fr, article Claude/Cowork | Article + bandeau de consentement | 200, 23 467 car. — article complet + fil d'Ariane + probablement liens connexes | 200, 10 257 car. — va directement au résumé « points clés », propre | **Avantage notre outil** (signal utile plus dense) |

**Score sur ces 6 pages** : Tavily gagne nettement sur **1/6** (le seul cas où notre outil s'est fait bloquer techniquement) ; notre propre `/api/web/read` égale ou dépasse Tavily sur **5/6** — souvent parce que Tavily renvoie un dump de page complet (navigation + contenu mélangés) là où Readability va chercher spécifiquement l'article/le contenu principal, ce qui est généralement plus utile à un agent qu'un texte 5 à 9× plus long mais dilué.

### Verdict (réponse directe à la question posée)

**Marginal, et plutôt défavorable à Tavily sur la qualité brute d'extraction.** Sur 6 pages conformes, notre propre outil maison égale ou surpasse Tavily dans 5 cas sur 6 — souvent nettement (Figma : 17 635 car. de contenu réel contre 2 428 ; les 3 cas "documentation/produit/article" où Readability produit un texte plus court mais bien plus ciblé). Le seul avantage net et reproductible de Tavily observé aujourd'hui est étroit et précis : **contourner un blocage anti-bot pur** (CoinGecko a renvoyé un 403 direct à notre lecteur honnête, pas à Tavily) — cohérent avec les résultats Cloudflare de la mission précédente (3/4 sites bypassés), mais ce n'est pas ce que la description actuelle laisse entendre ("hard sites" en général, "JS-rendered pages" en général).

**Recommandation honnête** : la description actuelle ("Page-to-Markdown extraction for hard sites — JS-rendered pages and ... active Cloudflare challenges") **survit à moitié** à ce test — la partie "Cloudflare/anti-bot" reste défendable (confirmée une fois de plus aujourd'hui), mais la partie "JS-rendered pages" ne l'est plus : sur 3 pages JS-heavy testées aujourd'hui (coingecko, figma, notion), notre propre outil a produit un résultat identique ou meilleur dans 2 cas sur 3, et n'a perdu que sur le cas où c'était en fait un blocage anti-bot, pas une limite de rendu JS. Deux options honnêtes, à toi de trancher : (a) réduire la description à ce qui est réellement vérifié et gagnant — "bypasses bot-detection blocks other tools can't get past" — en retirant l'argument JS-rendering générique ; (b) retirer l'endpoint, comme tu l'envisageais, si ce seul axe (bot-bypass) ne justifie pas $0.02/appel face à `/api/web/read` à moindre coût pour la majorité des cas réels. Je ne modifie aucune description ni ne déploie rien — décision laissée à ta validation, comme demandé.

## 5. Retrait effectif, déploiement et clôture du chantier (2026-09-03, mission de suivi n°2)

Suite au verdict "marginal, plutôt défavorable à Tavily" du §4, **`POST /api/web/scrape` a été retiré** — pas juste sa description réécrite, l'endpoint entier :

- `endpoints/web-scrape.js` supprimé. Sa route, son entrée `.well-known/x402.json` et son entrée `openapi.json` disparaissent automatiquement (les deux documents de découverte se construisent depuis la liste des fichiers `endpoints/*.js` — rien d'autre à éditer pour la route elle-même).
- `tavilyExtract()`/`TAVILY_EXTRACT_COST_USD` retirés de `lib/tavily.js` (code mort — `tavilySearch()`/`TAVILY_CREDIT_COST_USD` restent, toujours utilisés par `/api/search/web`). `assertRobotsAllowed` (`lib/web.js`) redevenue interne (elle n'était exportée que pour ce seul endpoint).
- Vérifié qu'aucun script (`seed`, `bazaar`, `buyer-test`) ne référençait plus l'endpoint en dur — une seule vraie référence trouvée, l'entrée `EXAMPLES` de `scripts/lib/seed-core.js`, retirée.
- `mcp/tools-snapshot.json` vérifié : il datait d'avant cet endpoint (31 ressources, aucune entrée `web/scrape`) — rien à en retirer. Il reste néanmoins déjà obsolète pour une autre raison (il manque aussi `search/web` et `search/serp`) — republication mcp non traitée ici, hors périmètre de cette mission (déploiement Render uniquement).
- README, section "Premium reseller" : ligne d'entête retirée du tableau, tout le récit de conformité/tests spécifique à `/api/web/scrape` condensé en 2-3 lignes factuelles datées (résultat 5/6, seul avantage restant = contournement anti-bot) — le passage encore utile pour tout futur endpoint (le piège CDP sur les descriptions trop longues) a été généralisé et conservé, pas supprimé avec le reste.

**Testé en local avant tout déploiement** : démarrage serveur propre (aucune erreur), `.well-known/x402.json` et `openapi.json` sans trace de `web/scrape`, l'ancienne route en 404, et `/api/search/web`/`/api/search/serp` toujours réglés avec de vrais paiements testnet (quelques `402` isolés pendant les tests, tracés à une instabilité transitoire du facilitateur testnet — reproduite sur un endpoint jamais touché, `/api/web/read` — pas un vrai problème de ce changement).

**Déployé** (commit `9252ad3`) et **vérifié en production** :

| Vérification | Résultat |
|---|---|
| `POST /api/web/scrape` (ancienne route) | **404**, confirmé |
| `GET /.well-known/x402.json` | **33 ressources**, aucune trace de `web/scrape` |
| `POST /api/search/web`, appel réel mainnet | ✅ réussi, tx [`0x217db262...`](https://basescan.org/tx/0x217db262cb05b5ae54870eb74e3ef3398eebbc6a0330d7a78129407642f286cd) |
| `POST /api/search/serp`, appel réel mainnet | ✅ réussi, tx [`0x7ea4a39d...`](https://basescan.org/tx/0x7ea4a39d5d7cef54ba6683f452e37e9bdfe0f0722e8344751edbecf7d21bf62b) |

*(Note en cours de vérification : une brève fenêtre de 502 sur `/health`, quelques minutes après le passage du déploiement à "live" côté API Render — les logs de production montrent le serveur démarré proprement et servant déjà de vraies requêtes avec succès pendant cette même fenêtre, donc un artefact de propagation en périphérie (déjà documenté ailleurs dans ce projet pour ce plan Render sans zero-downtime deploy), pas un vrai souci applicatif — résolu de lui-même, `search/serp` re-testé avec succès juste après.)*

## Limites

- **Tous les paiements sur les 2 endpoints premium restants proviennent du wallet de test** (`0x216373E6...`) — confirmé via `/stats/daily` (7 jours) : le seul payeur inconnu de toute la plateforme (`0x09C32b8F...`) a payé sur `/api/defi/yields`, un endpoint totalement différent. **Aucun tiers n'a encore acheté de search/web ni de search/serp.**
- Le « coût amont » reflète ce que **notre propre code** enregistre (aligné sur la doc officielle Tavily pour `/api/search/web` — 1 crédit/recherche, aucun écart trouvé), pas une lecture directe de la facturation réelle — voir point suivant.
- Aucun accès à la copie de production de `logs/couts.jsonl`/`paiements.jsonl`/`echecs.jsonl` (disque persistant Render) — uniquement la copie locale de ce Mac, qui ne reflète pas nécessairement l'usage réel de production.
- La page de tarification officielle de Serper (`serper.dev/pricing`) est **toujours indisponible (404)** au moment de cette clôture — les chiffres Serper hors « prix par crédit confirmé sur notre propre appel de compte » viennent de sources tierces, pas de serper.dev. À revérifier périodiquement.
- Le test comparatif à 6 pages du §4, qui a motivé le retrait, compare `web/scrape` à `/api/web/read` (pas directement à `/api/web/extract`) — les deux partagent exactement le même moteur de récupération (`lib/web.js`), donc la comparaison de capacité reste valide, mais `/api/web/extract` (qui ajoute une étape Claude de structuration par-dessus) n'a jamais été testé nommément.
