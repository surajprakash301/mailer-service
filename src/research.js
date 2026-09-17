import OpenAI from "openai";
import { config } from "./config.js";
import { logError } from "./errors.js";
import { geminiJson, hasLiveGemini } from "./gemini.js";
import { hasLiveOpenAI } from "./openaiLive.js";
import { RESEARCH_PROMPT } from "./researchPrompt.js";

const UA = "LokyMediaResearch/1.0 (DOOH outreach mockup; +https://localhost)";
const SKIP_HOST =
  /duckduckgo|google\.|bing\.|facebook|instagram|youtube|twitter|x\.com|linkedin|justdial|sulekha|indiamart|magicbricks|wikipedia|reddit|hexahealth|practo|lybrate|credihealth|joonsquare|naukri|glassdoor/i;

const CATALOG = [
  {
    company: "Amar Jyoti Kia",
    contactName: "Showroom Manager",
    title: "Sales Manager",
    industry: "Automobile dealer",
    locationHint: "Exhibition Road, next to the Fraser Road / Patna Junction commuter belt",
    website: "https://amarjyotikia.com/",
    notes:
      "Authorized Kia dealer with Exhibition Road, Saguna More, and Kankarbagh showrooms. Festive and new-model launches need high-frequency visual reach among Patna car shoppers.",
    keywords: ["kia", "amar jyoti", "car", "dealer", "auto", "exhibition", "showroom"],
  },
  {
    company: "Hotel Linkway",
    contactName: "Front Office Manager",
    title: "Manager",
    industry: "Hotel",
    locationHint: "Capital Tower, Fraser Road, Patna",
    website: "",
    notes:
      "Budget business hotel on Fraser Road, above Syndicate Bank in Capital Tower. Occupancy and banquet leads depend on people already moving through the same corridor as Loky screens.",
    keywords: ["linkway", "hotel", "fraser", "stay", "banquet"],
  },
  {
    company: "Magadh Hotel",
    contactName: "General Manager",
    title: "General Manager",
    industry: "Hotel",
    locationHint: "Fraser Road, Patna",
    website: "",
    notes:
      "Long-standing Fraser Road hotel in the CBD. Roadside LED can push rooms, dining, and events to daily commuter traffic at Patna Junction and Fraser Road.",
    keywords: ["magadh", "hotel", "fraser"],
  },
  {
    company: "Paras HMRI Hospital",
    contactName: "Marketing Head",
    title: "Head of Marketing",
    industry: "Hospital",
    locationHint: "Bailey Road / Raja Bazar, on the Rukanpura–Danapur commute",
    website: "https://www.parashospitals.com/hospitals/paras-hmri-hospital-patna/",
    notes:
      "Multi-specialty hospital serving west Patna. OPD, health-check, and specialty camps are a natural fit for high-frequency DOOH on Danapur Station and Rukanpura corridors.",
    keywords: ["paras", "hmri", "hospital", "clinic", "health", "bailey", "rukanpura"],
  },
  {
    company: "AIIMS Patna",
    contactName: "Public Relations Officer",
    title: "PRO",
    industry: "Hospital",
    locationHint: "Phulwari Sharif, on the Danapur / Patna Junction approach",
    website: "https://aiimspatna.edu.in/",
    notes:
      "Major tertiary hospital west of the city core. Awareness for OPDs, blood donation, and public health camps maps to commuter screens toward Danapur Station.",
    keywords: ["aiims", "hospital", "phulwari", "danapur", "medical"],
  },
];

function slugEmail(company) {
  const slug = String(company || "prospect")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${slug || "prospect"}@loky-mock.test`;
}

export function extractEmails(text) {
  const matches = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(matches.map((e) => e.toLowerCase()))].filter((email) => {
    if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(email)) return false;
    if (/(example\.com|sentry\.io|wixpress|cloudflare|schema\.org|godaddy|hexahealth|practo|lybrate)/i.test(email)) return false;
    if (/^(noreply|no-reply|donotreply)@/i.test(email)) return false;
    return true;
  });
}

export function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 14000);
}

async function fetchUrl(url, { asHtml = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: asHtml ? "text/html,*/*" : "*/*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > 400_000 ? buf.slice(0, 400_000) : buf;
    return new TextDecoder("utf-8", { fatal: false }).decode(slice);
  } finally {
    clearTimeout(timer);
  }
}

function unwrapDuckHref(href) {
  try {
    const parsed = new URL(href, "https://duckduckgo.com");
    return parsed.searchParams.get("uddg") || parsed.href;
  } catch {
    return href;
  }
}

export async function searchWeb(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchUrl(url);
  const results = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html)) && results.length < 8) {
    const href = unwrapDuckHref(match[1].replaceAll("&amp;", "&"));
    const title = stripHtml(match[2]);
    if (!href.startsWith("http")) continue;
    results.push({ title, url: href });
  }
  return results;
}

function catalogHits(query) {
  const q = String(query || "").toLowerCase();
  return CATALOG.filter((item) => item.keywords.some((k) => q.includes(k)) || q.includes(item.company.toLowerCase()));
}

function looksLikeUrl(value) {
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    return Boolean(url.hostname.includes("."));
  } catch {
    return false;
  }
}

async function collectPages(query, website) {
  const pages = [];
  const sources = [];
  const targets = [];

  if (website && looksLikeUrl(website)) {
    targets.push(website.startsWith("http") ? website : `https://${website}`);
  }
  if (looksLikeUrl(query)) {
    targets.push(query.startsWith("http") ? query : `https://${query}`);
  }

  try {
    const hits = await searchWeb(`${query} Patna official website contact`);
    sources.push(...hits);
    for (const hit of hits) {
      try {
        if (SKIP_HOST.test(new URL(hit.url).hostname)) continue;
      } catch {
        continue;
      }
      if (targets.length >= 3) break;
      targets.push(hit.url);
    }
  } catch (err) {
    logError("research.searchWeb", err);
  }

  const unique = [...new Set(targets)];
  for (const url of unique.slice(0, 3)) {
    try {
      const html = await fetchUrl(url);
      pages.push({ url, text: stripHtml(html), emails: extractEmails(html) });
    } catch (err) {
      logError(`research.fetch ${url}`, err);
    }
  }
  return { pages, sources };
}

