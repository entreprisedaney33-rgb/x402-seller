// GET /api/github/repo?full_name=owner/repo — endpoint payant (0,005 $).
// Stars, forks, issues ouvertes, dernier push, via l'API GitHub REST.
// GITHUB_TOKEN (env, optionnel) releve le plafond de 60 -> 5000 requetes/h ;
// aucun scope requis, uniquement des donnees de depots publics.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { fetchJson } from "../lib/http.js";
import { cached } from "../lib/cache.js";
import config from "../config.js";

export const path = "/api/github/repo";
export const method = "GET";
export const price = "$0.005";
export const description =
  "Stats for a public GitHub repository: stars, forks, open issues, last push date, main language, license. " +
  "Parameter: ?full_name=<owner>/<repo> (e.g. expressjs/express).";

export const discovery = declareDiscoveryExtension({
  input: { full_name: "expressjs/express" },
  inputSchema: {
    properties: {
      full_name: { type: "string", description: "Repository identifier in owner/repo format." },
    },
    required: ["full_name"],
  },
  output: {
    example: {
      full_name: "expressjs/express",
      stars: 66000,
      forks: 9000,
      open_issues: 120,
      language: "JavaScript",
      license: "MIT",
      pushed_at: "2026-08-20T10:00:00Z",
      url: "https://github.com/expressjs/express",
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

export async function handler(req, res) {
  const fullName = String(req.query.full_name || "").trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) {
    res.status(400).json({ error: "Invalid 'full_name' parameter (expected: owner/repo, e.g. expressjs/express)." });
    return;
  }

  const headers = { Accept: "application/vnd.github+json" };
  if (config.githubToken) headers.Authorization = `Bearer ${config.githubToken}`;

  const data = await cached(`github-repo:${fullName}`, 60_000, () =>
    fetchJson(`https://api.github.com/repos/${fullName}`, { headers })
  );

  res.json({
    full_name: data.full_name,
    stars: data.stargazers_count,
    forks: data.forks_count,
    open_issues: data.open_issues_count,
    language: data.language,
    license: data.license?.spdx_id || null,
    pushed_at: data.pushed_at,
    url: data.html_url,
    fetched_at: new Date().toISOString(),
  });
}
