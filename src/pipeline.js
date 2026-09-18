import { generateForLead, sendForLead } from "./campaign.js";
import { config } from "./config.js";
import { isDeliverableEmail } from "./emailUtils.js";
import { logError } from "./errors.js";
import { statusAfterDraft } from "./leadStatus.js";
import { pickBoomingIndustries } from "./market.js";
import { discoverQueries, researchProspect } from "./research.js";
import { countSentToday, getLead, listLeads, updateLead, upsertLead } from "./store.js";

function step(name, ok, detail) {
  return { name, ok, detail };
}

export async function runResearchPipeline({
  query,
  website = "",
  generate = true,
  send = true,
  /** When true, do not pull already-sent public leads back into the send queue */
  preserveSent = true,
} = {}) {
  const steps = [];

  const research = await researchProspect({ query, website });
  steps.push(step("research", true, research.summary));

  const beforeList = await listLeads();
  const companyKey = String(research.lead.company || "")
    .trim()
    .toLowerCase();
  const prior = beforeList.find(
    (l) =>
      (companyKey && String(l.company || "").toLowerCase() === companyKey) ||
      (research.lead.email && l.email === research.lead.email),
  );

  let lead = await upsertLead({
    ...research.lead,
    researchQuery: query,
  });

  const keepSent =
    preserveSent &&
    prior?.status === "sent" &&
    isDeliverableEmail(prior.email) &&
    isDeliverableEmail(lead.email) &&
    String(prior.email).toLowerCase() === String(lead.email).toLowerCase();

  lead = await updateLead(lead.id, {
    website: research.lead.website,
    emailSource: research.lead.emailSource,
    sources: research.lead.sources,
    researchQuery: query,
    phone: research.lead.phone || prior?.phone || lead.phone || "",
    status: keepSent ? "sent" : "researched",
  });
  steps.push(
    step(
      "save",
      true,
      keepSent ? `Refreshed ${lead.company} (already sent — not re-queued)` : `Saved ${lead.company}`,
    ),
  );

  if (keepSent) {
    return { research, lead, steps, created: !prior, refreshed: Boolean(prior), requeued: false };
  }

  if (generate) {
    try {
      lead = await generateForLead(lead);
      steps.push(step("draft", true, lead.subject));
    } catch (err) {
      logError("pipeline.draft", err);
      steps.push(step("draft", false, err.message));
      throw err;
    }
  }

  if (send && generate) {
    try {
      const sent = await sendForLead(await getLead(lead.id), { force: true });
      lead = sent.lead;
      steps.push(step("send", true, lead.lastError === "dry-run" ? "Mock send (DRY_RUN)" : "Sent"));
      return {
        research,
        lead,
        steps,
        mail: sent.mail,
        created: !prior,
        refreshed: Boolean(prior),
        requeued: true,
      };
    } catch (err) {
      logError("pipeline.send", err);
      steps.push(step("send", false, err.message));
      throw err;
    }
  }

  return {
    research,
    lead,
    steps,
    created: !prior,
    refreshed: Boolean(prior),
    requeued: true,
  };
}

