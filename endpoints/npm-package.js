// GET /api/npm/package?name=x — endpoint payant (0,005 $).
// Version courante + telechargements hebdomadaires d'un package npm.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { fetchJson, UpstreamError } from "../lib/http.js";
import { cached } from "../lib/cache.js";

export const path = "/api/npm/package";
export const method = "GET";
export const price = "$0.005";
export const description =
  "npm package downloads, current version, and license — latest version, license, and last week's download count " +
  "for an npm package. Parameter: ?name=<package> (e.g. express, or @scope/name for a scoped package).";

export const discovery = declareDiscoveryExtension({
  input: { name: "express" },
  inputSchema: {
    properties: {
      name: { type: "string", description: "npm package name (e.g. express, @scope/name)." },
    },
    required: ["name"],
  },
  output: {
    example: {
      name: "express",
      version: "5.2.1",
      description: "Fast, unopinionated, minimalist web framework",
      license: "MIT",
      weekly_downloads: 35000000,
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

const NAME_RE = /^(@[a-z0-9-][a-z0-9._-]*\/)?[a-z0-9-][a-z0-9._-]*$/;

export async function handler(req, res) {
  const name = String(req.query.name || "").trim();
  if (!name || name.length > 214 || !NAME_RE.test(name)) {
    res.status(400).json({ error: "Invalid 'name' parameter (npm package name expected, e.g. express)." });
    return;
  }

  const [meta, downloads] = await Promise.all([
    cached(`npm-meta:${name}`, 60_000, () => fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`)),
    cached(`npm-downloads:${name}`, 60_000, async () => {
      try {
        return await fetchJson(`https://api.npmjs.org/downloads/point/last-week/${name}`);
      } catch (err) {
        // Un package tout neuf ou trop confidentiel peut ne pas avoir de
        // stats de telechargement — ce n'est pas une erreur bloquante.
        if (err instanceof UpstreamError && err.status === 404) return null;
        throw err;
      }
    }),
  ]);

  const latest = meta["dist-tags"]?.latest;
  const latestInfo = latest ? meta.versions?.[latest] : null;

  res.json({
    name: meta.name,
    version: latest || null,
    description: meta.description || null,
    license: latestInfo?.license || meta.license || null,
    weekly_downloads: downloads?.downloads ?? null,
    fetched_at: new Date().toISOString(),
  });
}
