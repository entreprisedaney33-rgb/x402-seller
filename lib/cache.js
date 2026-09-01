// lib/cache.js — cache memoire (TTL) pour les donnees de marche/reseau.
//
// Un simple Map en memoire de process. Suffisant pour un service Render
// mono-instance (pas de cache distribue necessaire) : reduit le nombre
// d'appels aux APIs externes (DefiLlama, RPC, Frankfurter...) et protege
// contre leurs limites de debit.
const store = new Map();

function getFresh(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

// cached(cle, dureeMs, fn) : renvoie la valeur en cache si fraiche, sinon
// appelle fn() (async), met le resultat en cache, et le renvoie.
export async function cached(key, ttlMs, fn) {
  const hit = getFresh(key);
  if (hit !== undefined) return hit;
  const value = await fn();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}
