import { Router } from "express";
import { generateForLead, runDailyCampaign, sendForLead, sendWhatsAppForLead } from "./campaign.js";
import { buildLokyEmailHtml, LOKY_BRAND } from "./brand.js";
import { config } from "./config.js";
import { logError } from "./errors.js";
import { hasLiveOpenAI } from "./openaiLive.js";
import { hasLiveGemini } from "./gemini.js";
import { runDiscoveryPipeline, runResearchPipeline, importProspectsPipeline, runMorningGather } from "./pipeline.js";
import { researchProspect } from "./research.js";
import { checkWhatsAppNumber } from "./whatsapp.js";
import {
  countSentToday,
  createLead,
  deleteLead,
  getLead,
  listLeads,
  readCronRuns,
  recordCronRun,
  updateLead,
} from "./store.js";

export const router = Router();

function asyncRoute(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      logError(`${req.method} ${req.originalUrl}`, err);
      next(err);
    }
  };
}

function notFound(res) {
  return res.status(404).json({ error: "Lead not found" });
}

/** When CRON_SECRET is set, require matching x-cron-secret header. */
function requireCronSecret(req, res, next) {
  if (!config.cronSecret) return next();
  const provided = String(req.get("x-cron-secret") || req.body?.cronSecret || "").trim();
  if (provided && provided === config.cronSecret) return next();
  return res.status(401).json({ error: "Unauthorized: missing or invalid x-cron-secret" });
}

router.get("/health", asyncRoute(async (_req, res) => {
  const cronRuns = await readCronRuns();
  res.json({
    ok: true,
    dryRun: config.dryRun,
    timezone: config.timezone,
    cron: config.sendCronExpression,
    gatherCron: config.gatherCronExpression,
    sendCron: config.sendCronExpression,
    gatherIndustries: config.gatherIndustries,
    gatherCompaniesPerIndustry: config.gatherCompaniesPerIndustry,
    dataDir: config.dataDir,
    cronSecretRequired: Boolean(config.cronSecret),
    disableInternalCron: config.disableInternalCron,
    lastCronRuns: cronRuns,
    model: hasLiveGemini() ? config.geminiModel : config.openaiModel,
    liveGemini: hasLiveGemini(),
    liveOpenAI: hasLiveOpenAI(),
    /** Why gather may show source:fallback — Gemini key missing on this host */
    geminiHint: hasLiveGemini()
      ? "ok"
      : "Set GEMINI_API_KEY on Render Environment, then redeploy",
    whatsappDryRun: config.whatsappDryRun,
    brand: LOKY_BRAND.name,
  });
}));

router.get("/stats", asyncRoute(async (_req, res) => {
  const leads = await listLeads();
  const sentToday = await countSentToday(config.timezone);
  res.json({
    total: leads.length,
    pending: leads.filter((l) => l.status === "pending").length,
    ready: leads.filter((l) => l.status === "ready").length,
    sent: leads.filter((l) => l.status === "sent").length,
    failed: leads.filter((l) => l.status === "failed").length,
    sentToday,
    remainingToday: Math.max(0, config.maxEmailsPerDay - sentToday),
    dryRun: config.dryRun,
  });
}));

router.get("/leads", asyncRoute(async (_req, res) => {
  const leads = await listLeads();
  res.json({ leads });
}));

router.post("/leads", asyncRoute(async (req, res) => {
  const lead = await createLead(req.body);
  res.status(201).json({ lead });
}));

router.get("/leads/:id", asyncRoute(async (req, res) => {
  const lead = await getLead(req.params.id);
  if (!lead) return notFound(res);
  res.json({ lead });
}));

router.patch("/leads/:id", asyncRoute(async (req, res) => {
  const lead = await updateLead(req.params.id, req.body || {});
  if (!lead) return notFound(res);
  res.json({ lead });
}));

router.delete("/leads/:id", asyncRoute(async (req, res) => {
  const ok = await deleteLead(req.params.id);
  if (!ok) return notFound(res);
  res.json({ ok: true });
}));

router.post("/leads/:id/generate", asyncRoute(async (req, res) => {
  const lead = await getLead(req.params.id);
  if (!lead) return notFound(res);
  const updated = await generateForLead(lead);
  res.json({ lead: updated });
}));

router.post("/leads/:id/send", asyncRoute(async (req, res) => {
  const lead = await getLead(req.params.id);
  if (!lead) return notFound(res);
  const forceLive = Boolean(req.body?.forceLive);
  if (!forceLive) {
    const sentToday = await countSentToday(config.timezone);
    if (sentToday >= config.maxEmailsPerDay) {
      return res.status(429).json({ error: "Daily send cap reached" });
    }
  }
  const updated = await sendForLead(lead, {
    force: Boolean(req.body?.force) || forceLive,
    whatsapp: req.body?.whatsapp !== false,
    forceLive,
  });
  res.json({ lead: updated.lead, dryRun: updated.mail?.dryRun, mail: updated.mail, whatsapp: updated.whatsapp });
}));

