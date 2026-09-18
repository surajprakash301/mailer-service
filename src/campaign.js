import { config } from "./config.js";
import { isDeliverableEmail } from "./emailUtils.js";
import { logError } from "./errors.js";
import { generatePitch } from "./llm.js";
import { sendPitch, sleep } from "./mailer.js";
import {
  countSentToday,
  eligibleForSend,
  listLeads,
  updateLead,
} from "./store.js";
import { checkWhatsAppNumber, sendWhatsAppPitch } from "./whatsapp.js";

export async function generateForLead(lead) {
  const copy = await generatePitch(lead);
  return updateLead(lead.id, {
    subject: copy.subject,
    body: copy.body,
    wordCount: copy.wordCount,
    status: "ready",
    generatedAt: new Date().toISOString(),
    lastError: "",
  });
}

export async function sendWhatsAppForLead(lead) {
  if (!lead.phone) {
    return {
      lead,
      whatsapp: {
        skipped: true,
        check: { reason: "no_phone", canMessage: false },
      },
    };
  }
  if (!lead.body) {
    throw Object.assign(new Error("Lead has no generated copy yet"), { status: 400 });
  }

  const result = await sendWhatsAppPitch({
    to: lead.phone,
    body: lead.body,
    lead,
  });

  const updated = await updateLead(lead.id, {
    whatsapp: {
      e164: result.check?.e164 || "",
      onWhatsApp: result.check?.onWhatsApp || false,
      canMessage: result.check?.canMessage || false,
      isBusinessAccount: result.check?.isBusinessAccount || false,
      accountType: result.check?.accountType || "",
      status: result.skipped ? "skipped" : result.dryRun ? "mock_sent" : "sent",
      messageId: result.id || "",
      checkedAt: new Date().toISOString(),
    },
  });

  return { lead: updated, whatsapp: result };
}

export async function sendForLead(lead, { force = false, whatsapp = true, forceLive = false } = {}) {
  if (!eligibleForSend(lead)) {
    throw Object.assign(new Error("Lead has no generated copy yet"), { status: 400 });
  }
  if (lead.status === "sent" && !force) {
    throw Object.assign(new Error("Lead already sent"), { status: 409 });
  }

  const canEmail = isDeliverableEmail(lead.email);
  let mail = null;
  let mailSkippedReason = "";

  if (canEmail) {
    mail = await sendPitch({
      to: lead.email,
      subject: lead.subject,
      body: lead.body,
      lead,
      forceLive,
    });
  } else {
    mailSkippedReason = lead.email ? "mock_or_invalid_email" : "missing_email";
  }

  let wa = null;
  let updated = lead;
  if (whatsapp) {
    try {
      const waResult = await sendWhatsAppForLead(updated);
      updated = waResult.lead;
      wa = waResult.whatsapp;
    } catch (err) {
      logError(`whatsapp lead=${lead.id}`, err);
      wa = { skipped: true, error: err.message };
    }
  }

  const waOk = wa && !wa.skipped && (wa.id || wa.dryRun);
  if (!canEmail && !waOk) {
    // Keep in queue for a later gather/send once a public email or WA is available
    updated = await updateLead(lead.id, {
      status: "ready",
      lastError: `${mailSkippedReason}; awaiting public email or WhatsApp`,
    });
    return {
      lead: updated,
      mail: {
        id: "",
        dryRun: true,
        skipped: true,
        reason: mailSkippedReason,
        provider: "none",
      },
      whatsapp: wa,
      pursued: false,
    };
  }

  updated = await updateLead(updated.id, {
    status: "sent",
    sentAt: new Date().toISOString(),
    lastError: mail?.dryRun
      ? "dry-run"
      : !canEmail
        ? `email_skipped:${mailSkippedReason}; whatsapp_ok`
        : "",
  });

  return {
    lead: updated,
    mail: mail || {
      id: wa?.id || `wa-only-${Date.now()}`,
      dryRun: Boolean(wa?.dryRun),
      skipped: !canEmail,
      reason: mailSkippedReason || "",
      provider: canEmail ? "resend" : "whatsapp",
    },
    whatsapp: wa,
    pursued: true,
  };
}

export { checkWhatsAppNumber };

export async function runDailyCampaign() {
  const sentToday = await countSentToday(config.timezone);
  const remaining = Math.max(0, config.maxEmailsPerDay - sentToday);
  const report = {
    dryRun: config.dryRun,
    sentToday,
    remaining,
    generated: 0,
    sent: 0,
    skipped: 0,
    failed: [],
  };

  if (remaining === 0) {
    report.skipped = (await listLeads()).filter((l) => l.status !== "sent").length;
    return report;
  }

  const leads = await listLeads();
  // Pursue ready first, then researched/pending/failed (retry). Never re-send successful sends.
  const ready = leads.filter((lead) => lead.status === "ready");
  const retry = leads.filter((lead) =>
    ["researched", "pending", "failed"].includes(String(lead.status || "")),
  );
  const queue = [...ready, ...retry];

  for (const lead of queue) {
    if (report.sent >= remaining) {
      report.skipped += 1;
      continue;
    }

    try {
      let current = lead;
      if (!eligibleForSend(current)) {
        current = await generateForLead(current);
        report.generated += 1;
      }
      const result = await sendForLead(current);
      if (result.pursued === false) {
        report.skipped += 1;
        continue;
      }
      report.sent += 1;
      await sleep(config.sendDelayMs);
    } catch (err) {
      logError(`campaign lead=${lead.id} email=${lead.email}`, err);
      report.failed.push({ id: lead.id, email: lead.email, error: err.message });
      try {
        await updateLead(lead.id, { status: "failed", lastError: err.message });
      } catch (persistErr) {
        logError(`campaign persist failure for lead=${lead.id}`, persistErr);
      }
    }
  }

  return report;
}
