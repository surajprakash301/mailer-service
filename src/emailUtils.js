/** Real inbox we can send with Resend (exclude placeholders). */
export function isDeliverableEmail(email) {
  const value = String(email || "")
    .trim()
    .toLowerCase();
  if (!value.includes("@")) return false;
  if (value.endsWith("@loky-mock.test")) return false;
  if (value.endsWith("@example.com") || value.endsWith("@example-patna-motors.test")) return false;
  return true;
}

/** Shared / customer-care mailboxes — not useful for B2B decision-maker outreach. */
const GENERIC_LOCAL =
  /^(care|support|customercare|customer[._-]?care|customer[._-]?service|help|helpdesk|helpline|service|services|feedback|complaints|complaint|enquiry|inquiry|enquiries|inquiries|noreply|no[._-]?reply|donotreply|do[._-]?not[._-]?reply|admin|webmaster|postmaster|mailer[._-]?daemon|newsletter|news|press|media|hr|jobs|career|careers|recruit|recruitment|billing|accounts|account|finance|orders|order|booking|bookings|reservations|appointment|appointments|info|contact|hello|hi|team|office|store|shop|branch|reception|front[._-]?desk|desk)$/i;

/** Role / person-style local parts we prefer for outreach. */
const DECISION_LOCAL =
  /^(founder|co[._-]?founder|ceo|md|managing[._-]?director|director|owner|proprietor|partner|president|vp|marketing|brand|growth|sales[._-]?head|business|bdm|cmo|coo|cto|gm|general[._-]?manager|manager)$/i;

export function emailLocalPart(email) {
  const value = String(email || "")
    .trim()
    .toLowerCase();
  const at = value.indexOf("@");
  if (at <= 0) return "";
  return value.slice(0, at);
}

export function isGenericMailbox(email) {
  if (!isDeliverableEmail(email)) return true;
  return GENERIC_LOCAL.test(emailLocalPart(email));
}

/** Prefer founder/CEO/marketing-style inboxes; reject care/support/info dumps. */
export function isDecisionMakerEmail(email) {
  if (!isDeliverableEmail(email) || isGenericMailbox(email)) return false;
  const local = emailLocalPart(email);
  if (DECISION_LOCAL.test(local)) return true;
  // Person-like local part: first.last / firstname (not a shared queue)
  if (/^[a-z]{2,}[._-]?[a-z]{2,}$/i.test(local) && !GENERIC_LOCAL.test(local)) return true;
  return !GENERIC_LOCAL.test(local);
}

export function rankEmailForOutreach(email) {
  if (!isDeliverableEmail(email)) return -1;
  if (isGenericMailbox(email)) return 0;
  const local = emailLocalPart(email);
  if (DECISION_LOCAL.test(local)) return 100;
  if (/^[a-z]+\.[a-z]+$/i.test(local)) return 90;
  return 50;
}

/** Normalize / validate Indian or E.164 business phones. */
export function normalizePhone(phone) {
  const raw = String(phone || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91") && /^91[6-9]/.test(digits)) {
    return `+${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("0") && /^0[6-9]/.test(digits)) {
    return `+91${digits.slice(1)}`;
  }
  if (digits.length >= 10 && digits.length <= 15) return raw.startsWith("+") ? `+${digits}` : `+${digits}`;
  return "";
}

export function isValidPhone(phone) {
  return Boolean(normalizePhone(phone));
}

/**
 * Persistable for gather: must have a decision-maker email.
 * Phone is optional (stored as empty/null when unknown).
 */
export function hasUsableContact(lead = {}) {
  if (isDecisionMakerEmail(lead.email)) return true;
  const employees = Array.isArray(lead.employees) ? lead.employees : [];
  return employees.some((e) => isDecisionMakerEmail(e?.email));
}

/** Resend shortlist — decision-maker style public inboxes only. */
export function isEmailShortlist(lead = {}) {
  return isDecisionMakerEmail(lead.email);
}

export const FOCUS_INDUSTRY_LABELS = [
  "Real Estate",
  "Healthcare",
  "Startups",
  "FMCG",
  "Jewellery",
  "Automobile",
  "Fashion",
];
