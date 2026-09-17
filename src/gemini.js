import { config } from "./config.js";
import { logError } from "./errors.js";

/**
 * Ordered cheap → busier models. Primary (GEMINI_MODEL) is tried first.
 * Override with GEMINI_MODEL_FALLBACKS=model-a,model-b
 */
const DEFAULT_LADDER = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
];

/** After hard quota / billing limit, skip Gemini for this long (ms). */
const QUOTA_COOLDOWN_MS = 30 * 60 * 1000;

let circuitOpenUntil = 0;
let lastError = "";
let lastModelOk = "";
let callCount = 0;
let failCount = 0;

/**
 * True when GEMINI_API_KEY is set (Google Generative Language API).
 */
export function hasLiveGemini() {
  const key = config.geminiApiKey;
  return Boolean(key) && key.length > 20 && !key.includes("...");
}

/** Soft gate: key present AND circuit not tripped by quota. */
export function geminiAvailable() {
  return hasLiveGemini() && Date.now() >= circuitOpenUntil;
}

export function geminiStatus() {
  const open = Date.now() < circuitOpenUntil;
  return {
    configured: hasLiveGemini(),
    available: geminiAvailable(),
    circuitOpen: open,
    circuitOpenUntil: open ? new Date(circuitOpenUntil).toISOString() : null,
    primaryModel: config.geminiModel || "gemini-3.1-flash-lite",
    ladder: modelCandidates(),
    lastModelOk: lastModelOk || null,
    lastError: lastError || null,
    calls: callCount,
    fails: failCount,
  };
}

function modelCandidates() {
  const primary = config.geminiModel || "gemini-3.1-flash-lite";
  const fromEnv = String(process.env.GEMINI_MODEL_FALLBACKS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ladder = fromEnv.length ? fromEnv : DEFAULT_LADDER;
  return [...new Set([primary, ...ladder])];
}

function modelUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHardQuota(status, message) {
  if (status !== 429 && status !== 403) return false;
  return /quota|limit|exceed|billing|resource.?exhausted|insufficient|permission.?denied/i.test(
    String(message || ""),
  );
}

function tripCircuit(reason) {
  circuitOpenUntil = Date.now() + QUOTA_COOLDOWN_MS;
  lastError = reason;
  console.warn(
    `[warn] gemini circuit open ${QUOTA_COOLDOWN_MS / 60000}m — ${reason} (using niche/template fallbacks)`,
  );
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
    throw Object.assign(new Error(`Gemini returned non-JSON HTTP body (${res.status})`), {
      status: res.status,
    });
  }

  if (!res.ok) {
    const msg = data?.error?.message || rawText.slice(0, 300);
    const err = new Error(`Gemini ${res.status}: ${msg}`);
    err.status = res.status;
    err.messageRaw = msg;
    // 503 / soft 429 (high demand) → try next model. Hard quota → trip circuit.
    err.hardQuota = isHardQuota(res.status, msg);
    err.retryable = !err.hardQuota && (res.status === 503 || res.status === 429);
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
 * Walks a model ladder; on hard quota opens a cooldown circuit so gather
 * falls back to niches/templates instead of burning the rest of the free tier.
 * @param {{ system?: string, user: string, temperature?: number }} opts
 */
export async function geminiJson({ system = "", user, temperature = 0.4 } = {}) {
  if (!hasLiveGemini()) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  if (!geminiAvailable()) {
    throw new Error(
      `Gemini circuit open until ${new Date(circuitOpenUntil).toISOString()} (${lastError || "quota"})`,
    );
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

  callCount += 1;
  let lastErr;
  const models = modelCandidates();

  for (let i = 0; i < models.length; i += 1) {
    const model = models[i];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const parsed = await generateOnce({ model, contents, temperature });
        lastModelOk = model;
        lastError = "";
        return parsed;
      } catch (err) {
        lastErr = err;
        failCount += 1;
        lastError = err?.message || String(err);
        logError(`geminiJson ${model} try=${attempt + 1}`, err);

        if (err?.hardQuota) {
          tripCircuit(err.message);
          throw err;
        }

        // Soft 429 / 503: brief pause then same model once, else next model
        if (err?.retryable && attempt === 0) {
          await sleep(600 + i * 200);
          continue;
        }
        break;
      }
    }
  }

  throw lastErr || new Error("Gemini request failed on all models");
}
