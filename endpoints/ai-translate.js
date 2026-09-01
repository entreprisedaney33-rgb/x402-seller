// POST /api/ai/translate {text, target_lang} — endpoint payant (0,01 $).
// Traduction via Claude Haiku 4.5.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { callHaiku, mapAnthropicError, MAX_INPUT_CHARS } from "../lib/anthropic.js";

export const path = "/api/ai/translate";
export const method = "POST";
export const price = "$0.01";
export const description =
  "Translate text into any target language, via Claude Haiku 4.5. " +
  `JSON body: {text: string (max ${MAX_INPUT_CHARS} chars), target_lang: string (e.g. French, es, Japanese)}.`;

export const discovery = declareDiscoveryExtension({
  method: "POST",
  bodyType: "json",
  input: { text: "Where is the nearest train station?", target_lang: "French" },
  inputSchema: {
    properties: {
      text: { type: "string", description: `Text to translate (max ${MAX_INPUT_CHARS} chars).` },
      target_lang: { type: "string", description: "Target language (name or code, e.g. French, es, Japanese)." },
    },
    required: ["text", "target_lang"],
  },
  output: {
    example: { translated_text: "Où est la gare la plus proche ?", target_lang: "French" },
  },
});

export async function handler(req, res) {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const targetLang = typeof req.body?.target_lang === "string" ? req.body.target_lang.trim() : "";

  if (!text) {
    res.status(400).json({ error: "Field 'text' is required (non-empty string)." });
    return;
  }
  if (text.length > MAX_INPUT_CHARS) {
    res.status(400).json({ error: `Field 'text' too long (max ${MAX_INPUT_CHARS} chars, got ${text.length}).` });
    return;
  }
  if (!targetLang || targetLang.length > 50) {
    res.status(400).json({ error: "Field 'target_lang' is required (e.g. French, es, Japanese)." });
    return;
  }

  try {
    const translated = await callHaiku({
      system:
        `Translate the user's text to ${targetLang}. Respond with ONLY the translated text — ` +
        "no preamble, no quotes, no explanation, no original text.",
      user: text,
      maxTokens: 500,
    });

    res.json({ translated_text: translated.trim(), target_lang: targetLang });
  } catch (err) {
    const mapped = mapAnthropicError(err);
    if (mapped) {
      res.status(mapped.status).json({ error: mapped.message });
      return;
    }
    throw err;
  }
}
