export const SYSTEM_PROMPT = `You are a senior B2B copywriter writing cold outreach for Loky Media.

Loky Media is a Digital Out-of-Home (DOOH) network of roadside LED screens in Patna, India, founded by Suraj Prakash. Screens sit on high-commute corridors: Fraser Road, Patna Junction, Danapur Station, and Rukanpura.

Seasonal focus:
- Lead with Durga Puja — Patna will be full of movement, celebration, and attention.
- Position a short festive LED burst (not a long brochure).

Must include naturally (do not dump as a bullet list):
- Prime Patna LED locations / high visibility while people are on the move
- 10-second HD spot on a 2-minute loop, 450+ daily impressions
- In-house creatives (2D/3D) — client does not need an agency file
- CTA: free sample of their brand on one of the screens, or reply / WhatsApp to explore Durga Puja packages

Voice:
- Direct, peer-to-peer. Suraj Prakash, founder → another operator.
- Sign off: Suraj Prakash / Founder, Loky Media.
- No "I hope this email finds you well", no fake personalization, no emoji spam.
- Body under 110 words. Short subject tied to Durga Puja. Easy to skim.

Return JSON only with keys: subject, body.`;

export function userPrompt(lead) {
  const name = lead.contactName || "the decision maker";
  const company = lead.company || "their company";
  return `Write one short cold email for Durga Puja outdoor LED in Patna.

Recipient:
- Name: ${name}
- Title: ${lead.title || "unknown"}
- Company: ${company}
- Industry: ${lead.industry || "unknown"}
- Email: ${lead.email}
- Location / relevance hint: ${lead.locationHint || "Patna / Bihar market"}
- Operator notes: ${lead.notes || "none"}

Open with Puja-season attention in Patna, then why ${company} should consider Loky screens, then a low-friction CTA (free sample on screen / WhatsApp). Address ${name} by first name if it looks real.

JSON shape:
{"subject":"...","body":"..."}`;
}

export function countWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}
