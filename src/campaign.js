import { config } from "./config.js";
import { isDeliverableEmail, isEmailShortlist } from "./emailUtils.js";
import { logError } from "./errors.js";
import { generatePitch } from "./llm.js";
import { sendPitch, sleep } from "./mailer.js";
import {
  STATUS_FAILED,
  STATUS_READY,
  STATUS_SENT,
  STATUS_TO_SEND,
  statusAfterDraft,
} from "./leadStatus.js";
import {
  countSentToday,
  eligibleForSend,
  listLeads,
  updateLead,
} from "./store.js";
import { checkWhatsAppNumber, sendWhatsAppPitch } from "./whatsapp.js";

export async function generateForLead(lead) {
  const copy = await generatePitch(lead);
  const next = {
    ...lead,
    subject: copy.subject,
    body: copy.body,
    email: lead.email,
  };
  return updateLead(lead.id, {
    subject: copy.subject,
    body: copy.body,
    wordCount: copy.wordCount,
    status: statusAfterDraft(next),
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
  if (lead.status === STATUS_SENT && !force) {
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
      status: STATUS_READY,
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
    status: STATUS_SENT,
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

function daysSince(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / (24 * 60 * 60 * 1000);
}

function todayWave() {
  return `gather-${new Date().toISOString().slice(0, 10)}`;
}

export async function runDailyCampaign() {
  const sentToday = await countSentToday(config.timezone);
  const remaining = Math.max(0, config.maxEmailsPerDay - sentToday);
  const reEngageDays = config.reEngageAfterDays;
  const minSend = Math.max(Number(config.sendMinEmails) || 5, 5);
  const report = {
    dryRun: config.dryRun,
    sentToday,
    remaining,
    minSend,
    generated: 0,
    sent: 0,
    skipped: 0,
    reEngaged: 0,
    failed: [],
  };

  if (remaining === 0) {
    report.skipped = (await listLeads()).filter((l) => l.status !== "sent").length;
    report.note = "Daily send cap reached";
    return report;
  }

  const leads = await listLeads();
  const wave = todayWave();

  // Email send shortlist: public inbox required (mock / phone-only never queued for Resend)
  const emailable = leads.filter((lead) => isEmailShortlist(lead));

  const score = (lead) => {
    let s = 0;
    if (isDeliverableEmail(lead.email)) s += 100;
    if (lead.queryWave === wave) s += 50;
    if (lead.status === STATUS_TO_SEND || lead.status === STATUS_READY) s += 10;
    return s;
  };

  const fromGather = emailable
    .filter(
      (lead) =>
        lead.queryWave === wave ||
        ((lead.status === STATUS_TO_SEND || lead.status === STATUS_READY) &&
          daysSince(lead.generatedAt || lead.updatedAt) < 1),
    )
    .sort((a, b) => score(b) - score(a));

  const retry = emailable
    .filter(
      (lead) =>
        !fromGather.some((g) => g.id === lead.id) &&
        [STATUS_TO_SEND, STATUS_READY, "researched", "pending", STATUS_FAILED].includes(
          String(lead.status || ""),
        ),
    )
    .sort((a, b) => score(b) - score(a));

  const staleSent = emailable
    .filter(
      (lead) =>
        lead.status === STATUS_SENT &&
        lead.sentAt &&
        daysSince(lead.sentAt) >= reEngageDays &&
        !fromGather.some((g) => g.id === lead.id),
    )
    .sort((a, b) => score(b) - score(a));

  // Deliverable first within each bucket so we hit SEND_MIN_EMAILS
  const queue = [
    ...fromGather.map((l) => ({ lead: l, force: true, bucket: "gather" })),
    ...retry.map((l) => ({ lead: l, force: false, bucket: "retry" })),
    ...staleSent.map((l) => ({ lead: l, force: true, bucket: "reengage" })),
  ].sort((a, b) => {
    const bucketRank = { gather: 0, retry: 1, reengage: 2 };
    const br = (bucketRank[a.bucket] ?? 9) - (bucketRank[b.bucket] ?? 9);
    if (br !== 0) return br;
    return score(b.lead) - score(a.lead);
  });

  report.shortlisted = queue.length;
  report.skippedNoEmail = leads.length - emailable.length;

  for (const item of queue) {
    if (report.sent >= remaining) {
      report.skipped += 1;
      continue;
    }
    const { lead, force, bucket } = item;

    if (!isEmailShortlist(lead)) {
      report.skipped += 1;
      continue;
    }

    try {
      let current = lead;
      if (bucket === "reengage") {
        current = await updateLead(lead.id, {
          status: statusAfterDraft({ ...lead, subject: lead.subject, body: lead.body }),
          lastError: `re-engage after ${reEngageDays}d`,
        });
        report.reEngaged += 1;
      }
      if (!eligibleForSend(current)) {
        current = await generateForLead(current);
        report.generated += 1;
      }
      const result = await sendForLead(current, { force: force || bucket === "gather" });
      if (result.pursued === false) {
        report.skipped += 1;
        continue;
      }
      report.sent += 1;
      await sleep(config.sendDelayMs);
    } catch (err) {
      logError(`campaign lead=${lead.id} email=${lead.email}`, err);
      report.failed.push({ id: lead.id, email: lead.email, error: err.message, bucket });
      try {
        await updateLead(lead.id, { status: STATUS_FAILED, lastError: err.message });
      } catch (persistErr) {
        logError(`campaign persist failure for lead=${lead.id}`, persistErr);
      }
    }
  }

  if (report.sent < minSend) {
    report.note = `Only sent ${report.sent}/${minSend} (need more public-email leads from gather)`;
  }

  return report;
}
