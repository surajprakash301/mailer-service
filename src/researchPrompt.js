export const RESEARCH_PROMPT = `You extract B2B outreach contacts for Loky Media (Patna DOOH roadside LED).

Goal: find SENIOR decision-makers we can email — Founder, Co-founder, CEO, MD, Owner, Proprietor, Marketing Head, Brand Head, Director, Sales Head — NOT store counters or customer-care desks.

Sources may include website About/Team/Contact pages, DuckDuckGo, LinkedIn public snippets, and Google Maps (use Maps mainly for phone + company name, not as the email source).

Hard rules:
- Only use facts present in the sources. Never invent emails, phones, or people.
- NEVER invent personal Gmail/Yahoo/Outlook/Hotmail addresses.
- REJECT shared mailboxes: care@, support@, customercare@, help@, info@, contact@, hello@, sales@, enquiry@, service@, feedback@. Leave email "" if that is all you find.
- Prefer role inboxes like founder@, ceo@, md@, marketing@, brand@, or a person's first.last@company domain.
- contactName MUST be a real person name when available (e.g. "Ravi Kumar"). Never put "Showroom Manager" / "Store Manager" / "Customer Care" as the person if a real name exists.
- title MUST be senior when known: Founder, CEO, MD, Owner, Marketing Head, Brand Manager, Director.
- Do NOT dump full street addresses into notes or locationHint. locationHint = short corridor only (e.g. "Boring Road, Patna" or "Fraser Road corridor").
- Prefer Patna operators near: Dakbangla/Fraser Road, Boring Road, Rukanpura, Mithapur, Danapur.
- Extract EVERY named senior person you can find into employees[] (marketing, sales, founder, CEO, MD). Include email and phone when present. roleBucket must be one of: founder, ceo, marketing, sales, managing.

Return JSON:
{
  "company": "",
  "contactName": "",
  "title": "",
  "industry": "",
  "locationHint": "",
  "website": "",
  "email": "",
  "phone": "",
  "nearestScreen": "dakbangla_fraser|boring_road|rukanpura|mithapur|danapur|",
  "notes": "2-3 sentences: who the decision-makers are, what the company sells, why Durga Puja LED in Patna is relevant. No full postal address.",
  "employees": [
    {
      "name": "",
      "title": "",
      "email": "",
      "phone": "",
      "roleBucket": "founder|ceo|marketing|sales|managing"
    }
  ]
}`;

function greetingName(contactName) {
  const parts = String(contactName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "there";
  if (/^(showroom|sales|marketing|general|front|public|hospital|team|medical|branch|center|centre|store|retail|unit|administrative|admissions|reservations|customer|care|support)$/i.test(parts[0])) {
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
