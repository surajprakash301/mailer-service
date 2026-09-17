import { config } from "./config.js";
import { logError } from "./errors.js";

/**
 * True when GEMINI_API_KEY is set (Google Generative Language API).
 */
export function hasLiveGemini() {
  const key = config.geminiApiKey;
  return Boolean(key) && key.length > 20 && !key.includes("...");
}

function modelUrl() {
  const model = encodeURIComponent(config.geminiModel || "gemini-flash-latest");
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

/**
 * Call Gemini generateContent and return parsed JSON (or throw).
 * @param {{ system?: string, user: string, temperature?: number }} opts
 */
export async function geminiJson({ system = "", user, temperature = 0.4 } = {}) {
  if (!hasLiveGemini()) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const contents = [];
  if (system) {
    contents.push({
      role: "user",
      parts: [{ text: `${system}\n\n---\n\n${user}` }],
    });
  } else {
    contents.push({ role: "user", parts: [{ text: user }] });
  }

  const res = await fetch(modelUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": config.geminiApiKey,
    },
    signal: AbortSignal.timeout(12_000),
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature,
        responseMimeType: "application/json",
      },
    }),
  });

  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(`Gemini returned non-JSON HTTP body (${res.status})`);
  }

  if (!res.ok) {
    const msg = data?.error?.message || rawText.slice(0, 300);
    throw new Error(`Gemini ${res.status}: ${msg}`);
  }

  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ||
    "";
  if (!text.trim()) {
    throw new Error("Gemini returned empty content");
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    logError("geminiJson parse", err);
    // Sometimes models wrap JSON in fences
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Gemini returned non-JSON content");
  }
}
