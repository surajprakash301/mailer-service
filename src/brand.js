/**
 * Loky Media brand tokens pulled from lokymedia.com
 * CTA / live green: rgb(0, 174, 86) → #00AE56
 * Accent coral: rgb(254, 101, 69) → #FE6545
 * Hero: /static/images/hero-bg-mobile.png
 */
export const LOKY_BRAND = {
  name: "Loky Media",
  tagline: "YOUR BRAND ON PATNA SCREENS THIS DURGA PUJA.",
  seasonLabel: "Durga Puja · Patna",
  ctaLabel: "Get a free Durga Puja sample on our screen →",
  whyLine:
    "Prime Patna LED locations · high visibility on the move · 10s HD festive video · in-house creative · free sample of your brand on screen",
  siteUrl: "https://www.lokymedia.com",
  inventoryUrl: "https://www.lokymedia.com/product/list",
  logoUrl: "https://www.lokymedia.com/static/images/logo.svg",
  heroBgUrl: "https://www.lokymedia.com/static/images/hero-bg-mobile.png",
  /** Absolute URL required in email clients; served from /public/email/ */
  inventoryBannerPath: "/email/loky-dooh-banner.jpg",
  ctaIconPath: "/email/icon-screen.svg",
  whatsappIconPath: "/email/icon-whatsapp.svg",
  supportEmail: "support@lokymedia.com",
  supportPhone: "+91-9123472510",
  /** Digits only for wa.me — override with WHATSAPP_BUSINESS_E164 if needed */
  whatsappE164: "919123472510",
  whatsappCtaLabel: "WhatsApp us for Durga Puja slots →",
  coral: "#FE6545",
  green: "#00AE56",
  whatsappGreen: "#25D366",
  ink: "#111827",
  black: "#000000",
  muted: "#4B5563",
  line: "#E5E7EB",
  paper: "#FFFFFF",
  soft: "#F8FAFC",
  // Email-safe stack: Inter when web fonts load, then system UI fonts (no nested quotes)
  font: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
  founder: "Suraj Prakash",
  founderTitle: "Founder, Loky Media",
};

/** Base URL for hosted email assets (local preview or Render). */
export function emailAssetBaseUrl() {
  const raw =
    process.env.EMAIL_ASSET_BASE_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.PUBLIC_BASE_URL?.trim() ||
    `http://localhost:${process.env.PORT || 8787}`;
  return raw.replace(/\/$/, "");
}

export function inventoryBannerUrl() {
  return `${emailAssetBaseUrl()}${LOKY_BRAND.inventoryBannerPath}`;
}

export function ctaIconUrl() {
  return `${emailAssetBaseUrl()}${LOKY_BRAND.ctaIconPath}`;
}

export function whatsappIconUrl() {
  return `${emailAssetBaseUrl()}${LOKY_BRAND.whatsappIconPath}`;
}

/** Opens WhatsApp chat with optional prefilled business query. */
export function whatsappChatUrl(lead = {}) {
  const digits =
    (process.env.WHATSAPP_BUSINESS_E164 || LOKY_BRAND.whatsappE164 || "")
      .replace(/\D/g, "") || "919123472510";
  const company = String(lead.company || "our brand").trim() || "our brand";
  const text = encodeURIComponent(
    `Hi Suraj, this is regarding Durga Puja LED advertising on Loky Media screens for ${company}. Please share available slots.`,
  );
  return `https://wa.me/${digits}?text=${text}`;
}

export function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Longer phrases first so "Durga Puja" wins over "Puja", etc. */
const BODY_EMPHASIS = [
  "Durga Puja",
  "advertisement screens",
  "advertisement screen",
  "advertising screens",
  "advertising screen",
  "digital LED screens",
  "digital LED billboards",
  "LED billboards",
  "LED screens",
  "roadside LED",
  "Loky Media",
  "LOKY Media",
  "Fraser Road",
  "Patna Junction",
  "Danapur Station",
  "Rukanpura",
  "free sample",
  "video creative",
  "10-second",
  "2-minute loop",
  "450+",
  "Patna",
];

/**
 * Wrap key phrases in <strong>, then escape the rest for skim-friendly email body.
 * Longer phrases are matched first so "Durga Puja" wins over a lone "Puja".
 */
