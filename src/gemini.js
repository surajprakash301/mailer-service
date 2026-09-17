import { config } from "./config.js";
import { logError } from "./errors.js";

/** Prefer lite / pinned models over *-latest (those hit 503 high-demand often). */
const MODEL_FALLBACKS = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
];

/**
 * True when GEMINI_API_KEY is set (Google Generative Language API).
 */
export function hasLiveGemini() {
  const key = config.geminiApiKey;
  return Boolean(key) && key.length > 20 && !key.includes("...");
}

function modelCandidates() {
  const primary = config.geminiModel || "gemini-3.1-flash-lite";
  return [...new Set([primary, ...MODEL_FALLBACKS])];
}

function modelUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateOnce({ model, contents, temperature }) {
  const res = await fetch(modelUrl(model), {
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
    const err = new Error(`Gemini ${res.status}: ${msg}`);
    err.status = res.status;
    err.retryable = res.status === 503 || res.status === 429;
    throw err;
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
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Gemini returned non-JSON content");
  }
}

/**
 * Call Gemini generateContent and return parsed JSON (or throw).
 * Retries on 503/429 and walks a lite → flash model ladder.
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

  let lastErr;
  for (const model of modelCandidates()) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await generateOnce({ model, contents, temperature });
      } catch (err) {
        lastErr = err;
        logError(`geminiJson ${model} try=${attempt + 1}`, err);
        if (err?.retryable && attempt === 0) {
          await sleep(800);
          continue;
        }
        // Non-retryable or second try → next model
        break;
      }
    }
  }
  throw lastErr || new Error("Gemini request failed");
}
