import { isDecisionMakerEmail } from "./emailUtils.js";

/** Drafted + decision-maker inbox — waiting for the next send cron */
export const STATUS_TO_SEND = "to_send";
/** Drafted but not email-shortlistable yet (phone-only / still researching) */
export const STATUS_READY = "ready";
export const STATUS_SENT = "sent";
export const STATUS_FAILED = "failed";

/**
 * Pick the outbound status after draft is ready.
 * Decision-maker emails become to_send; generic care@ stays ready/not shortlisted.
 */
export function statusAfterDraft(lead, { forceReady = false } = {}) {
  if (forceReady) return STATUS_READY;
  if (lead?.subject && lead?.body && isDecisionMakerEmail(lead.email)) {
    return STATUS_TO_SEND;
  }
  if (lead?.subject && lead?.body) return STATUS_READY;
  return lead?.status || "pending";
}

/** True if this lead is in the follow / send queue */
export function isToBeSent(lead) {
  if (!lead || lead.status === STATUS_SENT) return false;
  if (lead.status === STATUS_TO_SEND && isDecisionMakerEmail(lead.email)) return true;
  return (
    lead.status === STATUS_READY &&
    Boolean(lead.subject && lead.body) &&
    isDecisionMakerEmail(lead.email)
  );
}

export function displayStatus(lead) {
  if (isToBeSent(lead)) return STATUS_TO_SEND;
  return lead?.status || "pending";
}

/** When the lead entered the follow / to-be-sent queue */
export function followedAt(lead) {
  return lead?.generatedAt || lead?.updatedAt || lead?.createdAt || null;
}
