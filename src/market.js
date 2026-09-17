import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { config } from "./config.js";
import { logError } from "./errors.js";
import { geminiJson, hasLiveGemini, geminiAvailable } from "./gemini.js";
import { hasLiveOpenAI } from "./openaiLive.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFocusIndustries() {
  const override = String(process.env.GATHER_FOCUS_INDUSTRIES || "").trim();
  if (override) {
    return override
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean)
      .map((industry) => ({
        industry,
        why: `Durga Puja visibility for ${industry} in Patna.`,
        query: `${industry} Patna showroom OR store OR office`,
      }));
  }
  try {
    const file = path.join(__dirname, "..", "data", "durga-puja-industries.json");
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const rows = Array.isArray(raw?.industries) ? raw.industries : Array.isArray(raw) ? raw : [];
    return rows
      .map((row) => ({
        industry: String(row?.industry || "").trim(),
        why: String(row?.why || "").trim(),
        query: String(row?.query || "").trim(),
      }))
      .filter((row) => row.industry && row.query);
  } catch (err) {
    logError("market.loadFocusIndustries", err);
    return [];
  }
}

const FOCUS_INDUSTRIES = loadFocusIndustries();
const FALLBACK_NICHES =
  FOCUS_INDUSTRIES.length > 0
    ? FOCUS_INDUSTRIES
    : [
        {
          industry: "Jewellery",
          why: "Peak Durga Puja jewellery purchase window in Patna.",
          query: "jewellery gold showroom Patna",
        },
      ];

const ALLOWED_LABELS = FALLBACK_NICHES.map((row) => row.industry).join(", ");

const MARKET_PROMPT = `You are advising Loky Media, a Patna DOOH (roadside LED) network with screens on Dakbangla Chauraha (2 screens), Boring Road (3 screens), Rukanpura Jagdeo Path, and Mithapur Bypass.

Durga Puja is approaching. Pick industries ONLY from this operator allowlist:
${ALLOWED_LABELS}

Prefer niches that buy festive / Puja visibility in Patna. Prefer local operators who can buy a 20 seconds / 30 seconds HD spot.

Return JSON only:
{
  "industries": [
    {
      "industry": "exact label from the allowlist",
      "why": "one sentence why this niche is hot in Patna for Durga Puja now",
      "query": "web search query to find companies in Patna for this niche"
    }
  ]
}

Rules:
- Return exactly the requested count of industries
- industry must be copied from the allowlist (exact spelling)
- Each query must include Patna and a corridor or locality when useful
- No national-only brands without a Patna location cue
- Do not invent company names; only industries + search queries
- Do not invent categories outside the allowlist`;

function dayIndex() {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: config.timezone || "Asia/Kolkata" }),
  );
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / 86_400_000);
}

export function fallbackBoomingIndustries(limit = 3) {
  const n = Math.max(1, Math.min(Number(limit) || 3, FALLBACK_NICHES.length));
  const start = dayIndex() % FALLBACK_NICHES.length;
  const picked = [];
  for (let i = 0; i < n; i += 1) {
    picked.push(FALLBACK_NICHES[(start + i) % FALLBACK_NICHES.length]);
  }
  return picked.map((item) => ({ ...item, source: "fallback" }));
}

function normalizeIndustries(raw, limit, source) {
  const list = Array.isArray(raw?.industries) ? raw.industries : Array.isArray(raw) ? raw : [];
  const allowed = new Set(FALLBACK_NICHES.map((r) => r.industry.toLowerCase()));
  const byLabel = new Map(FALLBACK_NICHES.map((r) => [r.industry.toLowerCase(), r]));
  const cleaned = [];
  for (const row of list) {
    const industry = String(row?.industry || "").trim();
    if (!industry) continue;
    const key = industry.toLowerCase();
    if (!allowed.has(key)) continue;
    const canon = byLabel.get(key);
    cleaned.push({
      industry: canon.industry,
      why: String(row?.why || canon.why || "").trim(),
      query: String(row?.query || canon.query || "").trim(),
      source,
    });
    if (cleaned.length >= limit) break;
  }
  return cleaned;
}

/**
 * AI picks booming Patna industries for DOOH outreach (from Durga Puja allowlist).
 * Prefers Gemini (with day cache), then OpenAI; falls back to a rotating niche list.
 */
let marketCache = { dayKey: "", industries: [] };

function istDayKey() {
  return new Date().toLocaleDateString("en-CA", { timeZone: config.timezone || "Asia/Kolkata" });
}

export async function pickBoomingIndustries(limit = 3) {
  const n = Math.max(1, Math.min(Number(limit) || 3, FALLBACK_NICHES.length));
  const dayKey = istDayKey();
  if (marketCache.dayKey === dayKey && marketCache.industries.length >= n) {
    return marketCache.industries.slice(0, n).map((item) => ({ ...item, source: item.source || "gemini-cache" }));
  }

  const user = `Return exactly ${n} industries from the Durga Puja allowlist for this morning's Patna DOOH outreach wave. Prefer festive-budget niches. Rotate across the list; avoid repeating yesterday's obvious picks when possible.`;

  if (geminiAvailable()) {
    try {
      const parsed = await geminiJson({
        system: MARKET_PROMPT,
        user,
        temperature: 0.4,
      });
      const industries = normalizeIndustries(parsed, n, "gemini");
      if (industries.length > 0) {
        marketCache = { dayKey, industries };
        return industries;
      }
    } catch (err) {
      logError("market.pickBoomingIndustries.gemini", err);
    }
  }

  // Skip OpenAI when Gemini key exists — don't burn cron on a dead OpenAI key.
  if (!hasLiveGemini() && hasLiveOpenAI()) {
    try {
      const openai = new OpenAI({ apiKey: config.openaiApiKey, timeout: 8_000 });
      const completion = await openai.chat.completions.create({
        model: config.openaiModel,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: MARKET_PROMPT },
          { role: "user", content: user },
        ],
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
      const industries = normalizeIndustries(parsed, n, "openai");
      if (industries.length > 0) return industries;
    } catch (err) {
      logError("market.pickBoomingIndustries.openai", err);
    }
  }

  return fallbackBoomingIndustries(n);
}
