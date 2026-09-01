// POST /api/ai/classify {text, labels} — endpoint payant (0,01 $).
// Classification a une seule etiquette via Claude Haiku 4.5.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { callHaiku, mapAnthropicError, extractJson, MAX_INPUT_CHARS } from "../lib/anthropic.js";

export const path = "/api/ai/classify";
export const method = "POST";
export const price = "$0.01";
export const description =
  "Text classification (sentiment analysis, topic tagging, intent detection, moderation labels...) into one of your " +
  "own labels, with a confidence score, via Claude Haiku 4.5. " +
  `JSON body: {text: string (max ${MAX_INPUT_CHARS} chars), labels: string[] (2 to 20 labels)}.`;

export const discovery = declareDiscoveryExtension({
  method: "POST",
  bodyType: "json",
  input: { text: "The product arrived broken and support never replied.", labels: ["positive", "negative", "neutral"] },
  inputSchema: {
    properties: {
      text: { type: "string", description: `Text to classify (max ${MAX_INPUT_CHARS} chars).` },
      labels: { type: "array", items: { type: "string" }, description: "List of possible labels (2 to 20)." },
    },
    required: ["text", "labels"],
  },
  output: {
    example: { label: "negative", confidence: 0.94 },
  },
});

export async function handler(req, res) {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const labels = Array.isArray(req.body?.labels) ? req.body.labels : null;

  if (!text) {
    res.status(400).json({ error: "Field 'text' is required (non-empty string)." });
    return;
  }
  if (text.length > MAX_INPUT_CHARS) {
    res.status(400).json({ error: `Field 'text' too long (max ${MAX_INPUT_CHARS} chars, got ${text.length}).` });
    return;
  }
  if (!labels || labels.length < 2 || labels.length > 20 || !labels.every((l) => typeof l === "string" && l.trim())) {
    res.status(400).json({ error: "Field 'labels' is required (array of 2 to 20 non-empty strings)." });
    return;
  }

  try {
    const raw = await callHaiku({
      system:
        `Classify the user's text into EXACTLY ONE of these labels: ${JSON.stringify(labels)}. ` +
        'Respond with ONLY a single valid JSON object: {"label": "<one of the given labels, verbatim>", "confidence": <number between 0 and 1>}. ' +
        "No markdown fences, no explanation.",
      user: text,
      maxTokens: 200,
    });

    const parsed = extractJson(raw);
    if (!parsed || typeof parsed.label !== "string" || !labels.includes(parsed.label)) {
      res.status(502).json({ error: "The model returned an invalid label, try again." });
      return;
    }

    const confidence = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : null;
    res.json({ label: parsed.label, confidence });
  } catch (err) {
    const mapped = mapAnthropicError(err);
    if (mapped) {
      res.status(mapped.status).json({ error: mapped.message });
      return;
    }
    throw err;
  }
}