router.post("/mail/send-live", requireCronSecret, asyncRoute(async (req, res) => {
  const to = String(req.body?.to || "").trim().toLowerCase();
  if (!to.includes("@")) {
    return res.status(400).json({ error: "to email is required" });
  }
  let lead = null;
  if (req.body?.leadId) lead = await getLead(String(req.body.leadId));
  if (!lead) {
    const leads = await listLeads();
    lead = leads.find((l) => l.email === to) || null;
  }
  if (!lead?.body) {
    return res.status(400).json({
      error: "No drafted lead for that address. Import/generate first, then call again.",
    });
  }
  const result = await sendForLead(lead, {
    force: true,
    forceLive: true,
    whatsapp: false,
  });
  res.json({
    ok: true,
    to,
    dryRun: result.mail?.dryRun,
    mailId: result.mail?.id,
    subject: lead.subject,
    mail: result.mail,
  });
}));

router.post("/campaigns/run", requireCronSecret, asyncRoute(async (_req, res) => {
  const report = await runDailyCampaign();
  await recordCronRun("send", {
    dryRun: report.dryRun,
    sent: report.sent,
    generated: report.generated,
    skipped: report.skipped,
    failed: report.failed?.length || 0,
    trigger: "api",
  });
  res.json({ report });
}));

router.post("/research", asyncRoute(async (req, res) => {
  const research = await researchProspect({
    query: req.body?.query,
    website: req.body?.website,
  });
  res.json({ research });
}));

router.post("/pipeline/run", asyncRoute(async (req, res) => {
  const result = await runResearchPipeline({
    query: req.body?.query,
    website: req.body?.website,
    generate: req.body?.generate !== false,
    send: req.body?.send !== false,
  });
  res.json(result);
}));

router.post("/pipeline/discover", asyncRoute(async (req, res) => {
  const result = await runDiscoveryPipeline({
    query: req.body?.query,
    limit: req.body?.limit,
    generate: req.body?.generate !== false,
    send: req.body?.send !== false,
  });
  res.json(result);
}));

router.post("/pipeline/gather", requireCronSecret, asyncRoute(async (req, res) => {
  const report = await runMorningGather({
    industryLimit: req.body?.industryLimit ?? config.gatherIndustries,
    companiesPerIndustry: req.body?.companiesPerIndustry ?? config.gatherCompaniesPerIndustry,
    generate: req.body?.generate !== false,
  });
  await recordCronRun("gather", {
    industries: report.industries?.map((i) => i.industry),
    added: report.added,
    drafted: report.drafted,
    skipped: report.skipped,
    failed: report.failed?.length || 0,
    trigger: "api",
  });
  res.json({ report });
}));

router.post("/pipeline/import", asyncRoute(async (req, res) => {
  const result = await importProspectsPipeline(req.body || {});
  res.json(result);
}));

router.post("/whatsapp/check", asyncRoute(async (req, res) => {
  const phones = Array.isArray(req.body?.phones)
    ? req.body.phones
    : req.body?.phone
      ? [req.body.phone]
      : [];
  if (!phones.length) {
    return res.status(400).json({ error: "phone or phones[] required" });
  }
  const results = [];
  for (const phone of phones) {
    results.push(
      await checkWhatsAppNumber(phone, {
        businessLikely: Boolean(req.body?.businessLikely),
      }),
    );
  }
  res.json({ results, dryRun: config.whatsappDryRun });
}));

router.post("/leads/:id/whatsapp", asyncRoute(async (req, res) => {
  const lead = await getLead(req.params.id);
  if (!lead) return notFound(res);
  const result = await sendWhatsAppForLead(lead);
  res.json(result);
}));

router.get("/preview/email", asyncRoute(async (req, res) => {
  let lead = null;
  if (req.query.id) lead = await getLead(String(req.query.id));
  if (!lead) {
    const leads = await listLeads();
    lead = [...leads].reverse().find((l) => l.body) || leads[0] || null;
  }
  const subject = lead?.subject || "Loky Media · complimentary 10-second screen mock-up";
  const body =
    lead?.body ||
    `Hi there,\n\nSuraj Prakash here, founder of Loky Media. We run roadside LED screens across Patna.\n\nA 10-second HD spot on a 2-minute loop gives 450+ daily impressions. We make the 2D/3D motion in-house.\n\nIf useful, I will send a free 10-second animated mock-up of your brand on one of the screens.\n\nSuraj Prakash\nLoky Media`;
  const html = buildLokyEmailHtml({ subject, body, lead: lead || {} });
  res.type("html").send(html);
}));

router.get("/preview/email.json", asyncRoute(async (req, res) => {
  let lead = null;
  if (req.query.id) lead = await getLead(String(req.query.id));
  if (!lead) {
    const leads = await listLeads();
    lead = [...leads].reverse().find((l) => l.body) || null;
  }
  if (!lead?.body) return res.status(404).json({ error: "No drafted lead to preview" });
  const html = buildLokyEmailHtml({
    subject: lead.subject,
    body: lead.body,
    lead,
  });
  res.json({
    leadId: lead.id,
    company: lead.company,
    subject: lead.subject,
    text: lead.body,
    html,
    brand: LOKY_BRAND,
  });
}));
