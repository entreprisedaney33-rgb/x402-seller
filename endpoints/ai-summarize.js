// POST /api/ai/summarize {text, max_sentences} — endpoint payant (0,01 $).
// Resume via Claude Haiku 4.5 (le moins cher disponible).
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { callHaiku, mapAnthropicError, MAX_INPUT_CHARS } from "../lib/anthropic.js";

export const path = "/api/ai/summarize";
export const method = "POST";
export const price = "$0.01";
export const description =
  "Summarize text (article, transcript, report) into a given number of sentences, via Claude Haiku 4.5. Preserves the " +
  "source text's language. " +
  `JSON body: {text: string (max ${MAX_INPUT_CHARS} chars), max_sentences?: integer 1-10 (default 3)}.`;

export const discovery = declareDiscoveryExtension({
  method: "POST",
  bodyType: "json",
  input: { text: "Long article text...", max_sentences: 3 },
  inputSchema: {
    properties: {
      text: { type: "string", description: `Text to summarize (max ${MAX_INPUT_CHARS} chars).` },
      max_sentences: { type: "integer", description: "Maximum number of sentences in the summary (1-10, default 3)." },
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
    res.status(400).json({ error: "Field 'text' is required (non-empty string)." });
    return;
  }
  if (text.length > MAX_INPUT_CHARS) {
    res.status(400).json({ error: `Field 'text' too long (max ${MAX_INPUT_CHARS} chars, got ${text.length}).` });
    return;
  }

  let maxSentences = Number.parseInt(req.body?.max_sentences, 10);
  if (!Number.isFinite(maxSentences)) maxSentences = 3;
  if (maxSentences < 1 || maxSentences > 10) {
    res.status(400).json({ error: "Invalid 'max_sentences' (integer between 1 and 10 expected)." });
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
