// lib/anthropic.js — client Claude partage par les 4 endpoints IA (POST
// /api/ai/*). Modele : Haiku 4.5, le moins cher actuellement disponible
// (1 $/5 $ par million de tokens entree/sortie) — verifie via le skill
// claude-api (docs.claude.com), pas devine.
import Anthropic from "@anthropic-ai/sdk";
import config from "../config.js";

export const HAIKU_MODEL = "claude-haiku-4-5";
export const MAX_INPUT_CHARS = 8000;

let client = null;
function getClient() {
  if (!client) {
    if (!config.anthropicApiKey) {
      throw Object.assign(new Error("ANTHROPIC_API_KEY manquante cote serveur."), {
        code: "missing_api_key",
      });
    }
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

// Appelle Haiku avec un system prompt + un message utilisateur, renvoie le
// texte de la reponse (premier bloc "text").
export async function callHaiku({ system, user, maxTokens = 500 }) {
  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock ? textBlock.text : "";
}

// extractJson(text) -> objet parse, ou null si injecte. Tolere les blocs
// ```json ... ``` que le modele ajoute parfois malgre la consigne contraire.
export function extractJson(text) {
  if (!text) return null;
  let candidate = text.trim();
  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) candidate = fenced[1].trim();
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

// mapAnthropicError(err) -> {status, message} | null (null = erreur non
// reconnue, a laisser remonter au safeHandler generique).
export function mapAnthropicError(err) {
  if (err?.code === "missing_api_key") {
    return { status: 500, message: "Invalid server configuration (missing AI key)." };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 500, message: "Invalid server configuration (AI key rejected)." };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: "AI service is rate-limited, try again in a moment." };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { status: 400, message: `Invalid AI request: ${err.message}` };
  }
  if (err instanceof Anthropic.APIError) {
    return { status: 502, message: "AI service unavailable, try again later." };
  }
  return null;
}
