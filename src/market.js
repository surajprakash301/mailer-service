import OpenAI from "openai";
import { config } from "./config.js";
import { logError } from "./errors.js";
import { geminiJson, hasLiveGemini } from "./gemini.js";
import { hasLiveOpenAI } from "./openaiLive.js";

const FALLBACK_NICHES = [
  {
    industry: "Multi-speciality hospitals",
    why: "OPD camps and specialty launches need high-frequency Bailey Road / Rukanpura reach.",
    query: "multi speciality hospital Bailey Road Rukanpura Patna contact",
  },
  {
    industry: "Automobile dealers",
    why: "Festive and new-model launches map to Fraser Road and Saguna More showroom traffic.",
    query: "car dealer Exhibition Road OR Saguna More Patna showroom",
  },
  {
    industry: "Hotels and banquets",
    why: "Banquet season and room occupancy depend on CBD / Gandhi Maidan corridor awareness.",
    query: "hotel banquet sales Fraser Road Patna",
  },
  {
    industry: "Coaching institutes",
    why: "Admission windows need repeated impressions among Boring Road / Fraser Road students.",
    query: "coaching institute Boring Road Patna admissions",
  },
  {
    industry: "Diagnostic labs and clinics",
    why: "Health-check packages convert well with daily commuter DOOH near Danapur and Rukanpura.",
    query: "diagnostic lab clinic Danapur Patna",
  },
  {
    industry: "Retail and lifestyle",
    why: "Store openings and festive offers benefit from Patna Junction / Fraser Road footfall.",
    query: "retail showroom mall Fraser Road Patna",
  },
];

const MARKET_PROMPT = `You are advising Loky Media, a Patna DOOH (roadside LED) network with screens on Fraser Road, Patna Junction, Danapur Station, and Rukanpura.

Pick Patna B2B industries that are currently strong for cold outreach today (festive cycles, admissions, healthcare camps, auto launches, hospitality banquets, education, retail). Prefer local operators who can buy a 10-second HD spot.

Return JSON only:
{
  "industries": [
    {
      "industry": "short label",
      "why": "one sentence why this niche is hot in Patna now",
      "query": "web search query to find companies in Patna for this niche"
    }
  ]
}

Rules:
- Return exactly the requested count of industries
- Each query must include Patna and a corridor or locality when useful
- No national-only brands without a Patna location cue
- Do not invent company names; only industries + search queries`;

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
  const cleaned = [];
  for (const row of list) {
    const industry = String(row?.industry || "").trim();
    const query = String(row?.query || "").trim();
    if (!industry || !query) continue;
    cleaned.push({
      industry,
      why: String(row?.why || "").trim(),
      query,
      source,
    });
    if (cleaned.length >= limit) break;
  }
  return cleaned;
}

/**
 * AI picks booming Patna industries for DOOH outreach.
 * Prefers Gemini, then OpenAI; falls back to a rotating niche list.
 */
export async function pickBoomingIndustries(limit = 3) {
  const n = Math.max(1, Math.min(Number(limit) || 3, 5));
  const user = `Return exactly ${n} industries for this morning's Patna DOOH outreach wave.`;

  if (hasLiveGemini()) {
    try {
      const parsed = await geminiJson({
        system: MARKET_PROMPT,
        user,
        temperature: 0.4,
      });
      const industries = normalizeIndustries(parsed, n, "gemini");
      if (industries.length > 0) return industries;
    } catch (err) {
      logError("market.pickBoomingIndustries.gemini", err);
    }
  }

  // Skip OpenAI when Gemini is configured — don't burn cron budget on a dead key.
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
