import OpenAI from "openai";
import { config } from "./config.js";
import { hasUsableContact, isDeliverableEmail, normalizePhone, rankEmailForOutreach } from "./emailUtils.js";
import { logError } from "./errors.js";
import { fenceLabels, pickFences } from "./geo.js";
import { geminiJson, geminiAvailable } from "./gemini.js";
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

export function extractPhones(text) {
  const raw = String(text || "");
  const matches =
    raw.match(/(?:\+?91[\s-]*)?(?:0)?[6-9]\d{9}\b|\b0\d{2,4}[\s-]?\d{6,8}\b/g) || [];
  const out = [];
  for (const match of matches) {
    const normalized = normalizePhone(match);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
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
  while ((match = re.exec(html)) && results.length < 12) {
    const href = unwrapDuckHref(match[1].replaceAll("&amp;", "&"));
    const title = stripHtml(match[2]);
    if (!href.startsWith("http")) continue;
    results.push({ title, url: href });
  }
  return results;
}

/**
 * Google Places Text Search biased to a corridor fence (geofenced retrieval).
 * Soft-fails when GOOGLE_MAPS_API_KEY is unset or the API errors.
 */
export async function searchMapsPlaces(query, { fence = null, limit = 8 } = {}) {
  const key = config.googleMapsApiKey;
  if (!key) return [];
  const params = new URLSearchParams({
    query: `${query} Patna`,
    key,
  });
  if (fence?.lat != null && fence?.lng != null) {
    params.set("location", `${fence.lat},${fence.lng}`);
    params.set("radius", String(fence.radiusM || 3000));
  }
  try {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`;
    const raw = await fetchUrl(url, { asHtml: false, timeoutMs: 10_000 });
    const parsed = JSON.parse(raw);
    if (parsed.status && parsed.status !== "OK" && parsed.status !== "ZERO_RESULTS") {
      console.warn(`[warn] maps.places ${parsed.status}: ${parsed.error_message || ""}`);
      return [];
    }
    const results = Array.isArray(parsed.results) ? parsed.results : [];
    return results.slice(0, limit).map((row) => ({
      company: String(row.name || "").trim(),
      address: String(row.formatted_address || "").trim(),
      placeId: String(row.place_id || "").trim(),
      rating: row.rating ?? null,
      locationHint: fence?.label || row.formatted_address || "Patna",
      nearestScreen: fence?.id || "",
      website: "",
      phone: "",
      query: `${row.name || query} Patna contact email phone`,
      source: "google_maps",
    }));
  } catch (err) {
    logFetchSoft("research.searchMapsPlaces", err);
    return [];
  }
}

async function mapsPlaceDetails(placeId) {
  const key = config.googleMapsApiKey;
  if (!key || !placeId) return null;
  try {
    const params = new URLSearchParams({
      place_id: placeId,
      fields: "name,formatted_phone_number,international_phone_number,website,formatted_address,url",
      key,
    });
    const raw = await fetchUrl(
      `https://maps.googleapis.com/maps/api/place/details/json?${params}`,
      { asHtml: false, timeoutMs: 8_000 },
    );
    const parsed = JSON.parse(raw);
    const r = parsed?.result;
    if (!r) return null;
    return {
      phone: normalizePhone(r.international_phone_number || r.formatted_phone_number || ""),
      website: String(r.website || "").trim(),
      address: String(r.formatted_address || "").trim(),
      mapsUrl: String(r.url || "").trim(),
    };
  } catch (err) {
    logFetchSoft("research.mapsPlaceDetails", err);
    return null;
  }
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
  const fences = pickFences(3);

  if (website && looksLikeUrl(website)) {
    targets.push(website.startsWith("http") ? website : `https://${website}`);
  }
  if (looksLikeUrl(query)) {
    targets.push(query.startsWith("http") ? query : `https://${query}`);
  }

  for (const hit of catalogHits(query)) {
    if (hit.website && looksLikeUrl(hit.website) && targets.length < 3) {
      targets.push(hit.website.startsWith("http") ? hit.website : `https://${hit.website}`);
    }
  }

  const searchQueries = [
    `${query} Patna founder OR CEO OR owner OR "marketing head" email`,
    `${query} ${fences[0]?.label || "Fraser Road"} Patna "founder" OR "managing director" contact email -care -support`,
    `${query} Patna team OR about "email" site:.in`,
  ];

  for (const sq of searchQueries) {
    try {
      const hits = await searchWeb(sq);
      sources.push(...hits);
      for (const hit of hits) {
        try {
          if (SKIP_HOST.test(new URL(hit.url).hostname)) continue;
        } catch {
          continue;
        }
        if (targets.length >= 5) break;
        targets.push(hit.url);
      }
    } catch (err) {
      logFetchSoft("research.searchWeb", err);
    }
    if (targets.length >= 5) break;
  }

  // Geofenced Maps discovery → place details for phone/website
  const mapsNotes = [];
  for (const fence of fences.slice(0, 2)) {
    try {
      const places = await searchMapsPlaces(query, { fence, limit: 4 });
      for (const place of places) {
        sources.push({
          title: `${place.company} (Maps · ${fence.label})`,
          url: place.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.company + " Patna")}`,
        });
        if (place.placeId) {
          const details = await mapsPlaceDetails(place.placeId);
          if (details) {
            mapsNotes.push({
              company: place.company,
              ...details,
              locationHint: place.locationHint,
              nearestScreen: place.nearestScreen,
            });
            if (details.website && looksLikeUrl(details.website) && targets.length < 5) {
              targets.push(details.website);
            }
          }
        }
      }
    } catch (err) {
      logFetchSoft("research.mapsCollect", err);
    }
  }

  const unique = [...new Set(targets)].slice(0, 5);
  await Promise.all(
    unique.map(async (url) => {
      try {
        const html = await fetchUrl(url);
        pages.push({
          url,
          text: stripHtml(html),
          emails: extractEmails(html),
          phones: extractPhones(html),
        });
      } catch (err) {
        logFetchSoft(`research.fetch ${url}`, err);
      }
    }),
  );
  return { pages, sources, mapsNotes, fences };
}

async function llmExtract(query, pages, snippets, mapsNotes = [], fences = []) {
  if (!geminiAvailable() && !hasLiveOpenAI()) return null;
  const packed = pages
    .map(
      (p) =>
        `URL: ${p.url}\nEmails seen: ${p.emails.join(", ") || "none"}\nPhones seen: ${(p.phones || []).join(", ") || "none"}\n${p.text.slice(0, 3500)}`,
    )
    .join("\n\n---\n\n");
  const catalogHint = catalogHits(query)
    .slice(0, 2)
    .map((c) => `${c.company} · ${c.locationHint} · ${c.notes}`)
    .join("\n");
  const mapsBlock = (mapsNotes || [])
    .slice(0, 8)
    .map(
      (m) =>
        `${m.company} · phone:${m.phone || "none"} · web:${m.website || "none"} · ${m.locationHint || ""} · screen:${m.nearestScreen || ""}`,
    )
    .join("\n");
  const fenceBlock = (fences || []).map((f) => `${f.id}: ${f.label}`).join("\n") || fenceLabels();
  const user = `Operator query: ${query}

Geofence corridors (prefer businesses inside these):
${fenceBlock}

Google Maps / Places hits (use phone/website when present; do not invent):
${mapsBlock || "(none — set GOOGLE_MAPS_API_KEY for Places geofencing)"}

Catalog hints (use if page text is empty):
${catalogHint || "(none)"}

Search titles:
${snippets || "(none)"}

Page text:
${packed || "(none — invent nothing; use Maps + catalog only)"}`;

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
  const ranked = [...(extractedEmail ? [extractedEmail] : []), ...fromPages]
    .filter(Boolean)
    .filter((email) => isDeliverableEmail(email))
    .sort((a, b) => rankEmailForOutreach(b) - rankEmailForOutreach(a));
  const sameHost = ranked.find((email) => siteHost && email.endsWith(`@${siteHost}`) && rankEmailForOutreach(email) > 0);
  const best = sameHost || ranked.find((email) => rankEmailForOutreach(email) > 0) || "";
  return best;
}

function pickPhone(extracted, pages, mapsNotes = []) {
  const fromMaps = (mapsNotes || []).map((m) => normalizePhone(m.phone)).filter(Boolean);
  const fromPages = pages.flatMap((p) => p.phones || []);
  const fromExtracted = normalizePhone(extracted?.phone || "");
  return fromExtracted || fromMaps[0] || fromPages[0] || "";
}

function mergeLead(query, extracted, pages, catalog, mapsNotes = []) {
  const base = catalog || {};
  const company = extracted?.company || base.company || query;
  const mapsHit = (mapsNotes || []).find(
    (m) =>
      String(m.company || "")
        .toLowerCase()
        .includes(String(company).toLowerCase().slice(0, 12)) ||
      String(company)
        .toLowerCase()
        .includes(String(m.company || "").toLowerCase().slice(0, 12)),
  );
  const website = String(
    extracted?.website || mapsHit?.website || pages[0]?.url || base.website || "",
  ).trim();
  const publicEmail = pickPublicEmail(extracted, pages, website);
  // Never invent mock inboxes — empty email if none found (discarded later if also no phone)
  const email = publicEmail || "";
  const emailSource = publicEmail ? "public" : "";
  const phone = pickPhone(extracted, pages, mapsNotes);

  return {
    company: String(company).trim(),
    contactName: String(extracted?.contactName || base.contactName || "Marketing team").trim(),
    title: String(extracted?.title || base.title || "").trim(),
    industry: String(extracted?.industry || base.industry || "").trim(),
    locationHint: String(
      extracted?.locationHint ||
        mapsHit?.locationHint ||
        base.locationHint ||
        "Patna commuter corridors",
    ).trim(),
    nearestScreen: String(extracted?.nearestScreen || mapsHit?.nearestScreen || "").trim(),
    notes: String(
      extracted?.notes || base.notes || `Researched from public + Maps sources for: ${query}`,
    ).trim(),
    website,
    email,
    phone,
    emailSource,
    sources: [
      ...pages.map((p) => p.url),
      ...(mapsNotes || []).map((m) => m.mapsUrl).filter(Boolean),
    ].filter(Boolean),
  };
}

export async function researchProspect({ query, website = "" } = {}) {
  const q = String(query || "").trim();
  if (!q) {
    throw Object.assign(new Error("Enter a company name, URL, or niche in Patna"), { status: 400 });
  }

  const { pages, sources, mapsNotes, fences } = await collectPages(q, website);
  const hits = catalogHits(q);
  let extracted = null;
  try {
    extracted = await llmExtract(
      q,
      pages,
      sources.map((s) => `${s.title} — ${s.url}`).join("\n"),
      mapsNotes,
      fences,
    );
  } catch (err) {
    logError("research.llmExtract", err);
  }

  const lead = mergeLead(q, extracted, pages, hits[0], mapsNotes);
  return {
    query: q,
    usedCatalog: Boolean(hits[0]) && pages.length === 0,
    usedModel: Boolean(extracted),
    usedMaps: (mapsNotes || []).length > 0,
    searchHits: sources.slice(0, 10),
    lead,
    persistable: hasUsableContact(lead),
    summary: `${lead.company} · ${lead.emailSource || "no"} email · phone:${lead.phone || "none"} · ${lead.locationHint}`,
  };
}

async function geminiDiscover(query, limit) {
  if (!geminiAvailable()) return [];
  try {
    const parsed = await geminiJson({
      system: `You suggest real local B2B operators in Patna, Bihar for DOOH cold outreach near Loky LED corridors (${fenceLabels()}).
Return JSON only: {"prospects":[{"company":"","website":"","query":"","corridor":"","decisionMakerHint":""}]}
Rules:
- Local operators only, geofenced to those corridors.
- Prefer companies where we can find a Founder / CEO / Owner / MD / Marketing Head email (NOT care@, support@, customercare@, info@).
- query should hunt LinkedIn / About / Team / "founder email" / "marketing head email" for that Patna company.
- decisionMakerHint: role to look for (Founder, CEO, Owner, Marketing Head).
- corridor: dakbangla_fraser|boring_road|rukanpura|mithapur|danapur.`,
      user: `Niche: ${query}\nReturn up to ${limit} prospects with diverse corridors. Avoid national customer-care-only brands.`,
      temperature: 0.35,
    });
    const list = Array.isArray(parsed?.prospects) ? parsed.prospects : [];
    return list
      .map((row) => ({
        company: String(row?.company || "").trim().slice(0, 80),
        website: String(row?.website || "").trim(),
        query: String(
          row?.query ||
            `${row?.company || query} Patna founder OR CEO OR owner OR "marketing head" email contact -care -support -customercare`,
        ).trim(),
        corridor: String(row?.corridor || "").trim(),
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

  const fences = pickFences(4);

  // 1) Google Maps geofenced places (best for phone + local operators)
  for (const fence of fences) {
    if (unique.length >= limit) break;
    try {
      const places = await searchMapsPlaces(query, { fence, limit: Math.max(4, Math.ceil(limit / 2)) });
      for (const place of places) {
        if (unique.length >= limit) break;
        push({
          company: place.company,
          website: place.website || "",
          query: `${place.company} ${fence.label} Patna contact email phone website`,
        });
      }
    } catch (err) {
      logFetchSoft("research.discoverMaps", err);
    }
  }

  // 2) Local catalog
  for (const hit of catalogHits(query)) push(hit);

  // 3) Widened web SERP
  const webQueries = [
    `${query} Patna founder OR CEO OR owner email -customercare -support`,
    `${query} ${fences[0]?.label || "Fraser Road"} Patna marketing head email`,
    `${query} Patna "managing director" OR proprietor contact email`,
  ];
  for (const wq of webQueries) {
    if (unique.length >= limit) break;
    try {
      const web = await searchWeb(wq);
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
          query: `${row.title} ${query} official email phone contact`,
        });
      }
    } catch (err) {
      logFetchSoft("research.discoverQueries.search", err);
    }
  }

  // 4) Gemini fill — prefer public email / Maps phone
  if (unique.length < limit) {
    const more = await geminiDiscover(
      `${query}\nGeofence corridors: ${fenceLabels()}\nPrefer companies NOT in: ${[...seen].slice(0, 50).join(", ") || "(none)"}\nPrefer public business email or Google Maps phone.`,
      Math.max(limit - unique.length, 4),
    );
    for (const row of more) {
      if (unique.length >= limit) break;
      push(row);
    }
  }

  return unique.slice(0, limit);
}

export { hasUsableContact, isDeliverableEmail };
