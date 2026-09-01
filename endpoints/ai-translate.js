// POST /api/ai/translate {text, target_lang} — endpoint payant (0,01 $).
// Traduction via Claude Haiku 4.5.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { callHaiku, mapAnthropicError, MAX_INPUT_CHARS } from "../lib/anthropic.js";

export const path = "/api/ai/translate";
export const method = "POST";
export const price = "$0.01";
export const description =
  "Traduit un texte vers la langue cible demandee, via Claude Haiku 4.5. " +
  `Corps JSON: {text: string (max ${MAX_INPUT_CHARS} caracteres), target_lang: string (ex: French, es, japonais)}.`;

export const discovery = declareDiscoveryExtension({
  method: "POST",
  bodyType: "json",
  input: { text: "Where is the nearest train station?", target_lang: "French" },
  inputSchema: {
    properties: {
      text: { type: "string", description: `Texte a traduire (max ${MAX_INPUT_CHARS} caracteres).` },
      target_lang: { type: "string", description: "Langue cible (nom ou code, ex: French, es, japonais)." },
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
    res.status(400).json({ error: "Champ 'text' requis (chaine non vide)." });
    return;
  }
  if (text.length > MAX_INPUT_CHARS) {
    res.status(400).json({ error: `Champ 'text' trop long (max ${MAX_INPUT_CHARS} caracteres, recu ${text.length}).` });
    return;
  }
  if (!targetLang || targetLang.length > 50) {
    res.status(400).json({ error: "Champ 'target_lang' requis (ex: French, es, japonais)." });
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
