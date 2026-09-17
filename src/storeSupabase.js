import { config } from "./config.js";
import { logError } from "./errors.js";
import { getSupabase } from "./supabase.js";

function table() {
  return config.supabaseLeadsTable;
}

function nowIso() {
  return new Date().toISOString();
}

function parseSources(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value == null || value === "") return [];
  if (typeof value === "object") return [];
  const text = String(value).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // fall through — CSV-style semicolon list
  }
  return text
    .split(/;|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function sourcesForDb(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return "";
  return sources.map(String).filter(Boolean).join("; ");
}

/** DB row (snake_case) → app lead (camelCase) */
export function rowToLead(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    company: row.company || "",
    contactName: row.contact_name || "",
    email: row.email || "",
    title: row.title || "",
    industry: row.industry || "",
    notes: row.notes || "",
    locationHint: row.location_hint || "",
    website: row.website || "",
    researchQuery: row.research_query || "",
    phone: row.phone || "",
    emailSource: row.email_source || "",
    sources: parseSources(row.sources),
    nearestScreen: row.nearest_screen || "",
    buySignals: row.buy_signals || "",
    priority: row.priority || "",
    confidence: row.confidence == null || row.confidence === "" ? null : Number(row.confidence),
    queryWave: row.query_wave || "",
    operator: row.operator || "",
    network: row.network || "",
    whatsapp: row.whatsapp ?? null,
    status: row.status || "pending",
    subject: row.subject || "",
    body: row.body || "",
    wordCount: Number(row.word_count) || 0,
    lastError: row.last_error || "",
    sentAt: row.sent_at || null,
    generatedAt: row.generated_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function throwSb(context, error) {
  const msg = error?.message || String(error);
  logError(context, error);
  const hint = /column|schema cache|does not exist/i.test(msg)
    ? " Run scripts/supabase-emailer-table-migrate.sql in the Supabase SQL editor."
    : "";
  throw Object.assign(new Error(`${context}: ${msg}.${hint}`), { status: 502, cause: error });
}

/** Partial lead/patch → DB columns (only defined keys). */
export function leadToRow(lead = {}, { forInsert = false } = {}) {
  const row = {};
  const map = [
    ["company", "company"],
    ["contactName", "contact_name"],
    ["email", "email"],
    ["title", "title"],
    ["industry", "industry"],
    ["notes", "notes"],
    ["locationHint", "location_hint"],
    ["website", "website"],
    ["researchQuery", "research_query"],
    ["phone", "phone"],
    ["emailSource", "email_source"],
    ["nearestScreen", "nearest_screen"],
    ["buySignals", "buy_signals"],
    ["priority", "priority"],
    ["confidence", "confidence"],
    ["queryWave", "query_wave"],
    ["operator", "operator"],
    ["network", "network"],
    ["status", "status"],
    ["subject", "subject"],
    ["body", "body"],
    ["wordCount", "word_count"],
    ["lastError", "last_error"],
    ["sentAt", "sent_at"],
    ["generatedAt", "generated_at"],
    ["whatsapp", "whatsapp"],
  ];

  for (const [from, to] of map) {
    if (Object.prototype.hasOwnProperty.call(lead, from)) {
      row[to] = lead[from];
    }
  }
  if (Object.prototype.hasOwnProperty.call(lead, "sources")) {
    row.sources = sourcesForDb(lead.sources);
  }
  if (Object.prototype.hasOwnProperty.call(lead, "updatedAt")) {
    row.updated_at = lead.updatedAt;
  } else if (forInsert || Object.keys(row).length) {
    row.updated_at = nowIso();
  }
  if (forInsert && lead.createdAt) row.created_at = lead.createdAt;
  // Never send id on insert — table may use bigint identity from CSV import
  return row;
}

export async function listLeads() {
  const { data, error } = await getSupabase().from(table()).select("*").order("created_at", {
    ascending: false,
  });
  if (error) throwSb("supabase.listLeads", error);
  return (data || []).map(rowToLead);
}

export async function getLead(id) {
  const { data, error } = await getSupabase().from(table()).select("*").eq("id", id).maybeSingle();
  if (error) throwSb("supabase.getLead", error);
  return rowToLead(data);
}

export async function createLead(fields) {
  const stamp = nowIso();
  const lead = {
    ...fields,
    website: fields.website || "",
    researchQuery: fields.researchQuery || "",
    phone: fields.phone || "",
    emailSource: fields.emailSource || "",
    sources: Array.isArray(fields.sources) ? fields.sources : [],
    nearestScreen: fields.nearestScreen || "",
    buySignals: fields.buySignals || "",
    priority: fields.priority || "P1",
    confidence: fields.confidence ?? null,
    queryWave: fields.queryWave || "",
    operator: fields.operator || "Suraj Prakash",
    network: fields.network || "Loky Media Patna DOOH",
    whatsapp: null,
    status: "pending",
    subject: "",
    body: "",
    wordCount: 0,
    lastError: "",
    sentAt: null,
    generatedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  };

  const { data: existing, error: findErr } = await getSupabase()
    .from(table())
    .select("id")
    .eq("email", fields.email)
    .maybeSingle();
  if (findErr) throwSb("supabase.createLead.find", findErr);
  if (existing) {
    throw Object.assign(new Error("A lead with this email already exists"), { status: 409 });
  }

  const { data, error } = await getSupabase()
    .from(table())
    .insert(leadToRow(lead, { forInsert: true }))
    .select("*")
    .single();
  if (error) throwSb("supabase.createLead", error);
  return rowToLead(data);
}

export async function upsertLead(fields, input = {}) {
  const stamp = nowIso();
  const companyKey = fields.company.toLowerCase();

  let existing = null;
  {
    const { data, error } = await getSupabase()
      .from(table())
      .select("*")
      .eq("email", fields.email)
      .maybeSingle();
    if (error) throwSb("supabase.upsertLead.byEmail", error);
    existing = data;
  }
  if (!existing && companyKey) {
    const { data, error } = await getSupabase()
      .from(table())
      .select("*")
      .ilike("company", fields.company)
      .limit(1)
      .maybeSingle();
    if (error) throwSb("supabase.upsertLead.byCompany", error);
    existing = data;
  }

  if (existing) {
    const patch = {
      ...fields,
      emailSource: input.emailSource || existing.email_source || fields.emailSource || "",
      sources: Array.isArray(input.sources) ? input.sources : parseSources(existing.sources),
      phone: fields.phone || existing.phone || "",
      updatedAt: stamp,
    };
    const { data, error } = await getSupabase()
      .from(table())
      .update(leadToRow(patch))
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throwSb("supabase.upsertLead.update", error);
    return rowToLead(data);
  }

  const lead = {
    ...fields,
    website: fields.website || "",
    researchQuery: fields.researchQuery || "",
    phone: fields.phone || "",
    emailSource: input.emailSource || "",
    sources: Array.isArray(input.sources) ? input.sources : [],
    nearestScreen: input.nearestScreen || fields.nearestScreen || "",
    buySignals: input.buySignals || fields.buySignals || "",
    priority: input.priority || fields.priority || "P1",
    confidence: input.confidence ?? fields.confidence ?? null,
    queryWave: input.queryWave || fields.queryWave || "",
    operator: input.operator || fields.operator || "Suraj Prakash",
    network: input.network || fields.network || "Loky Media Patna DOOH",
    whatsapp: null,
    status: "pending",
    subject: "",
    body: "",
    wordCount: 0,
    lastError: "",
    sentAt: null,
    generatedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  };

  const { data, error } = await getSupabase()
    .from(table())
    .insert(leadToRow(lead, { forInsert: true }))
    .select("*")
    .single();
  if (error) throwSb("supabase.upsertLead.insert", error);
  return rowToLead(data);
}

export async function updateLead(id, patch) {
  const allowed = [
    "company",
    "contactName",
    "email",
    "title",
    "industry",
    "notes",
    "locationHint",
    "website",
    "researchQuery",
    "phone",
    "emailSource",
    "sources",
    "nearestScreen",
    "buySignals",
    "priority",
    "confidence",
    "queryWave",
    "operator",
    "network",
    "whatsapp",
    "status",
    "subject",
    "body",
    "wordCount",
    "lastError",
    "sentAt",
    "generatedAt",
  ];
  const next = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key];
  }
  next.updatedAt = nowIso();

  const { data, error } = await getSupabase()
    .from(table())
    .update(leadToRow(next))
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throwSb("supabase.updateLead", error);
  return rowToLead(data);
}

export async function deleteLead(id) {
  const { data, error } = await getSupabase().from(table()).delete().eq("id", id).select("id");
  if (error) throwSb("supabase.deleteLead", error);
  return Array.isArray(data) && data.length > 0;
}

export async function countSentToday(timezone = "Asia/Kolkata") {
  const leads = await listLeads();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = formatter.format(new Date());
  return leads.filter((lead) => {
    if (!lead.sentAt) return false;
    return formatter.format(new Date(lead.sentAt)) === today;
  }).length;
}
