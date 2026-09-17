export const RESEARCH_PROMPT = `You extract B2B outreach fields for Loky Media (Patna DOOH).

From search snippets and page text, fill a lead record. Only use facts present in the sources.
Never invent a personal Gmail/Yahoo/Outlook address. If no public business email appears, leave email empty.
Prefer owner, GM, marketing head, or "Showroom Manager" as title when the person is unnamed.
locationHint should relate to Patna corridors: Dakbangla Chauraha, Boring Road, Rukanpura Jagdeo Path, Mithapur Bypass.

Return JSON:
{
  "company": "",
  "contactName": "",
  "title": "",
  "industry": "",
  "locationHint": "",
  "website": "",
  "email": "",
  "notes": "2-4 sentences: what they sell, why Durga Puja / festive roadside LED in Patna is relevant, any launch or location detail"
}`;

function greetingName(contactName) {
  const parts = String(contactName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "there";
  if (/^(showroom|sales|marketing|general|front|public|hospital|team|medical|branch|center|centre|store|retail|unit|administrative|admissions|reservations)$/i.test(parts[0])) {
    return "there";
  }
  return parts[0];
}

export function templatePitch(lead) {
  const first = greetingName(lead.contactName);
  const company = lead.company || "your team";
  const where = lead.locationHint || "Dakbangla Chauraha (2 screens), Boring Road (3 screens), Rukanpura Jagdeo Path, Mithapur Bypass";
  const subject = `${company}: Durga Puja LED visibility in Patna`;
  const body = `Hi ${first},

Durga Puja is coming — and Patna will be full of movement and attention.

Suraj Prakash here, founder of Loky Media. We run digital LED screens on ${where}.

For ${company}, a 20 seconds / 30 seconds HD festive spot on a 2-4.5 minute loop gives 450+ daily impressions while Puja footfall peaks. We also create the video creative in-house.

Want to see where your brand can appear? I can send a free sample of your brand on one of our screens, or WhatsApp me for Durga Puja packages.

Suraj Prakash
Founder, Loky Media`;
  return { subject, body };
}
