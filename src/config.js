import "dotenv/config";

function required(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : "";
}

export const config = {
  port: Number(process.env.PORT) || 8787,
  openaiApiKey: required("OPENAI_API_KEY"),
  openaiModel: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
  geminiApiKey: required("GEMINI_API_KEY"),
  geminiModel: process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite",
  resendApiKey: required("RESEND_API_KEY"),
  fromEmail: process.env.FROM_EMAIL?.trim() || "Loky Media <surajprakash@lokymedia.com>",
  replyTo: process.env.REPLY_TO?.trim() || "support@lokymedia.com",
  dryRun: process.env.DRY_RUN !== "false",
  maxEmailsPerDay: Number(process.env.MAX_EMAILS_PER_DAY) || 25,
  sendDelayMs: Number(process.env.SEND_DELAY_MS) || 800,
  timezone: "Asia/Kolkata",
  /** @deprecated use sendCronExpression */
  cronExpression: process.env.SEND_CRON?.trim() || process.env.CRON_EXPRESSION?.trim() || "45 8 * * *",
  gatherCronExpression: process.env.GATHER_CRON?.trim() || "0 7 * * *",
  sendCronExpression: process.env.SEND_CRON?.trim() || process.env.CRON_EXPRESSION?.trim() || "45 8 * * *",
  gatherIndustries: Number(process.env.GATHER_INDUSTRIES) || 3,
  gatherCompaniesPerIndustry: Number(process.env.GATHER_COMPANIES_PER_INDUSTRY) || 2,
  /** Minimum leads researched+queued per gather session */
  gatherMinLeads: Math.max(1, Number(process.env.GATHER_MIN_LEADS) || 5),
  /** Re-pursue successfully sent leads after this many days */
  reEngageAfterDays: Math.max(1, Number(process.env.RE_ENGAGE_AFTER_DAYS) || 10),
  dataDir: process.env.DATA_DIR?.trim() || "data",
  supabaseUrl:
    process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "",
  supabasePublishableKey:
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    "",
  /** Server-only; use for cron/RLS bypass. Never expose to the browser. */
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  /** Table used by gather/send when service role is configured */
  supabaseLeadsTable: process.env.SUPABASE_LEADS_TABLE?.trim() || "emailer-table",
  cronSecret: required("CRON_SECRET"),
  /** Free hosts sleep; use external cron + set this true to avoid double runs. */
  disableInternalCron: process.env.DISABLE_INTERNAL_CRON === "true",
  // WhatsApp Cloud API (Meta)
  whatsappToken: required("WHATSAPP_TOKEN"),
  whatsappPhoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
  whatsappBusinessAccountId: required("WHATSAPP_BUSINESS_ACCOUNT_ID"),
  whatsappGraphVersion: process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v21.0",
  whatsappTemplateName: process.env.WHATSAPP_TEMPLATE_NAME?.trim() || "",
  whatsappTemplateLang: process.env.WHATSAPP_TEMPLATE_LANG?.trim() || "en",
  whatsappEnableContactsCheck: process.env.WHATSAPP_ENABLE_CONTACTS_CHECK === "true",
  whatsappDryRun:
    process.env.WHATSAPP_DRY_RUN != null && String(process.env.WHATSAPP_DRY_RUN).trim() !== ""
      ? process.env.WHATSAPP_DRY_RUN !== "false"
      : process.env.DRY_RUN !== "false",
};

export function assertOpenAI() {
  if (!config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is missing. Add it to .env");
  }
}

export function assertResend() {
  if (config.dryRun) return;
  if (!config.resendApiKey) {
    throw new Error("RESEND_API_KEY is missing. Add it to .env or keep DRY_RUN=true");
  }
}

export function assertWhatsApp() {
  if (config.whatsappDryRun) return;
  if (!config.whatsappToken || !config.whatsappPhoneNumberId) {
    throw new Error(
      "WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID required, or keep WHATSAPP_DRY_RUN=true",
    );
  }
}
