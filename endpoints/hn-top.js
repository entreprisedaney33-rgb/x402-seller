// GET /api/hn/top?limit=20 — endpoint payant (0,005 $).
// Top Hacker News, via l'API Firebase officielle (MIT, reutilisation
// commerciale explicitement admise).
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { fetchJson } from "../lib/http.js";
import { cached } from "../lib/cache.js";

export const path = "/api/hn/top";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Classement courant des N meilleures histoires Hacker News (titre, url, score, auteur, nb de commentaires). " +
  "Parametre optionnel: ?limit=<n> (1-50, defaut 20).";

export const discovery = declareDiscoveryExtension({
  input: { limit: 20 },
  inputSchema: {
    properties: {
      limit: { type: "integer", description: "Nombre d'histoires a renvoyer (1-50, defaut 20)." },
    },
    required: [],
  },
  output: {
    example: {
      stories: [
        { id: 123456, title: "Show HN: ...", url: "https://example.com", score: 250, by: "someuser", comments: 80 },
      ],
      count: 20,
      source: "https://hacker-news.firebaseio.com",
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

export async function handler(req, res) {
  let limit = Number.parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit)) limit = 20;
  if (limit < 1 || limit > 50) {
    res.status(400).json({ error: "Parametre 'limit' invalide (entier entre 1 et 50 attendu)." });
    return;
  }

  const ids = await cached("hn-top:ids", 60_000, () =>
    fetchJson("https://hacker-news.firebaseio.com/v0/topstories.json")
  );

  const topIds = ids.slice(0, limit);
  const items = await Promise.all(
    topIds.map((id) =>
      cached(`hn-item:${id}`, 60_000, () =>
        fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
      )
    )
  );

  const stories = items
    .filter(Boolean)
    .map((it) => ({
      id: it.id,
      title: it.title,
      url: it.url || `https://news.ycombinator.com/item?id=${it.id}`,
      score: it.score,
      by: it.by,
      comments: it.descendants ?? 0,
    }));

  res.json({
    stories,
    count: stories.length,
    source: "https://hacker-news.firebaseio.com",
    fetched_at: new Date().toISOString(),
  });
}