function slugEmail(company) {
  const slug = String(company || "prospect")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${slug || "prospect"}@loky-mock.test`;
}

function mapImportProspect(raw = {}) {
  const company = String(raw.company || "").trim();
  if (!company) {
    throw Object.assign(new Error("Each prospect needs a company"), { status: 400 });
  }
  const email = String(raw.email || "").trim().toLowerCase() || slugEmail(company);
  const emailSource = raw.email ? raw.emailSource || "public" : "mock";
  const locationHint = [raw.locationHint, raw.nearestScreen ? `screen:${raw.nearestScreen}` : ""]
    .filter(Boolean)
    .join(" · ");
  const buy = Array.isArray(raw.buySignals) ? raw.buySignals.join("; ") : "";
  const notes = [raw.notes, buy ? `Buy signals: ${buy}` : ""].filter(Boolean).join("\n");

  return {
    company,
    contactName: String(raw.contactName || "Marketing team").trim(),
    title: String(raw.title || "").trim(),
    industry: String(raw.industry || "").trim(),
    locationHint,
    website: String(raw.website || "").trim(),
    notes,
    email,
    emailSource,
    sources: Array.isArray(raw.sources) ? raw.sources : [],
    researchQuery: String(raw.researchQuery || "").trim(),
    phone: String(raw.phone || "").trim(),
    priority: String(raw.priority || "").trim(),
    confidence: raw.confidence,
  };
}

export async function importProspectsPipeline(payload = {}) {
  const prospects = Array.isArray(payload.prospects) ? payload.prospects : [];
  if (!prospects.length) {
    throw Object.assign(new Error("prospects array is required"), { status: 400 });
  }

  const generate = payload.generate !== false;
  const send = payload.send !== false;
  const results = [];

  for (const raw of prospects) {
    try {
      const mapped = mapImportProspect(raw);
      let lead = await upsertLead(mapped);
      lead = await updateLead(lead.id, {
        website: mapped.website,
        emailSource: mapped.emailSource,
        sources: mapped.sources,
        researchQuery: mapped.researchQuery,
        status: "researched",
      });

      const item = {
        ok: true,
        company: lead.company,
        requestPayload: mapped,
        lead: null,
        emailCopy: null,
        mailPayload: null,
        mailResponse: null,
        steps: [step("import", true, `Saved ${lead.company} → ${lead.email}`)],
      };

      if (generate) {
        lead = await generateForLead(lead);
        item.emailCopy = { subject: lead.subject, body: lead.body, wordCount: lead.wordCount };
        item.steps.push(step("draft", true, lead.subject));
      }

      if (send && generate) {
        const sent = await sendForLead(await getLead(lead.id), {
          force: true,
          whatsapp: payload.whatsapp !== false,
        });
        lead = sent.lead;
        item.mailPayload = sent.mail?.payload || null;
        item.mailResponse = {
          id: sent.mail?.id,
          dryRun: sent.mail?.dryRun,
          provider: sent.mail?.provider,
        };
        item.whatsappCheck = sent.whatsapp?.check || null;
        item.whatsappPayload = sent.whatsapp?.payload || null;
        item.whatsappResponse = sent.whatsapp
          ? {
              id: sent.whatsapp.id,
              dryRun: sent.whatsapp.dryRun,
              skipped: sent.whatsapp.skipped,
              provider: sent.whatsapp.provider,
              error: sent.whatsapp.error,
            }
          : null;
        item.steps.push(
          step("send", true, sent.mail?.dryRun ? "Email mock send (DRY_RUN)" : "Email sent"),
        );
        if (sent.whatsapp?.skipped) {
          item.steps.push(
            step(
              "whatsapp",
              false,
              sent.whatsapp?.check?.reason || sent.whatsapp?.error || "skipped",
            ),
          );
        } else if (sent.whatsapp) {
          item.steps.push(
            step(
              "whatsapp",
              true,
              `${sent.whatsapp.check?.accountType || "user"} · ${sent.whatsapp.dryRun ? "mock" : "live"} · ${sent.whatsapp.check?.e164}`,
            ),
          );
        }
      }

      item.lead = lead;
      results.push(item);
    } catch (err) {
      logError(`pipeline.import ${raw?.company || "unknown"}`, err);
      results.push({
        ok: false,
        company: raw?.company || "unknown",
        error: err.message,
      });
    }
  }

  return {
    meta: {
      queryWave: payload.queryWave || "",
      operator: payload.operator || "",
      imported: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      dryRun: true,
    },
    results,
  };
}

export async function runDiscoveryPipeline({ query, limit = 3, generate = true, send = true } = {}) {
  const prospects = await discoverQueries(query, Math.min(Number(limit) || 3, 5));
  const results = [];
  for (const prospect of prospects) {
    try {
      const run = await runResearchPipeline({
        query: prospect.query || prospect.company,
        website: prospect.website || "",
        generate,
        send,
      });
      results.push({ ok: true, company: run.lead.company, lead: run.lead, steps: run.steps });
    } catch (err) {
      logError(`pipeline.discover ${prospect.company}`, err);
      results.push({ ok: false, company: prospect.company, error: err.message });
    }
  }
  return { results };
}

/**
 * Morning gather: widen across many industries until we have:
 *  - gatherMinLeads NEW companies (not already in DB), and
 *  - gatherMinSendable leads with a real public email ready for Resend.
 * Prefer brand-new companies; skip known names until new-count target is met.
 */
export async function runMorningGather({
  industryLimit = config.gatherIndustries,
  companiesPerIndustry = config.gatherCompaniesPerIndustry,
  minLeads = config.gatherMinLeads,
  minSendable = config.gatherMinSendable,
  generate = true,
} = {}) {
  const sentToday = await countSentToday(config.timezone);
  const remaining = Math.max(0, config.maxEmailsPerDay - sentToday);
  const targetNew = Math.max(Number(minLeads) || 5, 5);
  const targetSendable = Math.max(Number(minSendable) || 5, 5);
  const industryCount = Math.max(Number(industryLimit) || 3, targetNew * 2, 8);
  const maxAttempts = Math.max(targetNew * 4, industryCount * Math.max(companiesPerIndustry, 2), 20);

  const report = {
    dryRun: config.dryRun,
    sentToday,
    remaining,
    maxAttempts,
    minLeads: targetNew,
    minSendable: targetSendable,
    industries: [],
    added: 0,
    refreshed: 0,
    drafted: 0,
    requeued: 0,
    sendable: 0,
    skipped: 0,
    failed: [],
    results: [],
    batchIds: [],
  };

  const industries = await pickBoomingIndustries(industryCount);
  report.industries = industries;

  const existing = await listLeads();
  const knownCompanies = new Set(
    existing.map((l) => String(l.company || "").toLowerCase().trim()).filter(Boolean),
  );
  const seenThisRun = new Set();
  let attempts = 0;
  const gatherWave = `gather-${new Date().toISOString().slice(0, 10)}`;

  const targetsMet = () => report.added >= targetNew && report.sendable >= targetSendable;

  for (const niche of industries) {
    if (targetsMet() || attempts >= maxAttempts) break;

    let prospects = [];
    try {
      const need = Math.max(
        companiesPerIndustry,
        targetNew - report.added + 2,
        targetSendable - report.sendable + 2,
      );
      prospects = await discoverQueries(niche.query, Math.min(Math.max(need, 4), 10), {
        excludeCompanies: [...knownCompanies, ...seenThisRun],
      });
      prospects.sort((a, b) => {
        const aKnown = knownCompanies.has(String(a.company || "").toLowerCase()) ? 1 : 0;
        const bKnown = knownCompanies.has(String(b.company || "").toLowerCase()) ? 1 : 0;
        return aKnown - bKnown;
      });
    } catch (err) {
      logError(`pipeline.gather.discover ${niche.industry}`, err);
      report.failed.push({ industry: niche.industry, error: err.message });
      continue;
    }

    for (const prospect of prospects) {
      if (targetsMet() || attempts >= maxAttempts) break;

      const companyKey = String(prospect.company || "").toLowerCase();
      if (companyKey && seenThisRun.has(companyKey)) {
        report.skipped += 1;
        continue;
      }
      if (companyKey && knownCompanies.has(companyKey) && report.added < targetNew) {
        report.skipped += 1;
        report.results.push({
          ok: true,
          skipped: true,
          company: prospect.company,
          reason: "prefer_new_company",
          industry: niche.industry,
        });
        continue;
      }
      if (companyKey) seenThisRun.add(companyKey);

      try {
        attempts += 1;
        const run = await runResearchPipeline({
          query: prospect.query || prospect.company,
          website: prospect.website || "",
          generate,
          send: false,
          preserveSent: false,
        });

        let lead = run.lead;
        const sendable = isDeliverableEmail(lead.email);
        const created = Boolean(run.created);

        if (created && companyKey) knownCompanies.add(companyKey);

        if (run.requeued !== false) {
          lead = await updateLead(lead.id, {
            queryWave: gatherWave,
            status:
              lead.subject && lead.body
                ? statusAfterDraft(lead)
                : lead.status,
          });
          report.requeued += 1;
          if (sendable) {
            report.sendable += 1;
            report.batchIds.push(lead.id);
          }
        }

        if (created) report.added += 1;
        else report.refreshed += 1;
        if (lead.subject && lead.body) report.drafted += 1;

        report.results.push({
          ok: true,
          skipped: false,
          created,
          refreshed: Boolean(run.refreshed),
          requeued: run.requeued !== false,
          sendable,
          company: lead.company,
          leadId: lead.id,
          status: lead.status,
          email: lead.email,
          emailSource: lead.emailSource,
          industry: niche.industry,
          queryWave: gatherWave,
          steps: run.steps,
        });
      } catch (err) {
        logError(`pipeline.gather ${prospect.company}`, err);
        report.failed.push({
          company: prospect.company,
          industry: niche.industry,
          error: err.message,
        });
        report.results.push({
          ok: false,
          company: prospect.company,
          industry: niche.industry,
          error: err.message,
        });
      }
    }
  }

  const notes = [];
  if (report.added < targetNew) notes.push(`only ${report.added}/${targetNew} new companies`);
  if (report.sendable < targetSendable) {
    notes.push(`only ${report.sendable}/${targetSendable} with public email`);
  }
  report.note = notes.join("; ");

  return report;
}
