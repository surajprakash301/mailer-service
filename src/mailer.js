import { Resend } from "resend";
import { buildLokyEmailHtml } from "./brand.js";
import { config, assertResend } from "./config.js";

export function buildResendPayload({ to, subject, body, lead = {} }) {
  const payload = {
    from: config.fromEmail,
    to: [to],
    subject,
    text: body,
    html: buildLokyEmailHtml({ subject, body, lead }),
  };
  if (config.replyTo) payload.replyTo = config.replyTo;
  return payload;
}

export async function sendPitch({ to, subject, body, lead = {}, forceLive = false } = {}) {
  try {
    const live = forceLive || !config.dryRun;
    if (live) {
      if (!config.resendApiKey || config.resendApiKey.includes("...")) {
        throw new Error(
          "Live send needs a real RESEND_API_KEY in .env (not the re_... placeholder)",
        );
      }
    } else {
      assertResend();
    }

    const payload = buildResendPayload({ to, subject, body, lead });

    if (!live) {
      return {
        id: `dry-run-${Date.now()}`,
        dryRun: true,
        provider: "resend",
        payload,
      };
    }

    const resend = new Resend(config.resendApiKey);
    const { data, error } = await resend.emails.send(payload);
    if (error) {
      throw new Error(error.message || "Resend send failed");
    }
    return { id: data?.id || "", dryRun: false, provider: "resend", payload };
  } catch (err) {
    throw new Error(`Resend send failed for ${to}: ${err.message}`);
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
