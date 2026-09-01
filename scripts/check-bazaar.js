// scripts/check-bazaar.js — interroge la decouverte Bazaar du facilitateur
// CDP (catalogue de TOUTES les ressources x402 connues du facilitateur,
// pas seulement les notres) et n'affiche que les entrees qui correspondent
// a ce serveur : URL contenant le domaine Render deploye, ou payTo ==
// PAY_TO_ADDRESS (criteres fixes ci-dessous, pas deduits du .env local car
// BASE_URL y est vide — ce script tourne en local mais cherche le service
// deploye).
//
// Usage: npm run bazaar
import { HTTPFacilitatorClient } from "@x402/core/server";
import { withBazaar } from "@x402/extensions/bazaar";
import { createFacilitatorConfig } from "@coinbase/x402";
import config from "../config.js";

if (!config.isMainnet) {
  console.error(
    "La decouverte Bazaar du facilitateur CDP n'a de sens qu'en mainnet (NETWORK=base)."
  );
  process.exit(1);
}

const facilitatorClient = withBazaar(
  new HTTPFacilitatorClient(createFacilitatorConfig(config.cdpApiKeyId, config.cdpApiKeySecret))
);

// Criteres fixes (pas deduits du .env local: BASE_URL y est vide, ce script
// tourne en local mais cherche le service DEPLOYE sur Render).
const urlFragment = "x402-seller-0ay3.onrender.com";
const payToDisplay = "0x5c3DB195a38f39074d8c891741A82f6D8f2A16Cc";
const payTo = payToDisplay.toLowerCase();

console.log(`Facilitateur : CDP (https://api.cdp.coinbase.com/platform/v2/x402)`);
console.log(`Recherche des ressources dont l'URL contient "${urlFragment}"`);
console.log(`             ou dont payTo = ${payToDisplay}\n`);

const PAGE_SIZE = 100;
const MAX_PAGES = 250; // filet de securite ; couvre un catalogue jusqu'a 25 000 ressources
let all = [];
let total = null;

for (let page = 0; page < MAX_PAGES; page++) {
  const result = await facilitatorClient.extensions.bazaar.listResources({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  total = result.pagination?.total ?? result.items.length;
  all = all.concat(result.items);
  if (all.length >= total || result.items.length === 0) break;
}

console.log(`Catalogue Bazaar total : ${total ?? all.length} ressource(s) recuperee(s) (${all.length} chargees).\n`);

const matches = all.filter(
  (item) =>
    (item.resource && item.resource.includes(urlFragment)) ||
    (item.accepts || []).some((a) => (a.payTo || "").toLowerCase() === payTo)
);

if (matches.length === 0) {
  const exhaustive = all.length >= total;
  console.log(
    `Aucune ressource correspondante trouvee ` +
      (exhaustive
        ? `(catalogue parcouru en entier : ${all.length}/${total}).`
        : `(seulement ${all.length}/${total} ressources parcourues avant d'atteindre le plafond de securite — verification NON exhaustive).`) +
      "\nL'indexation par le facilitateur peut prendre du temps apres un paiement regle " +
      "(le catalogue se construit a partir des paiements deja traites, pas de mecanisme d'inscription immediate) " +
      "— rien d'anormal a ce stade, pas d'autre explication a en tirer."
  );
} else {
  console.log(`${matches.length} ressource(s) correspondante(s) :\n`);
  console.log(JSON.stringify(matches, null, 2));
}
