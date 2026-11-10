// lib/company/log.js — remplace le `log` d'Apify (SDK absent de ce serveur)
// pour les 3 fichiers repris tels quels de l'Actor eu-vat-siren-check
// (produits/apify-actors, labo-ia). debug = silencieux en prod.
export const log = {
  debug: () => {},
  info: (m) => console.log(`[entreprise] ${m}`),
  warning: (m) => console.warn(`[entreprise] ${m}`),
};
