// POST /api/web/read {url} — paid endpoint ($0.005).
// Fetches a web page (SSRF-guarded, 2 MB / 10 s capped, robots.txt aware —
// see lib/web.js) and returns its main content as clean Markdown, using
// the same readability extraction Firefox Reader View is built on.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { fetchPageSafely, extractReadable } from "../lib/web.js";

export const path = "/api/web/read";
export const method = "POST";
export const price = "$0.005";
export const description =
  "Read any public web page and return its main article content as clean Markdown (readability extraction, " +
  "boilerplate/nav/ads stripped) — no HTML parsing needed on your side. " +
  "Body: {url: string (http/https, publicly reachable)}.";

export const discovery = declareDiscoveryExtension({
  method: "POST",
  bodyType: "json",
  input: { url: "https://en.wikipedia.org/wiki/HTTP_402" },
  inputSchema: {
    properties: {
      url: { type: "string", description: "Public http(s) URL of the page to read." },
    },
    required: ["url"],
  },
  output: {
    example: {
      title: "HTTP 402",
      text_markdown: "# HTTP 402\n\nThe **402 Payment Required**...",
      word_count: 480,
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

export async function handler(req, res) {
  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  if (!url) {
    res.status(400).json({ error: "Field 'url' is required (a public http(s) URL)." });
    return;
  }

  const { html, finalUrl } = await fetchPageSafely(url);
  const { title, markdown, wordCount } = extractReadable(html, finalUrl);

  res.json({
    title,
    text_markdown: markdown,
    word_count: wordCount,
    fetched_at: new Date().toISOString(),
  });
}
