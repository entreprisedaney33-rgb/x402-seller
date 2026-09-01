// POST /api/ai/extract {text, schema} — endpoint payant (0,02 $).
// Extraction structuree (JSON selon un schema fourni) via Claude Haiku 4.5.
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { callHaiku, mapAnthropicError, extractJson, MAX_INPUT_CHARS } from "../lib/anthropic.js";

export const path = "/api/ai/extract";
export const method = "POST";
export const price = "$0.02";
export const description =
  "Extrait des informations structurees d'un texte, selon un schema JSON fourni, via Claude Haiku 4.5. " +
  `Corps JSON: {text: string (max ${MAX_INPUT_CHARS} caracteres), schema: object (JSON Schema decrivant les champs a extraire)}.`;

export const discovery = declareDiscoveryExtension({
  method: "POST",
  bodyType: "json",
  input: {
    text: "Invoice #4521, billed to Jane Doe, total $340.00, due 2026-09-15.",
    schema: {
      type: "object",
      properties: {
        invoice_number: { type: "string" },
        customer: { type: "string" },
        total: { type: "number" },
        due_date: { type: "string" },
      },
    },
  },
  inputSchema: {
    properties: {
      text: { type: "string", description: `Texte source (max ${MAX_INPUT_CHARS} caracteres).` },
      schema: { type: "object", description: "JSON Schema decrivant les champs a extraire." },
    },
    required: ["text", "schema"],
  },
  output: {
    example: { data: { invoice_number: "4521", customer: "Jane Doe", total: 340, due_date: "2026-09-15" } },
  },
});

export async function handler(req, res) {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const schema = req.body?.schema;

  if (!text) {
    res.status(400).json({ error: "Champ 'text' requis (chaine non vide)." });
    return;
  }
  if (text.length > MAX_INPUT_CHARS) {
    res.status(400).json({ error: `Champ 'text' trop long (max ${MAX_INPUT_CHARS} caracteres, recu ${text.length}).` });
    return;
  }
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    res.status(400).json({ error: "Champ 'schema' requis (objet JSON Schema decrivant les champs a extraire)." });
    return;
  }

  try {
    const raw = await callHaiku({
      system:
        "You extract structured data from text according to a JSON Schema provided by the user. " +
        "Respond with ONLY a single valid JSON object matching that schema — no markdown fences, no explanation. " +
        "If a field cannot be found in the text, use null for that field.",
      user: `JSON Schema:\n${JSON.stringify(schema)}\n\nText:\n${text}`,
      maxTokens: 500,
    });

    const data = extractJson(raw);
    if (data === null) {
      res.status(502).json({ error: "Le modele a renvoye une reponse non-JSON, reessaie." });
      return;
    }

    res.json({ data });
  } catch (err) {
    const mapped = mapAnthropicError(err);
    if (mapped) {
      res.status(mapped.status).json({ error: mapped.message });
      return;
    }
    throw err;
  }
}
