import OpenAI from "openai";
import { config } from "./config.js";
import { logError } from "./errors.js";
import { geminiJson, hasLiveGemini, geminiAvailable } from "./gemini.js";
import { hasLiveOpenAI } from "./openaiLive.js";
import { RESEARCH_PROMPT } from "./researchPrompt.js";

/** Browser-like UA — many Patna sites 403 bare Node fetch. */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const SKIP_HOST =
  /duckduckgo|google\.|bing\.|facebook|instagram|youtube|twitter|x\.com|linkedin|justdial|sulekha|indiamart|magicbricks|wikipedia|reddit|hexahealth|practo|lybrate|credihealth|joonsquare|naukri|glassdoor|collegedunia|shiksha|99acres|housing\.com|quora|medium\.com/i;

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
    keywords: ["kia", "amar jyoti", "car", "dealer", "auto", "automobile", "exhibition", "showroom", "vehicle"],
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
    keywords: ["linkway", "hotel", "fraser", "stay", "banquet", "hospitality"],
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
    keywords: ["magadh", "hotel", "fraser", "banquet"],
  },
  {
    company: "Hotel Maurya",
    contactName: "Sales Manager",
    title: "Sales Manager",
    industry: "Hotel",
    locationHint: "Fraser Road / South Gandhi Maidan, Patna",
    website: "https://www.maurya.com/",
    notes:
      "Landmark Patna hotel near Gandhi Maidan. Banquets, rooms, and F&B offers convert well with high-frequency DOOH on Fraser Road and Patna Junction approaches.",
    keywords: ["maurya", "hotel", "banquet", "gandhi maidan", "hospitality"],
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
    keywords: ["paras", "hmri", "hospital", "clinic", "health", "bailey", "rukanpura", "multi-speciality", "multi speciality"],
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
  {
    company: "Ford Hospital Patna",
    contactName: "Marketing Manager",
    title: "Marketing Manager",
    industry: "Hospital",
    locationHint: "New Bypass / NH corridor serving Danapur–Patna traffic",
    website: "",
    notes:
      "Private multi-specialty hospital targeting Patna families. Health packages and OPD camps benefit from repeated roadside impressions on Danapur and Rukanpura routes.",
    keywords: ["ford", "hospital", "clinic", "diagnostic", "lab", "health"],
  },
  {
    company: "Chanakya National Law University",
    contactName: "Admissions Office",
    title: "Admissions",
    industry: "Education",
    locationHint: "Nyaya Nagar, Mithapur, Patna",
    website: "https://www.cnlu.ac.in/",
    notes:
      "Major Patna campus with seasonal admissions awareness needs among students and parents moving through Fraser Road / Patna Junction corridors.",
    keywords: ["chanakya", "cnlu", "coaching", "institute", "college", "admissions", "education", "university"],
  },
  {
    company: "Super 30 / related Patna coaching corridor",
    contactName: "Centre Head",
    title: "Centre Head",
    industry: "Coaching institute",
    locationHint: "Boring Road / Fraser Road student belt, Patna",
    website: "",
    notes:
      "Patna’s coaching belt runs heavy student traffic on Boring Road and Fraser Road. Admission windows need repeated DOOH impressions among parents and aspirants.",
    keywords: ["coaching", "institute", "boring", "neet", "jee", "admissions", "tuition"],
  },
  {
    company: "P&M Mall / retail corridor prospects",
    contactName: "Store Manager",
    title: "Store Manager",
    industry: "Retail",
    locationHint: "Patna retail corridors near Fraser Road / Exhibition Road",
    website: "",
    notes:
      "Festive and store-opening offers convert with high-frequency LED near Patna Junction and Fraser Road footfall.",
    keywords: ["retail", "mall", "showroom", "lifestyle", "store", "festive"],
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
    if (/(example\.com|sentry\.io|wixpress|cloudflare|schema\.org|godaddy|hexahealth|practo|lybrate)/i.test(email)) {
      return false;
    }
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

function logFetchSoft(context, err) {
  const message = err?.message || String(err);
  // Expected from cloud IPs / bot walls — don't look like fatal gather failure
  if (/HTTP 403|HTTP 401|HTTP 404|HTTP 307|HTTP 5\d\d|aborted|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(message)) {
    console.warn(`[warn] ${context}: ${message}`);
    return;
  }
  logError(context, err);
}

async function fetchUrl(url, { asHtml = true, timeoutMs = 6_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: asHtml ? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" : "*/*",
        "Accept-Language": "en-IN,en;q=0.9",
      },
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
  const html = await fetchUrl(url, { timeoutMs: 8_000 });
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
  // Corridor words alone must not pull hotels into a coaching niche, etc.
  const weak = new Set([
    "patna",
    "fraser",
    "road",
    "danapur",
    "rukanpura",
    "bailey",
    "junction",
    "exhibition",
    "boring",
    "station",
    "commuter",
    "corridor",
  ]);
  const tokens = q.split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !weak.has(t));

  return CATALOG.filter((item) => {
    if (q.includes(item.company.toLowerCase())) return true;
    const strongKeys = item.keywords.filter((k) => !weak.has(k) && k.length > 2);
    // Need a strong industry/brand keyword overlap — not just "Fraser Road"
    return strongKeys.some((k) => q.includes(k) || tokens.includes(k));
  });
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

  // Prefer catalog site first (reliable) before flaky SERP pages
  for (const hit of catalogHits(query)) {
    if (hit.website && looksLikeUrl(hit.website) && targets.length < 2) {
      targets.push(hit.website.startsWith("http") ? hit.website : `https://${hit.website}`);
    }
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
      if (targets.length >= 2) break;
      targets.push(hit.url);
    }
  } catch (err) {
    logFetchSoft("research.searchWeb", err);
  }

  const unique = [...new Set(targets)].slice(0, 2);
  await Promise.all(
    unique.map(async (url) => {
      try {
        const html = await fetchUrl(url);
        pages.push({ url, text: stripHtml(html), emails: extractEmails(html) });
      } catch (err) {
        logFetchSoft(`research.fetch ${url}`, err);
      }
    }),
  );
  return { pages, sources };
}

async function llmExtract(query, pages, snippets) {
  if (!geminiAvailable() && !hasLiveOpenAI()) return null;
  const packed = pages
    .map((p) => `URL: ${p.url}\nEmails seen: ${p.emails.join(", ") || "none"}\n${p.text.slice(0, 4000)}`)
    .join("\n\n---\n\n");
  const catalogHint = catalogHits(query)
    .slice(0, 2)
    .map((c) => `${c.company} · ${c.locationHint} · ${c.notes}`)
    .join("\n");
  const user = `Operator query: ${query}\n\nCatalog hints (use if page text is empty):\n${catalogHint || "(none)"}\n\nSearch titles:\n${snippets || "(none)"}\n\nPage text:\n${packed || "(none — invent nothing; use catalog hints only)"}`;

  if (geminiAvailable()) {
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
  const openai = new OpenAI({ apiKey: config.openaiApiKey, timeout: 8_000 });
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
    locationHint: String(
      extracted?.locationHint || base.locationHint || "Patna commuter corridors",
    ).trim(),
    notes: String(
      extracted?.notes || base.notes || `Researched from public sources for: ${query}`,
    ).trim(),
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

  // If model + pages both empty, still ship a catalog or query-based lead
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

async function geminiDiscover(query, limit) {
  if (!geminiAvailable()) return [];
  try {
    const parsed = await geminiJson({
      system: `You suggest real local B2B operators in Patna, Bihar for DOOH cold outreach.
Return JSON only: {"prospects":[{"company":"","website":"","query":""}]}
Rules: local operators only, no national-only brands without a Patna location, website may be empty, query should help find their Patna contact page.`,
      user: `Niche: ${query}\nReturn up to ${limit} prospects.`,
      temperature: 0.3,
    });
    const list = Array.isArray(parsed?.prospects) ? parsed.prospects : [];
    return list
      .map((row) => ({
        company: String(row?.company || "").trim().slice(0, 80),
        website: String(row?.website || "").trim(),
        query: String(row?.query || row?.company || query).trim(),
      }))
      .filter((row) => row.company);
  } catch (err) {
    logError("research.geminiDiscover", err);
    return [];
  }
}

export async function discoverQueries(query, limit = 3, { excludeCompanies = [] } = {}) {
  const unique = [];
  const seen = new Set(
    (excludeCompanies || []).map((c) => String(c || "").toLowerCase().trim()).filter(Boolean),
  );
  const push = (item) => {
    const key = String(item.company || "")
      .toLowerCase()
      .trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    unique.push({
      company: item.company,
      website: item.website || "",
      query: item.query || item.company,
    });
  };

  // 1) Local catalog first — survives when DuckDuckGo / sites block Render
  for (const hit of catalogHits(query)) push(hit);

  // 2) Best-effort web (soft-fail)
  try {
    const web = await searchWeb(`${query} Patna contact email`);
    for (const row of web) {
      if (unique.length >= limit) break;
      try {
        if (SKIP_HOST.test(new URL(row.url).hostname)) continue;
      } catch {
        continue;
      }
      push({
        company: row.title.replace(/\s*[|\-–].*$/, "").slice(0, 80),
        website: row.url,
        query: `${row.title} ${query} official email contact`,
      });
    }
  } catch (err) {
    logFetchSoft("research.discoverQueries.search", err);
  }

  // 3) Gemini fill if still short — ask for fresh local operators with public emails
  if (unique.length < limit) {
    const more = await geminiDiscover(
      `${query}\nPrefer companies NOT in this exclude list: ${[...seen].slice(0, 40).join(", ") || "(none)"}\nPrefer ones with a public business email on their website.`,
      limit - unique.length,
    );
    for (const row of more) {
      if (unique.length >= limit) break;
      push(row);
    }
  }

  if (unique.length === 0) {
    unique.push({ company: query, website: "", query });
  }
  return unique.slice(0, limit);
}
