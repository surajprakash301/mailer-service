import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuid } from "uuid";
import { config } from "./config.js";
import { logError } from "./errors.js";
import { getSupabase, isSupabaseConfigured } from "./supabase.js";
import * as sb from "./storeSupabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Prefer Supabase when URL + service role are set (durable store for Render). */
export function useSupabaseStore() {
  return Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
}

export function storageBackend() {
  return useSupabaseStore() ? `supabase:${config.supabaseLeadsTable}` : `file:${resolveDataDir()}`;
}

function resolveDataDir() {
  const configured = config.dataDir;
  if (path.isAbsolute(configured)) return configured;
  return path.join(__dirname, "..", configured);
}

export function getDataDir() {
  return resolveDataDir();
}

function leadsFile() {
  return path.join(resolveDataDir(), "leads.json");
}

function cronLogFile() {
  return path.join(resolveDataDir(), "cron-runs.json");
}

let writeQueue = Promise.resolve();

async function readDb() {
  try {
    const raw = await readFile(leadsFile(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.leads) ? parsed : { leads: [] };
  } catch (err) {
    if (err.code === "ENOENT") return { leads: [] };
    logError("store.readDb", err);
    throw err;
  }
}

async function writeDb(db) {
  const dir = resolveDataDir();
  await mkdir(dir, { recursive: true });
  const file = leadsFile();
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(db, null, 2)}\n`);
  await rename(tmp, file);
}

function mutate(fn) {
  const run = writeQueue.then(async () => {
    try {
      const db = await readDb();
      const result = await fn(db);
      await writeDb(db);
      return result;
    } catch (err) {
      logError("store.mutate", err);
      throw err;
    }
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

function nowIso() {
  return new Date().toISOString();
}

function emptyCronRuns() {
  return { gather: null, send: null };
}

function cronTable() {
  return process.env.SUPABASE_CRON_TABLE?.trim() || "cron_runs";
}

const CRON_META_COMPANY = "__loky_cron_meta__";
const CRON_META_EMAIL = "cron-meta@loky.internal";

function rowToCronEntry(row) {
  if (!row) return null;
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  return {
    at: row.at || null,
    storage: row.storage || "",
    ...payload,
  };
}

async function readCronRunsFromFile() {
  try {
    const raw = await readFile(cronLogFile(), "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return emptyCronRuns();
    logError("store.readCronRuns.file", err);
    return emptyCronRuns();
  }
}

async function writeCronRunsFile(next) {
  const dir = resolveDataDir();
  await mkdir(dir, { recursive: true });
  const file = cronLogFile();
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
  await rename(tmp, file);
}

async function readCronRunsFromCronTable() {
  const { data, error } = await getSupabase().from(cronTable()).select("job,at,storage,payload");
  if (error) throw error;
  const out = emptyCronRuns();
  for (const row of data || []) {
    if (row.job === "gather" || row.job === "send") {
      out[row.job] = rowToCronEntry(row);
    }
  }
  return out;
}

async function writeCronRunToCronTable(job, entry) {
  const { at, storage, ...payload } = entry;
  const { error } = await getSupabase()
    .from(cronTable())
    .upsert({ job, at, storage, payload }, { onConflict: "job" });
  if (error) throw error;
}

/** Fallback when cron_runs table is missing — one meta row in emailer-table. */
async function readCronRunsFromMetaRow() {
  const { data, error } = await getSupabase()
    .from(config.supabaseLeadsTable)
    .select("notes")
    .eq("company", CRON_META_COMPANY)
    .maybeSingle();
  if (error) throw error;
  if (!data?.notes) return emptyCronRuns();
  try {
    const parsed = JSON.parse(data.notes);
    return {
      gather: parsed.gather || null,
      send: parsed.send || null,
    };
  } catch {
    return emptyCronRuns();
  }
}

async function writeCronRunsToMetaRow(next) {
  // emailer-table has no id column — company is the unique key
  const payload = {
    company: CRON_META_COMPANY,
    contact_name: "System",
    title: "Cron status",
    email: CRON_META_EMAIL,
    email_source: "system",
    industry: "system",
    notes: JSON.stringify(next),
    status: "system",
    operator: "system",
    network: "Loky Media Patna DOOH",
    query_wave: "cron-meta",
    updated_at: nowIso(),
  };
  const { error } = await getSupabase()
    .from(config.supabaseLeadsTable)
    .upsert(payload, { onConflict: "company" });
  if (error) throw error;
}

function isMissingRelationError(err) {
  const msg = String(err?.message || err || "");
  return /Could not find the table|schema cache|does not exist/i.test(msg);
}

/**
 * Prefer dedicated cron_runs table; else meta row in emailer-table; else local JSON.
 * Ephemeral Render disk alone is not durable.
 */
export async function readCronRuns() {
  if (useSupabaseStore()) {
    try {
      return await readCronRunsFromCronTable();
    } catch (err) {
      if (!isMissingRelationError(err)) logError("store.readCronRuns.cron_table", err);
      try {
        return await readCronRunsFromMetaRow();
      } catch (err2) {
        logError("store.readCronRuns.meta_row", err2);
      }
    }
  }
  return readCronRunsFromFile();
}

export async function recordCronRun(job, summary = {}) {
  const entry = {
    at: nowIso(),
    storage: storageBackend(),
    ...summary,
  };
  const current = await readCronRuns();
  const next = { ...current, [job]: entry };

  if (useSupabaseStore()) {
    try {
      await writeCronRunToCronTable(job, entry);
    } catch (err) {
      if (!isMissingRelationError(err)) logError("store.recordCronRun.cron_table", err);
      try {
        await writeCronRunsToMetaRow(next);
      } catch (err2) {
        logError("store.recordCronRun.meta_row", err2);
      }
    }
  }

  try {
    await writeCronRunsFile(next);
  } catch (err) {
    logError("store.recordCronRun.file", err);
  }
  return next;
}

export function normalizeLeadInput(body = {}) {
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim();
  const hasEmail = Boolean(email && email.includes("@"));
  const hasPhone = Boolean(phone);
  if (!hasEmail && !hasPhone) {
    throw Object.assign(new Error("A valid email or phone is required"), { status: 400 });
  }

  return {
    company: String(body.company || "").trim(),
    contactName: String(body.contactName || "").trim(),
    email: hasEmail ? email : "",
    title: String(body.title || "").trim(),
    industry: String(body.industry || "").trim(),
    notes: String(body.notes || "").trim(),
    locationHint: String(body.locationHint || "").trim(),
    website: String(body.website || "").trim(),
    researchQuery: String(body.researchQuery || "").trim(),
    phone,
  };
}

export async function listLeads() {
  if (useSupabaseStore()) return sb.listLeads();
  const db = await readDb();
  return db.leads;
}

export async function getLead(id) {
  if (useSupabaseStore()) return sb.getLead(id);
  const db = await readDb();
  return db.leads.find((lead) => lead.id === id) || null;
}

export async function createLead(input) {
  const fields = normalizeLeadInput(input);
  if (useSupabaseStore()) {
    return sb.createLead({
      ...fields,
      emailSource: input.emailSource || "",
      sources: Array.isArray(input.sources) ? input.sources : [],
      nearestScreen: input.nearestScreen || "",
      buySignals: input.buySignals || "",
      priority: input.priority || "P1",
      confidence: input.confidence ?? null,
      queryWave: input.queryWave || "",
      operator: input.operator || "",
      network: input.network || "",
    });
  }
  return mutate((db) => {
    const existing = db.leads.find((lead) => lead.email === fields.email);
    if (existing) {
      throw Object.assign(new Error("A lead with this email already exists"), { status: 409 });
    }
    const lead = {
      id: uuid(),
      ...fields,
      website: fields.website || "",
      researchQuery: fields.researchQuery || "",
      phone: fields.phone || "",
      emailSource: "",
      sources: [],
      whatsapp: null,
      status: "pending",
      subject: "",
      body: "",
      wordCount: 0,
      lastError: "",
      sentAt: null,
      generatedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    db.leads.push(lead);
    return lead;
  });
}

export async function upsertLead(input) {
  const fields = normalizeLeadInput(input);
  if (useSupabaseStore()) return sb.upsertLead(fields, input);
  return mutate((db) => {
    const companyKey = fields.company.toLowerCase();
    const existing = db.leads.find(
      (lead) =>
        lead.email === fields.email ||
        (companyKey && lead.company && lead.company.toLowerCase() === companyKey),
    );
    if (existing) {
      const incomingEmail = String(fields.email || "").trim().toLowerCase();
      const existingEmail = String(existing.email || "").trim().toLowerCase();
      const incomingIsMock = !incomingEmail || incomingEmail.endsWith("@loky-mock.test");
      const existingIsPublic =
        existingEmail && !existingEmail.endsWith("@loky-mock.test") && existingEmail.includes("@");
      Object.assign(existing, fields);
      if (incomingIsMock && existingIsPublic) {
        existing.email = existingEmail;
        existing.emailSource = existing.emailSource || "public";
      } else if (input.emailSource) {
        existing.emailSource = input.emailSource;
      }
      if (Array.isArray(input.sources)) existing.sources = input.sources;
      if (fields.phone) existing.phone = fields.phone;
      existing.updatedAt = nowIso();
      return existing;
    }
    const lead = {
      id: uuid(),
      ...fields,
      website: fields.website || "",
      researchQuery: fields.researchQuery || "",
      phone: fields.phone || "",
      emailSource: input.emailSource || "",
      sources: Array.isArray(input.sources) ? input.sources : [],
      whatsapp: null,
      status: "pending",
      subject: "",
      body: "",
      wordCount: 0,
      lastError: "",
      sentAt: null,
      generatedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    db.leads.push(lead);
    return lead;
  });
}

export async function updateLead(id, patch) {
  if (useSupabaseStore()) return sb.updateLead(id, patch);
  return mutate((db) => {
    const lead = db.leads.find((item) => item.id === id);
    if (!lead) return null;
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
      "whatsapp",
      "status",
      "subject",
      "body",
      "wordCount",
      "lastError",
      "sentAt",
      "generatedAt",
    ];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        lead[key] = patch[key];
      }
    }
    lead.updatedAt = nowIso();
    return lead;
  });
}

export async function deleteLead(id) {
  if (useSupabaseStore()) return sb.deleteLead(id);
  return mutate((db) => {
    const before = db.leads.length;
    db.leads = db.leads.filter((lead) => lead.id !== id);
    return db.leads.length < before;
  });
}

export async function countSentToday(timezone = "Asia/Kolkata") {
  if (useSupabaseStore()) return sb.countSentToday(timezone);
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

export function eligibleForSend(lead) {
  return Boolean(lead?.subject && lead?.body);
}

if (isSupabaseConfigured() && !useSupabaseStore()) {
  console.warn(
    "[store] Supabase URL is set but SUPABASE_SERVICE_ROLE_KEY is missing — using local leads.json",
  );
}
