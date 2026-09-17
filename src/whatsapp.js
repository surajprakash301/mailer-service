import { config } from "./config.js";
import { logError } from "./errors.js";
import { buildWhatsAppText, LOKY_BRAND } from "./brand.js";

/**
 * Normalize Indian / international phones to E.164 (+91…).
 */
export function normalizePhone(raw) {
  const original = String(raw || "").trim();
  let digits = original.replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) digits = `+${digits.slice(1).replace(/\D/g, "")}`;
  else digits = digits.replace(/\D/g, "");

  if (digits.startsWith("+")) {
    return digits.length >= 11 ? digits : "";
  }
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `+91${digits.slice(1)}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length > 10 && digits.length <= 15) return `+${digits}`;
  return "";
}

/** Patna-style STD landlines (0612-… / +91 612 …) are not WhatsApp-messageable. */
export function looksLikeIndianLandline(raw) {
  const s = String(raw || "").trim();
  if (/^0\d{2,4}[\s-]?\d{6,8}$/.test(s.replace(/\s+/g, " "))) return true;
  const digits = s.replace(/\D/g, "");
  if (/^0612/.test(digits)) return true;
  // Already E.164 / national form without trunk 0 (Patna STD 612 + 7 digits)
  if (/^91612\d{7}$/.test(digits) || /^612\d{7}$/.test(digits)) return true;
  return false;
}

export function isValidIndianMobile(e164) {
  return /^\+91[6-9]\d{9}$/.test(e164);
}

function graphBase() {
  const version = config.whatsappGraphVersion || "v21.0";
  return `https://graph.facebook.com/${version}`;
}

/**
 * Check whether a number can be messaged on WhatsApp.
 *
 * Live Meta Cloud API does not expose a public "is Business Account" lookup
 * for arbitrary third-party numbers. We therefore:
 *  1) Validate E.164 format
 *  2) In DRY_RUN / without token: mock a messaging-availability check
 *  3) With token: optionally probe Graph (contacts sync if enabled) and
 *     classify business_likely from operator context (public email / company phone)
 *
 * Meta will still require an approved template for first outreach when live.
 */
export async function checkWhatsAppNumber(phone, { businessLikely = false } = {}) {
  const e164 = normalizePhone(phone);
  if (!e164) {
    return {
      ok: false,
      phone: "",
      e164: "",
      onWhatsApp: false,
      canMessage: false,
      isBusinessAccount: false,
      reason: "invalid_phone",
      dryRun: config.whatsappDryRun,
    };
  }

  if (looksLikeIndianLandline(phone)) {
    return {
      ok: true,
      phone,
      e164,
      onWhatsApp: false,
      canMessage: false,
      isBusinessAccount: false,
      accountType: "landline",
      reason: "landline_not_whatsapp",
      dryRun: config.whatsappDryRun,
    };
  }

  if (!isValidIndianMobile(e164)) {
    return {
      ok: false,
      phone,
      e164,
      onWhatsApp: false,
      canMessage: false,
      isBusinessAccount: false,
      reason: "unsupported_format",
      dryRun: config.whatsappDryRun,
    };
  }

  if (config.whatsappDryRun || !config.whatsappToken || !config.whatsappPhoneNumberId) {
    const onWhatsApp = isValidIndianMobile(e164);
    return {
      ok: true,
      phone,
      e164,
      onWhatsApp,
      canMessage: onWhatsApp,
      isBusinessAccount: onWhatsApp && businessLikely,
      accountType: onWhatsApp ? (businessLikely ? "business_likely" : "personal_or_unknown") : "none",
      reason: onWhatsApp ? "mock_check_passed" : "mock_not_on_whatsapp",
      dryRun: true,
      note: "Mock check. Connect WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID and set WHATSAPP_DRY_RUN=false for live Cloud API sends. Meta does not expose a guaranteed third-party Business Account detector; first live outreach must use an approved template.",
    };
  }

  // Live path: attempt a lightweight Graph call; fall back to sendability = valid number.
  try {
    if (config.whatsappEnableContactsCheck) {
      const url = `${graphBase()}/${config.whatsappPhoneNumberId}/contacts`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.whatsappToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ blocking: "wait", contacts: [e164], force_check: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        logError("whatsapp.contacts_check", new Error(data?.error?.message || res.statusText));
      } else {
        const entry = data?.contacts?.[0] || {};
        const status = String(entry.status || "").toLowerCase();
        const onWhatsApp = status === "valid" || status === "processing";
        return {
          ok: true,
          phone,
          e164: entry.wa_id ? `+${entry.wa_id}` : e164,
          onWhatsApp,
          canMessage: onWhatsApp,
          isBusinessAccount: businessLikely && onWhatsApp,
          accountType: businessLikely && onWhatsApp ? "business_likely" : onWhatsApp ? "user" : "none",
          reason: onWhatsApp ? "contacts_api_valid" : "contacts_api_invalid",
          dryRun: false,
          raw: entry,
        };
      }
    }
  } catch (err) {
    logError("whatsapp.check", err);
  }

  return {
    ok: true,
    phone,
    e164,
    onWhatsApp: true,
    canMessage: true,
    isBusinessAccount: businessLikely,
    accountType: businessLikely ? "business_likely" : "unknown",
    reason: "assumed_reachable_pending_template_send",
    dryRun: false,
  };
}

export function buildWhatsAppPayload({ to, body, lead }) {
  const text = buildWhatsAppText({ body, lead });
  const e164 = normalizePhone(to);
  const useTemplate = Boolean(config.whatsappTemplateName);

  if (useTemplate) {
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: e164.replace(/^\+/, ""),
      type: "template",
      template: {
        name: config.whatsappTemplateName,
        language: { code: config.whatsappTemplateLang || "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: lead?.company || "there" },
              { type: "text", text: (body || "").slice(0, 320) },
            ],
          },
        ],
      },
      _previewText: text,
    };
  }

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: e164.replace(/^\+/, ""),
    type: "text",
    text: { preview_url: true, body: text },
    _previewText: text,
  };
}

export async function sendWhatsAppPitch({ to, body, lead }) {
  const check = await checkWhatsAppNumber(to, {
    businessLikely: Boolean(
      lead?.emailSource === "public" ||
        lead?.industry ||
        (lead?.company && lead?.phone),
    ),
  });

  if (!check.canMessage) {
    return {
      id: "",
      dryRun: check.dryRun,
      provider: "whatsapp-cloud",
      skipped: true,
      check,
      payload: null,
    };
  }

  const payload = buildWhatsAppPayload({ to: check.e164, body, lead });

  if (config.whatsappDryRun || !config.whatsappToken) {
    return {
      id: `wa-dry-run-${Date.now()}`,
      dryRun: true,
      provider: "whatsapp-cloud",
      skipped: false,
      check,
      payload,
      brand: LOKY_BRAND.name,
    };
  }

  const url = `${graphBase()}/${config.whatsappPhoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsappToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      Object.fromEntries(Object.entries(payload).filter(([k]) => !k.startsWith("_"))),
    ),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `WhatsApp send failed (${res.status})`);
  }

  return {
    id: data?.messages?.[0]?.id || "",
    dryRun: false,
    provider: "whatsapp-cloud",
    skipped: false,
    check,
    payload,
    raw: data,
  };
}
