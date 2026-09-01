// GET /api/wiki/summary?title=x&lang=en — endpoint payant (0,005 $).
// Resume d'un article Wikipedia via l'API REST officielle (Wikimedia).
// Contenu sous licence CC BY-SA — l'attribution est incluse dans CHAQUE
// reponse (obligation de la licence, jamais omise).
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { fetchJson, UpstreamError } from "../lib/http.js";
import { cached } from "../lib/cache.js";

export const path = "/api/wiki/summary";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Resume d'un article Wikipedia (extrait, description, image, lien) — contenu CC BY-SA, attribution incluse dans la reponse. " +
  "Parametres: ?title=<titre exact de l'article> (ex: Bitcoin), ?lang=<code langue> (defaut en).";

export const discovery = declareDiscoveryExtension({
  input: { title: "Bitcoin", lang: "en" },
  inputSchema: {
    properties: {
      title: { type: "string", description: "Titre exact de l'article Wikipedia (sensible a la casse pour certains mots)." },
      lang: { type: "string", description: "Code langue Wikipedia (ex: en, fr, de). Defaut: en." },
    },
    required: ["title"],
  },
  output: {
    example: {
      title: "Bitcoin",
      extract: "Bitcoin is the first decentralized cryptocurrency...",
      description: "Decentralized digital currency",
      thumbnail_url: "https://upload.wikimedia.org/...",
      url: "https://en.wikipedia.org/wiki/Bitcoin",
      attribution: {
        license: "CC BY-SA 4.0",
        license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
        source: "Wikipedia contributors",
      },
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

export async function handler(req, res) {
  const title = String(req.query.title || "").trim();
  const lang = String(req.query.lang || "en").toLowerCase();

  if (!title || title.length > 300) {
    res.status(400).json({ error: "Parametre 'title' requis (titre d'article Wikipedia, ex: Bitcoin)." });
    return;
  }
  if (!/^[a-z]{2,10}$/.test(lang)) {
    res.status(400).json({ error: "Parametre 'lang' invalide (code langue attendu, ex: en, fr)." });
    return;
  }

  let data;
  try {
    data = await cached(`wiki:${lang}:${title}`, 60_000, () =>
      fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
    );
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 404) {
      res.status(404).json({ error: `Aucun article Wikipedia trouve pour "${title}" (${lang}).` });
      return;
    }
    throw err;
  }

  res.json({
    title: data.title,
    extract: data.extract,
    description: data.description || null,
    thumbnail_url: data.thumbnail?.source || null,
    url: data.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    attribution: {
      license: "CC BY-SA 4.0",
      license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
      source: "Wikipedia contributors",
    },
    fetched_at: new Date().toISOString(),
  });
}
