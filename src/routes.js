import { Router } from "express";
import { generateForLead, runDailyCampaign, sendForLead, sendWhatsAppForLead } from "./campaign.js";
import { buildLokyEmailHtml, LOKY_BRAND } from "./brand.js";
import { config } from "./config.js";
import { logError } from "./errors.js";
import { hasLiveOpenAI } from "./openaiLive.js";
import { hasLiveGemini, geminiStatus } from "./gemini.js";
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
  storageBackend,
  updateLead,
  useSupabaseStore,
} from "./store.js";
import {
  STATUS_TO_SEND,
  displayStatus,
  followedAt,
  isToBeSent,
} from "./leadStatus.js";

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

/** When CRON_SECRET is set, require matching secret via header / bearer / body / query. */
function requireCronSecret(req, res, next) {
  if (!config.cronSecret) return next();
  const auth = String(req.get("authorization") || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const provided = String(
    req.get("x-cron-secret") ||
      bearer ||
      req.body?.cronSecret ||
      req.query?.cronSecret ||
      req.query?.secret ||
      "",
  ).trim();
  if (provided && provided === config.cronSecret) return next();
  return res.status(401).json({
    error: "Unauthorized: missing or invalid cron secret",
    hint: "Send header x-cron-secret (or Authorization: Bearer <CRON_SECRET>) matching Render CRON_SECRET",
  });
}

function compactGatherReport(report = {}) {
  return {
    ok: true,
    job: "gather",
    dryRun: report.dryRun,
    added: report.added,
    refreshed: report.refreshed || 0,
    requeued: report.requeued || 0,
    sendable: report.sendable || 0,
    drafted: report.drafted,
    discarded: report.discarded || 0,
    purged: report.purged || 0,
    discarded: report.discarded || 0,
    purged: report.purged || 0,
    skipped: report.skipped,
    failed: Array.isArray(report.failed) ? report.failed.length : report.failed || 0,
    minLeads: report.minLeads || 5,
    minSendable: report.minSendable || 5,
    industries: (report.industries || []).map((i) => i.industry || i).filter(Boolean),
    note: report.note || "",
  };
}

function compactSendReport(report = {}) {
  return {
    ok: true,
    job: "send",
    dryRun: report.dryRun,
    sent: report.sent,
    generated: report.generated,
    skipped: report.skipped,
    reEngaged: report.reEngaged || 0,
    minSend: report.minSend || 5,
    failed: Array.isArray(report.failed) ? report.failed.length : report.failed || 0,
    note: report.note || "",
  };
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
    storage: storageBackend(),
    supabaseConfigured: useSupabaseStore(),
    supabaseTable: config.supabaseLeadsTable,
    cronSecretRequired: Boolean(config.cronSecret),
    disableInternalCron: config.disableInternalCron,
    lastCronRuns: cronRuns,
    model: hasLiveGemini() ? config.geminiModel : config.openaiModel,
    liveGemini: hasLiveGemini(),
    liveOpenAI: hasLiveOpenAI(),
    gemini: geminiStatus(),
    /** Why gather may show source:fallback — Gemini key missing on this host */
    geminiHint: hasLiveGemini()
      ? geminiStatus().circuitOpen
        ? "Gemini quota circuit open — using niche/template fallbacks for 30m"
        : "ok"
      : "Set GEMINI_API_KEY on Render Environment, then redeploy",
    whatsappDryRun: config.whatsappDryRun,
    brand: LOKY_BRAND.name,
  });
}));

router.get("/stats", asyncRoute(async (_req, res) => {
  const leads = await listLeads();
  const sentToday = await countSentToday(config.timezone);
  const drafted = leads.filter((l) => l.subject && l.body);
  const publicEmail = leads.filter((l) => l.emailSource === "public");
  const mockEmail = leads.filter((l) => l.emailSource === "mock" || String(l.email || "").endsWith("@loky-mock.test"));
  const gathered = leads.filter((l) => l.status !== "sent");
  const toSend = leads.filter((l) => isToBeSent(l));
  res.json({
    total: leads.length,
    pending: leads.filter((l) => l.status === "pending").length,
    ready: leads.filter((l) => l.status === "ready" && !isToBeSent(l)).length,
    toSend: toSend.length,
    sent: leads.filter((l) => l.status === "sent").length,
    failed: leads.filter((l) => l.status === "failed").length,
    drafted: drafted.length,
    gathered: gathered.length,
    publicEmail: publicEmail.length,
    mockEmail: mockEmail.length,
    sentToday,
    remainingToday: Math.max(0, config.maxEmailsPerDay - sentToday),
    dryRun: config.dryRun,
  });
}));

router.get("/leads", asyncRoute(async (_req, res) => {
  const leads = await listLeads();
  // Normalize display + backfill to_send for deliverable drafts still marked ready
  const enriched = [];
  for (const lead of leads) {
    const display = displayStatus(lead);
    if (display === STATUS_TO_SEND && lead.status !== STATUS_TO_SEND && lead.status !== "sent") {
      try {
        const updated = await updateLead(lead.id, { status: STATUS_TO_SEND });
        enriched.push({
          ...(updated || lead),
          status: STATUS_TO_SEND,
          displayStatus: STATUS_TO_SEND,
          followedAt: followedAt(updated || lead),
        });
        continue;
      } catch (err) {
        logError(`leads.normalize to_send ${lead.id}`, err);
      }
    }
    enriched.push({
      ...lead,
      status: display === STATUS_TO_SEND ? STATUS_TO_SEND : lead.status,
      displayStatus: display,
      followedAt: followedAt(lead),
    });
  }
  res.json({ leads: enriched });
}));

