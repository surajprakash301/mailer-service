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

/** DB row (snake_case) → app lead (camelCase).
 *  emailer-table may have no `id` / `created_at` (CSV-imported schema) — use company as id.
 */
export function rowToLead(row) {
  if (!row) return null;
  const company = row.company || "";
  return {
    id: String(row.id ?? (company || row.email || "")),
    company,
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
    createdAt: row.created_at || row.updated_at || null,
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
  // Do not write created_at — CSV-imported emailer-table may lack that column
  return row;
}

export async function listLeads() {
  const { data, error } = await getSupabase()
    .from(table())
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throwSb("supabase.listLeads", error);
  return (data || [])
    .map(rowToLead)
    .filter((lead) => lead && lead.company !== "__loky_cron_meta__" && lead.status !== "system");
}

function leadKeyFilter(query, key) {
  const value = String(key || "").trim();
  if (!value) return query;
  // Prefer company as durable key; also accept email lookups
  if (value.includes("@")) return query.eq("email", value.toLowerCase());
  return query.eq("company", value);
}

export async function getLead(id) {
  const { data, error } = await leadKeyFilter(getSupabase().from(table()).select("*"), id).maybeSingle();
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

  const { data: existing, error: findErr } = fields.email
    ? await getSupabase().from(table()).select("company,email").eq("email", fields.email).maybeSingle()
    : { data: null, error: null };
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
  if (fields.email) {
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
      .eq("company", fields.company)
      .maybeSingle();
    if (error) throwSb("supabase.upsertLead.byCompany", error);
    existing = data;
  }

  if (existing) {
    const incomingEmail = String(fields.email || "").trim().toLowerCase();
    const existingEmail = String(existing.email || "").trim().toLowerCase();
    const incomingIsMock = !incomingEmail || incomingEmail.endsWith("@loky-mock.test");
    const existingIsPublic =
      existingEmail && !existingEmail.endsWith("@loky-mock.test") && existingEmail.includes("@");

    const patch = {
      ...fields,
      // Never replace a known public inbox with a mock placeholder
      email: incomingIsMock && existingIsPublic ? existing.email : fields.email,
      emailSource:
        incomingIsMock && existingIsPublic
          ? existing.email_source || "public"
          : input.emailSource || existing.email_source || fields.emailSource || "",
      sources: Array.isArray(input.sources) ? input.sources : parseSources(existing.sources),
      phone: fields.phone || existing.phone || "",
      updatedAt: stamp,
    };
    const { data, error } = await getSupabase()
      .from(table())
      .update(leadToRow(patch))
      .eq("company", existing.company)
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

  const current = await getLead(id);
  if (!current) return null;

  const { data, error } = await getSupabase()
    .from(table())
    .update(leadToRow(next))
    .eq("company", current.company)
    .select("*")
    .maybeSingle();
  if (error) throwSb("supabase.updateLead", error);
  return rowToLead(data);
}

export async function deleteLead(id) {
  const current = await getLead(id);
  if (!current?.company) return false;
  const { data, error } = await getSupabase()
    .from(table())
    .delete()
    .eq("company", current.company)
    .select("company");
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