export function emphasizeBodyHtml(text) {
  let raw = String(text || "");
  const hits = [];
  for (const phrase of BODY_EMPHASIS) {
    const re = new RegExp(escapeRegExp(phrase), "gi");
    raw = raw.replace(re, (match) => {
      const i = hits.length;
      hits.push(match);
      return `\u0000${i}\u0000`;
    });
  }
  let html = escapeHtml(raw);
  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => {
    const phrase = escapeHtml(hits[Number(i)]);
    return `<strong style="font-weight:700;color:#111827;">${phrase}</strong>`;
  });
  return html.replaceAll("\n", "<br/>");
}

export function paragraphsFromBody(body) {
  return String(body || "")
    .trim()
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

/**
 * Branded HTML email aligned with lokymedia.com hero, fonts, and green CTAs.
 */
export function buildLokyEmailHtml({ subject, body, lead = {} } = {}) {
  const b = LOKY_BRAND;
  const bannerUrl = inventoryBannerUrl();
  const screenIcon = ctaIconUrl();
  const waIcon = whatsappIconUrl();
  const waUrl = whatsappChatUrl(lead);
  const blocks = paragraphsFromBody(body)
    .map(
      (p) =>
        `<p style="margin:0 0 18px;font-family:${b.font};font-size:17px;line-height:1.65;color:${b.ink};">${emphasizeBodyHtml(p)}</p>`,
    )
    .join("");

  const company = escapeHtml(lead.company || "your brand");
  const location = escapeHtml(lead.locationHint || "Patna DOOH corridors");

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="x-ua-compatible" content="ie=edge" />
  <title>${escapeHtml(subject || "Loky Media")}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <!--[if mso]>
  <style type="text/css">
    body, table, td, a, p, h1 { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
  <style type="text/css">
    body, table, td, p, a, li, blockquote { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    img { border: 0; line-height: 100%; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    a { text-decoration: none !important; }
    .loky-cta { background-color: #000000 !important; color: ${b.green} !important; text-decoration: none !important; border: 0; }
    .loky-cta:hover { background-color: #111111 !important; color: ${b.green} !important; }
    .loky-wa { background-color: ${b.whatsappGreen} !important; color: #ffffff !important; text-decoration: none !important; border: 0; }
  </style>
</head>
<body style="margin:0;padding:0;background:${b.soft};font-family:${b.font};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${b.soft};padding:24px 12px;font-family:${b.font};">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:${b.paper};border:1px solid ${b.line};border-radius:16px;overflow:hidden;font-family:${b.font};">
          <tr>
            <td
              background="${b.heroBgUrl}"
              bgcolor="#0A0A0A"
              valign="top"
              style="background-color:#0A0A0A;background-image:url('${b.heroBgUrl}');background-size:cover;background-position:center center;background-repeat:no-repeat;padding:0;"
            >
              <!--[if gte mso 9]>
              <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;">
                <v:fill type="frame" src="${b.heroBgUrl}" color="#0A0A0A" />
                <v:textbox style="mso-fit-shape-to-text:true" inset="0,0,0,0">
              <![endif]-->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:linear-gradient(180deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.55) 100%);">
                <tr>
                  <td style="padding:26px 28px 30px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td>
                          <img src="${b.logoUrl}" alt="Loky Media" height="30" style="display:block;height:30px;width:auto;border:0;" />
                        </td>
                        <td align="right">
                          <span style="display:inline-block;background:${b.green};color:#ffffff;font-family:${b.font};font-size:11px;font-weight:600;letter-spacing:0.04em;padding:6px 12px;border-radius:999px;">• Live In Patna</span>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:18px 0 0;font-family:${b.font};font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#FFFFFF;opacity:0.9;">${escapeHtml(b.seasonLabel || "Digital DOOH · Patna")}</p>
                    <h1 style="margin:10px 0 0;font-family:${b.font};font-size:24px;line-height:1.25;color:#FFFFFF;font-weight:700;letter-spacing:-0.02em;">${escapeHtml(b.tagline)}</h1>
                  </td>
                </tr>
              </table>
              <!--[if gte mso 9]>
                </v:textbox>
              </v:rect>
              <![endif]-->
            </td>
          </tr>
          <tr>
            <td style="padding:30px 28px 10px;font-family:${b.font};">
              <p style="margin:0 0 6px;font-family:${b.font};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${b.green};font-weight:700;">Outreach for ${company}</p>
              <p style="margin:0 0 22px;font-family:${b.font};font-size:14px;line-height:1.5;color:${b.muted};">${location}</p>
              ${blocks}
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:6px 0 26px;width:100%;border-collapse:separate;">
                <tr>
                  <td align="center" bgcolor="${b.black}" style="background-color:${b.black};border-radius:12px;mso-padding-alt:14px 20px;">
                    <a
                      class="loky-cta"
                      href="${b.inventoryUrl}"
                      style="display:block;width:100%;box-sizing:border-box;padding:14px 20px;font-family:${b.font};font-size:15px;font-weight:600;line-height:1.4;text-align:center;color:${b.green} !important;text-decoration:none !important;border:0;background-color:${b.black};border-radius:12px;"
                    >
                      <img src="${screenIcon}" width="18" height="18" alt="" style="display:inline-block;width:18px;height:18px;border:0;vertical-align:middle;margin-right:8px;" />
                      <span style="color:${b.green} !important;text-decoration:none !important;vertical-align:middle;">${escapeHtml(b.ctaLabel)}</span>
                    </a>
                  </td>
                </tr>
                <tr>
                  <td height="12" style="height:12px;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td align="center" bgcolor="${b.whatsappGreen}" style="background-color:${b.whatsappGreen};border-radius:12px;mso-padding-alt:14px 20px;">
                    <a
                      class="loky-wa"
                      href="${waUrl}"
                      style="display:block;width:100%;box-sizing:border-box;padding:14px 20px;font-family:${b.font};font-size:15px;font-weight:600;line-height:1.4;text-align:center;color:#ffffff !important;text-decoration:none !important;border:0;background-color:${b.whatsappGreen};border-radius:12px;"
                    >
                      <img src="${waIcon}" width="18" height="18" alt="" style="display:inline-block;width:18px;height:18px;border:0;vertical-align:middle;margin-right:8px;" />
                      <span style="color:#ffffff !important;text-decoration:none !important;vertical-align:middle;">${escapeHtml(b.whatsappCtaLabel)}</span>
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 22px;font-family:${b.font};font-size:13px;line-height:1.5;color:${b.muted};">
                Prefer a quick chat? WhatsApp
                <a href="${waUrl}" style="color:${b.whatsappGreen};font-weight:600;text-decoration:none !important;">${escapeHtml(b.supportPhone)}</a>
                for Durga Puja slot queries.
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${b.soft};border:1px solid ${b.line};border-radius:12px;margin:0 0 22px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <p style="margin:0 0 8px;font-family:${b.font};font-size:14px;font-weight:600;color:${b.ink};">Why Loky for ${company} this Durga Puja</p>
                    <p style="margin:0;font-family:${b.font};font-size:14px;line-height:1.55;color:${b.muted};">${escapeHtml(b.whyLine)}</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 4px;font-family:${b.font};font-size:15px;color:${b.ink};font-weight:600;">${escapeHtml(b.founder)}</p>
              <p style="margin:0 0 22px;font-family:${b.font};font-size:14px;color:${b.muted};">${escapeHtml(b.founderTitle)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0;line-height:0;font-size:0;">
              <a href="${b.inventoryUrl}" target="_blank" style="display:block;text-decoration:none !important;">
                <img
                  src="${bannerUrl}"
                  alt="Loky Media — Your brand on big screens in the right places. Explore inventory at lokymedia.com/product/list"
                  width="600"
                  style="display:block;width:100%;max-width:600px;height:auto;border:0;margin:0;padding:0;"
                />
              </a>
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid ${b.line};padding:16px 28px 22px;background:#fafafa;font-family:${b.font};">
              <p style="margin:0 0 6px;font-family:${b.font};font-size:12px;color:${b.muted};">
                <a href="${b.siteUrl}" style="color:${b.green};text-decoration:none !important;font-weight:600;">lokymedia.com</a>
                · ${escapeHtml(b.supportEmail)}
                · <a href="${waUrl}" style="color:${b.whatsappGreen};text-decoration:none !important;font-weight:600;">WhatsApp ${escapeHtml(b.supportPhone)}</a>
              </p>
              <p style="margin:0;font-family:${b.font};font-size:11px;color:#9CA3AF;">Patna office: Bailey Rd, Rukanpura · Screens across Fraser Road, Junction, Danapur &amp; Rukanpura corridors</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Plain WhatsApp text — same pitch facts, no HTML. */
export function buildWhatsAppText({ body, lead = {} } = {}) {
  const b = LOKY_BRAND;
  const pitch = String(body || "").trim();
  return `${pitch}

— ${b.founder}, ${b.founderTitle}
${b.tagline}
Browse screens: ${b.inventoryUrl}
${b.supportPhone}`;
}