/** Render the branded HTML email exactly as Resend would send it for one lead. */
router.get("/leads/:id/email", asyncRoute(async (req, res) => {
  const lead = await getLead(req.params.id);
  if (!lead) return notFound(res);
  if (!lead.body) {
    return res.status(404).json({ error: "No drafted email body for this lead yet" });
  }
  const html = buildLokyEmailHtml({
    subject: lead.subject,
    body: lead.body,
    lead,
  });
  res.type("html").send(html);
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

router.post("/campaigns/run", requireCronSecret, asyncRoute(async (req, res) => {
  const opts = {};
  const sync = req.query?.sync === "1" || req.body?.sync === true;
  const verbose = req.query?.verbose === "1" || req.body?.verbose === true;

  const run = async () => {
    const report = await runDailyCampaign();
    await recordCronRun("send", {
      dryRun: report.dryRun,
      sent: report.sent,
      generated: report.generated,
      skipped: report.skipped,
      reEngaged: report.reEngaged || 0,
      failed: report.failed?.length || 0,
      trigger: sync ? "api-sync" : "api-async",
    });
    return report;
  };

  // cron-job.org free timeout is often 30s — respond fast, finish in background
  if (!sync) {
    res.status(202).json({
      ok: true,
      job: "send",
      accepted: true,
      note: "Send running in background. Check /api/health lastCronRuns.send shortly.",
    });
    setImmediate(() => {
      run().catch(async (err) => {
        logError("campaigns.run.async", err);
        await recordCronRun("send", { error: err.message, trigger: "api-async" }).catch(() => undefined);
      });
    });
    return;
  }

  const report = await run();
  res.json(verbose ? { report } : compactSendReport(report));
}));

/** External schedulers (GitHub Actions / cron-job.org) can stamp health without a full job. */
router.post("/cron/record", requireCronSecret, asyncRoute(async (req, res) => {
  const job = String(req.body?.job || "").trim();
  if (job !== "gather" && job !== "send") {
    return res.status(400).json({ error: "job must be gather or send" });
  }
  const summary = req.body?.summary && typeof req.body.summary === "object" ? req.body.summary : {};
  const next = await recordCronRun(job, { ...summary, trigger: summary.trigger || "api-record" });
  res.json({ ok: true, lastCronRuns: next });
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
  const industryLimit = req.body?.industryLimit ?? config.gatherIndustries;
  const companiesPerIndustry = req.body?.companiesPerIndustry ?? config.gatherCompaniesPerIndustry;
  const generate = req.body?.generate !== false;
  const sync = req.query?.sync === "1" || req.body?.sync === true;
  const verbose = req.query?.verbose === "1" || req.body?.verbose === true;

  const run = async () => {
    const report = await runMorningGather({
      industryLimit,
      companiesPerIndustry,
      generate,
    });
    await recordCronRun("gather", {
      industries: report.industries?.map((i) => i.industry),
      added: report.added,
      refreshed: report.refreshed || 0,
      requeued: report.requeued || 0,
      sendable: report.sendable || 0,
      drafted: report.drafted,
      skipped: report.skipped,
      failed: report.failed?.length || 0,
      note: report.note || "",
      trigger: sync ? "api-sync" : "api-async",
    });
    return report;
  };

  // Default async: gather (5+ Gemini researches) often exceeds cron-job.org's 30s timeout
  if (!sync) {
    await recordCronRun("gather", {
      status: "started",
      trigger: "api-async",
      note: "accepted — running in background",
    });
    res.status(202).json({
      ok: true,
      job: "gather",
      accepted: true,
      minLeads: config.gatherMinLeads,
      note: "Gather running in background. Check /api/health lastCronRuns.gather in 1–3 minutes.",
    });
    setImmediate(() => {
      run().catch(async (err) => {
        logError("pipeline.gather.async", err);
        await recordCronRun("gather", {
          error: err.message,
          status: "failed",
          trigger: "api-async",
        }).catch(() => undefined);
      });
    });
    return;
  }

  const report = await run();
  res.json(verbose ? { report } : compactGatherReport(report));
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
  try {
    if (req.query.id) lead = await getLead(String(req.query.id));
    if (!lead) {
      const leads = await listLeads();
      lead = [...leads].reverse().find((l) => l.body) || leads[0] || null;
    }
  } catch (err) {
    logError("preview.email.loadLead", err);
  }
  const subject = lead?.subject || "Durga Puja LED campaign in Patna — Loky Media";
  const body =
    lead?.body ||
    `Hi there,\n\nDurga Puja is coming — and Patna will be full of movement and attention.\n\nSuraj Prakash here, founder of Loky Media. We run digital LED screens on Dakbangla Chauraha (2 screens), Boring Road (3 screens), Rukanpura Jagdeo Path, Mithapur Bypass.\n\nA 20 seconds / 30 seconds HD festive spot on a 2-4.5 minute loop gives 450+ daily impressions while Puja footfall peaks. We also create the video creative in-house.\n\nWant to see where your brand can appear? I can send a free sample of your brand on one of our screens, or WhatsApp me for Durga Puja packages.\n\nSuraj Prakash\nFounder, Loky Media`;
  const html = buildLokyEmailHtml({
    subject,
    body,
    lead: lead || { company: "Hotel Maurya Patna", locationHint: "Dakbangla Chauraha (2 screens), Boring Road (3 screens), Rukanpura Jagdeo Path, Mithapur Bypass" },
  });
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
