/**
 * Loky Media brand tokens pulled from lokymedia.com
 * CTA / live green: rgb(0, 174, 86) → #00AE56
 * Accent coral: rgb(254, 101, 69) → #FE6545
 * Hero: /static/images/hero-bg-mobile.png
 */
export const LOKY_BRAND = {
  name: "Loky Media",
  tagline: "WHERE BRANDS SHINE BRIGHTEST.",
  siteUrl: "https://www.lokymedia.com",
  logoUrl: "https://www.lokymedia.com/static/images/logo.svg",
  heroBgUrl: "https://www.lokymedia.com/static/images/hero-bg-mobile.png",
  supportEmail: "support@lokymedia.com",
  supportPhone: "+91-9123472510",
  coral: "#FE6545",
  green: "#00AE56",
  ink: "#111827",
  muted: "#4B5563",
  line: "#E5E7EB",
  paper: "#FFFFFF",
  soft: "#F8FAFC",
  // Email-safe stack: Inter when web fonts load, then system UI fonts (no nested quotes)
  font: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
  founder: "Suraj Prakash",
  founderTitle: "Founder, Loky Media",
};

export function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
  const blocks = paragraphsFromBody(body)
    .map(
      (p) =>
        `<p style="margin:0 0 18px;font-family:${b.font};font-size:17px;line-height:1.65;color:${b.ink};">${escapeHtml(p).replaceAll("\n", "<br/>")}</p>`,
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
    a { text-decoration: none !important; }
    .loky-cta { background-color: ${b.green} !important; color: #ffffff !important; text-decoration: none !important; border: 0; }
    .loky-cta:hover { background-color: #00964a !important; color: #ffffff !important; }
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
                    <p style="margin:18px 0 0;font-family:${b.font};font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#FFFFFF;opacity:0.9;">Digital DOOH · Patna</p>
                    <h1 style="margin:10px 0 0;font-family:${b.font};font-size:26px;line-height:1.25;color:#FFFFFF;font-weight:700;letter-spacing:-0.02em;">${escapeHtml(b.tagline)}</h1>
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
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:6px 0 26px;border-collapse:separate;">
                <tr>
                  <td align="center" bgcolor="${b.green}" style="background-color:${b.green};border-radius:999px;mso-padding-alt:14px 26px;">
                    <a
                      class="loky-cta"
                      href="${b.siteUrl}/product/list"
                      style="display:inline-block;padding:14px 26px;font-family:${b.font};font-size:15px;font-weight:600;line-height:1;color:#ffffff !important;text-decoration:none !important;border:0;background-color:${b.green};border-radius:999px;"
                    ><span style="color:#ffffff !important;text-decoration:none !important;">Book Your Slot →</span></a>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${b.soft};border:1px solid ${b.line};border-radius:12px;margin:0 0 22px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <p style="margin:0 0 8px;font-family:${b.font};font-size:14px;font-weight:600;color:${b.ink};">Why Loky for ${company}</p>
                    <p style="margin:0;font-family:${b.font};font-size:14px;line-height:1.55;color:${b.muted};">In-house 2D/3D motion · 10s HD on a 2-min loop · 450+ daily impressions · free 10s screen mock-up</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 4px;font-family:${b.font};font-size:15px;color:${b.ink};font-weight:600;">${escapeHtml(b.founder)}</p>
              <p style="margin:0 0 22px;font-family:${b.font};font-size:14px;color:${b.muted};">${escapeHtml(b.founderTitle)}</p>
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid ${b.line};padding:16px 28px 22px;background:#fafafa;font-family:${b.font};">
              <p style="margin:0 0 6px;font-family:${b.font};font-size:12px;color:${b.muted};">
                <a href="${b.siteUrl}" style="color:${b.green};text-decoration:none !important;font-weight:600;">lokymedia.com</a>
                · ${escapeHtml(b.supportEmail)}
                · ${escapeHtml(b.supportPhone)}
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
Browse screens: ${b.siteUrl}/product/list
${b.supportPhone}`;
}