async function llmExtract(query, pages, snippets) {
  if (!hasLiveGemini() && !hasLiveOpenAI()) return null;
  const packed = pages
    .map((p) => `URL: ${p.url}\nEmails seen: ${p.emails.join(", ") || "none"}\n${p.text.slice(0, 4000)}`)
    .join("\n\n---\n\n");
  const user = `Operator query: ${query}\n\nSearch titles:\n${snippets}\n\nPage text:\n${packed || "(none)"}`;

  if (hasLiveGemini()) {
    try {
      return await geminiJson({
        system: RESEARCH_PROMPT,
        user,
        temperature: 0.2,
      });
    } catch (err) {
      logError("research.llmExtract.gemini", err);
    }
  }

  if (!hasLiveOpenAI()) return null;
  const openai = new OpenAI({ apiKey: config.openaiApiKey });
  const completion = await openai.chat.completions.create({
    model: config.openaiModel,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: RESEARCH_PROMPT },
      { role: "user", content: user },
    ],
  });
  try {
    return JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch (err) {
    logError("research.llmExtract.openai parse", err);
    return null;
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function pickPublicEmail(extracted, pages, website) {
  const siteHost = hostOf(website || pages[0]?.url || "");
  const fromPages = pages.flatMap((p) => {
    if (SKIP_HOST.test(hostOf(p.url))) return [];
    return p.emails;
  });
  const extractedEmail = extracted?.email ? extractEmails(extracted.email)[0] : "";
  const ranked = [...(extractedEmail ? [extractedEmail] : []), ...fromPages].filter(Boolean);
  const sameHost = ranked.find((email) => siteHost && email.endsWith(`@${siteHost}`));
  return sameHost || ranked.find((email) => !SKIP_HOST.test(email.split("@")[1] || "")) || "";
}

function mergeLead(query, extracted, pages, catalog) {
  const base = catalog || {};
  const company = extracted?.company || base.company || query;
  const website = String(extracted?.website || pages[0]?.url || base.website || "").trim();
  const publicEmail = pickPublicEmail(extracted, pages, website);
  const email = publicEmail || slugEmail(company);
  const emailSource = publicEmail ? "public" : "mock";

  return {
    company: String(company).trim(),
    contactName: String(extracted?.contactName || base.contactName || "Marketing team").trim(),
    title: String(extracted?.title || base.title || "").trim(),
    industry: String(extracted?.industry || base.industry || "").trim(),
    locationHint: String(extracted?.locationHint || base.locationHint || "Patna commuter corridors").trim(),
    notes: String(extracted?.notes || base.notes || `Researched from public sources for: ${query}`).trim(),
    website,
    email,
    emailSource,
    sources: pages.map((p) => p.url),
  };
}

export async function researchProspect({ query, website = "" } = {}) {
  const q = String(query || "").trim();
  if (!q) {
    throw Object.assign(new Error("Enter a company name, URL, or niche in Patna"), { status: 400 });
  }

  const { pages, sources } = await collectPages(q, website);
  const hits = catalogHits(q);
  let extracted = null;
  try {
    extracted = await llmExtract(
      q,
      pages,
      sources.map((s) => `${s.title} — ${s.url}`).join("\n"),
    );
  } catch (err) {
    logError("research.llmExtract", err);
  }

  const lead = mergeLead(q, extracted, pages, hits[0]);
  return {
    query: q,
    usedCatalog: Boolean(hits[0]) && pages.length === 0,
    usedModel: Boolean(extracted),
    searchHits: sources.slice(0, 6),
    lead,
    summary: `${lead.company} · ${lead.emailSource} email · ${lead.locationHint}`,
  };
}

export async function discoverQueries(query, limit = 3) {
  const unique = [];
  const seen = new Set();
  const push = (item) => {
    const key = item.company.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(item);
  };

  for (const hit of catalogHits(query)) push(hit);

  try {
    const web = await searchWeb(`${query} Patna`);
    for (const row of web) {
      if (unique.length >= limit) break;
      push({
        company: row.title.replace(/\s*[|\-–].*$/, "").slice(0, 80),
        website: row.url,
        query: `${row.title} ${query}`,
      });
    }
  } catch (err) {
    logError("research.discoverQueries", err);
  }

  if (unique.length === 0) {
    unique.push({ company: query, website: "", query });
  }
  return unique.slice(0, limit);
}
