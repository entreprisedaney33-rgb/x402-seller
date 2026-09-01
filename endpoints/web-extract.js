// POST /api/web/extract {url, schema} — paid endpoint ($0.02).
// Reads a web page the same way POST /api/web/read does (see lib/web.js),
// then extracts structured data from it according to a caller-supplied
// JSON Schema, via Claude Haiku 4.5 — one call, no separate read+extract.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { fetchPageSafely, extractReadable } from "../lib/web.js";
import { callHaiku, mapAnthropicError, extractJson, MAX_INPUT_CHARS } from "../lib/anthropic.js";

export const path = "/api/web/extract";
export const method = "POST";
export const price = "$0.02";
export const description =
  "Read a public web page and extract structured data from it according to a JSON Schema you provide, via " +
  "Claude Haiku 4.5 — combines page fetching, readability extraction, and structured extraction in one call. " +
  `Body: {url: string (http/https), schema: object (JSON Schema describing the fields to extract, page content truncated to ${MAX_INPUT_CHARS} chars)}.`;

export const discovery = declareDiscoveryExtension({
  method: "POST",
  bodyType: "json",
  input: {
    url: "https://en.wikipedia.org/wiki/HTTP_402",
    schema: {
      type: "object",
      properties: { title: { type: "string" }, first_paragraph: { type: "string" } },
    },
  },
  inputSchema: {
    properties: {
      url: { type: "string", description: "Public http(s) URL of the page to read and extract from." },
      schema: { type: "object", description: "JSON Schema describing the fields to extract." },
    },
    required: ["url", "schema"],
  },
  output: {
    example: {
      url: "https://en.wikipedia.org/wiki/HTTP_402",
      title: "HTTP 402",
      data: { title: "HTTP 402", first_paragraph: "The HTTP 402 Payment Required..." },
      fetched_at: "2026-09-01T12:00:00.000Z",
    },
  },
});

export async function handler(req, res) {
  const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
  const schema = req.body?.schema;

  if (!url) {
    res.status(400).json({ error: "Field 'url' is required (a public http(s) URL)." });
    return;
  }
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    res.status(400).json({ error: "Field 'schema' is required (a JSON Schema object describing the fields to extract)." });
    return;
  }

  const { html, finalUrl } = await fetchPageSafely(url);
  const { title, markdown } = extractReadable(html, finalUrl);
  const truncated = markdown.slice(0, MAX_INPUT_CHARS);

  try {
    const raw = await callHaiku({
      system:
        "You extract structured data from a web page's Markdown content, according to a JSON Schema provided by the user. " +
        "Respond with ONLY a single valid JSON object matching that schema — no markdown fences, no explanation. " +
        "If a field cannot be found on the page, use null for that field.",
      user: `JSON Schema:\n${JSON.stringify(schema)}\n\nPage title: ${title || "(none)"}\n\nPage content (Markdown):\n${truncated}`,
      maxTokens: 800,
    });

    const data = extractJson(raw);
    if (data === null) {
      res.status(502).json({ error: "The model returned a non-JSON response, try again." });
      return;
    }

    res.json({ url: finalUrl, title, data, fetched_at: new Date().toISOString() });
  } catch (err) {
    const mapped = mapAnthropicError(err);
    if (mapped) {
      res.status(mapped.status).json({ error: mapped.message });
      return;
    }
    throw err;
  }
}
