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
 * Persistable lead: must have a real public email OR a valid phone.
 * Mock @loky-mock.test alone does not count.
 */
export function hasUsableContact(lead = {}) {
  return isDeliverableEmail(lead.email) || isValidPhone(lead.phone);
}

/** Email shortlist for Resend send cron — public inbox required. */
export function isEmailShortlist(lead = {}) {
  return isDeliverableEmail(lead.email);
}
