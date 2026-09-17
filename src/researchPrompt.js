export const RESEARCH_PROMPT = `You extract B2B outreach fields for Loky Media (Patna DOOH).

From search snippets and page text, fill a lead record. Only use facts present in the sources.
Never invent a personal Gmail/Yahoo/Outlook address. If no public business email appears, leave email empty.
Prefer owner, GM, marketing head, or "Showroom Manager" as title when the person is unnamed.
locationHint should relate to Patna corridors: Fraser Road, Patna Junction, Danapur Station, Rukanpura.

Return JSON:
{
  "company": "",
  "contactName": "",
  "title": "",
  "industry": "",
  "locationHint": "",
  "website": "",
  "email": "",
  "notes": "2-4 sentences: what they sell, why roadside LED in Patna commuter traffic is relevant, any launch or location detail"
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
  const where = lead.locationHint || "Fraser Road / Patna Junction / Danapur Station / Rukanpura";
  const subject = `${company}: 10-second mock-up on Patna roadside LED`;
  const body = `Hi ${first},

Suraj Prakash here, founder of Loky Media. We run roadside LED screens on ${where}.

For ${company}, a 10-second HD spot on a 2-minute loop gives 450+ daily impressions among commuters you already want. We make the 2D/3D motion in-house, so you do not need an agency or a production file.

If useful, I will send a free 10-second animated mock-up of your brand on one of the screens. Worth a look?

Suraj Prakash
Loky Media`;
  return { subject, body };
}
