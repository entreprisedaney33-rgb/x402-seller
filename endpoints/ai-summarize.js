// POST /api/ai/summarize {text, max_sentences} — endpoint payant (0,01 $).
// Resume via Claude Haiku 4.5 (le moins cher disponible).
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { callHaiku, mapAnthropicError, MAX_INPUT_CHARS } from "../lib/anthropic.js";

export const path = "/api/ai/summarize";
export const method = "POST";
export const price = "$0.01";
export const description =
  "Resume un texte en un nombre de phrases donne, via Claude Haiku 4.5. Conserve la langue du texte source. " +
  `Corps JSON: {text: string (max ${MAX_INPUT_CHARS} caracteres), max_sentences?: entier 1-10 (defaut 3)}.`;

export const discovery = declareDiscoveryExtension({
  method: "POST",
  bodyType: "json",
  input: { text: "Long article text...", max_sentences: 3 },
  inputSchema: {
    properties: {
      text: { type: "string", description: `Texte a resumer (max ${MAX_INPUT_CHARS} caracteres).` },
      max_sentences: { type: "integer", description: "Nombre maximum de phrases du resume (1-10, defaut 3)." },
    },
    required: ["text"],
  },
  output: {
    example: { summary: "Concise summary here.", sentence_limit: 3 },
  },
});

export async function handler(req, res) {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    res.status(400).json({ error: "Champ 'text' requis (chaine non vide)." });
    return;
  }
  if (text.length > MAX_INPUT_CHARS) {
    res.status(400).json({ error: `Champ 'text' trop long (max ${MAX_INPUT_CHARS} caracteres, recu ${text.length}).` });
    return;
  }

  let maxSentences = Number.parseInt(req.body?.max_sentences, 10);
  if (!Number.isFinite(maxSentences)) maxSentences = 3;
  if (maxSentences < 1 || maxSentences > 10) {
    res.status(400).json({ error: "Champ 'max_sentences' invalide (entier entre 1 et 10 attendu)." });
    return;
  }

  try {
    const summary = await callHaiku({
      system:
        `You summarize text. Respond with a summary of at most ${maxSentences} sentence(s), ` +
        "in the SAME language as the source text. Output ONLY the summary — no preamble, no labels, no quotes.",
      user: text,
      maxTokens: 500,
    });

    res.json({ summary: summary.trim(), sentence_limit: maxSentences });
  } catch (err) {
    const mapped = mapAnthropicError(err);
    if (mapped) {
      res.status(mapped.status).json({ error: mapped.message });
      return;
    }
    throw err;
  }
}
