import {
  isDecisionMakerEmail,
  isDeliverableEmail,
  isGenericMailbox,
  normalizePhone,
  rankEmailForOutreach,
} from "./emailUtils.js";

/** Roles we want on the company roster for outreach. */
export const OUTREACH_ROLE_BUCKETS = ["founder", "ceo", "marketing", "sales", "managing"];

const ROLE_PATTERNS = [
  { bucket: "founder", re: /founder|co[-\s]?founder|proprietor|owner/i },
  { bucket: "ceo", re: /\bceo\b|chief executive|managing director|\bmd\b|chairman|president/i },
  { bucket: "marketing", re: /marketing|brand|cmo|growth|communications|pr\b|advertis/i },
  { bucket: "sales", re: /sales|business development|\bbd\b|\bbdm\b|commercial/i },
  { bucket: "managing", re: /director|general manager|\bgm\b|head of|vice president|\bvp\b|partner/i },
];

export function inferRoleBucket({ title = "", email = "", name = "" } = {}) {
  const hay = `${title} ${name} ${String(email).split("@")[0] || ""}`;
  for (const row of ROLE_PATTERNS) {
    if (row.re.test(hay)) return row.bucket;
  }
  if (isDecisionMakerEmail(email)) return "managing";
  return "other";
}

export function normalizeEmployee(raw = {}) {
  const source = String(raw.source || "research").trim() || "research";
  const name = String(raw.name || raw.contactName || "").trim();
  const title = String(raw.title || raw.designation || "").trim();
  const email = String(raw.email || "")
    .trim()
    .toLowerCase();
  const phone = normalizePhone(raw.phone || "") || "";
  if (!email && !phone && !name) return null;

  const manual = source === "manual";
  if (!manual && email && isGenericMailbox(email)) return null;
  if (email && !isDeliverableEmail(email) && !phone && !manual) return null;
  if (email && !isDeliverableEmail(email) && !manual) {
    // drop invalid research emails; keep phone/name-only rows
  }

  const roleBucket = String(raw.roleBucket || raw.role || "").trim().toLowerCase()
    || inferRoleBucket({ title, email, name });

  const validEmail =
    email && (manual ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) : isDeliverableEmail(email))
      ? email
      : "";

  return {
    id: String(raw.id || `${validEmail || phone || name}-${title}`).slice(0, 120),
    name,
    title: title || (roleBucket !== "other" ? roleBucket : ""),
    email: validEmail,
    phone,
    roleBucket: OUTREACH_ROLE_BUCKETS.includes(roleBucket) ? roleBucket : roleBucket || "other",
    source,
  };
}

export function isOutreachEmployee(emp) {
  if (!emp) return false;
  if (emp.email && isGenericMailbox(emp.email)) return false;
  if (OUTREACH_ROLE_BUCKETS.includes(emp.roleBucket)) return true;
  if (emp.email && isDecisionMakerEmail(emp.email)) return true;
  return false;
}

/** Merge + dedupe by email (preferred) or name+title. Keep richest fields. */
export function mergeEmployees(existing = [], incoming = []) {
  const map = new Map();
  const keyOf = (e) => {
    if (e.email) return `e:${e.email}`;
    if (e.phone) return `p:${e.phone}`;
    return `n:${(e.name || "").toLowerCase()}|${(e.title || "").toLowerCase()}`;
  };

  for (const raw of [...(existing || []), ...(incoming || [])]) {
    const emp = normalizeEmployee(raw);
    if (!emp) continue;
    // Manual operator entries always kept; research keeps outreach roles only
    if (emp.source !== "manual" && !isOutreachEmployee(emp)) continue;

    const key = keyOf(emp);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, emp);
      continue;
    }
    map.set(key, {
      ...prev,
      ...emp,
      name: emp.name || prev.name,
      title: emp.title || prev.title,
      email: emp.email || prev.email,
      phone: emp.phone || prev.phone,
      roleBucket:
        emp.roleBucket !== "other" ? emp.roleBucket : prev.roleBucket || emp.roleBucket,
      source: prev.source === "manual" || emp.source === "manual" ? "manual" : emp.source || prev.source,
    });
  }

  return [...map.values()].sort((a, b) => {
    const rank = (e) => {
      const roleRank = { founder: 5, ceo: 4, marketing: 3, managing: 2, sales: 1, other: 0 };
      return (roleRank[e.roleBucket] || 0) * 100 + rankEmailForOutreach(e.email);
    };
    return rank(b) - rank(a);
  });
}

/** Primary contact for email draft/send — marketing > founder > ceo > managing > sales. */
export function pickPrimaryEmployee(employees = []) {
  const list = mergeEmployees(employees, []);
  if (!list.length) return null;
  const order = ["marketing", "founder", "ceo", "managing", "sales"];
  for (const bucket of order) {
    const hit = list.find((e) => e.roleBucket === bucket && e.email && isDecisionMakerEmail(e.email));
    if (hit) return hit;
  }
  return list.find((e) => e.email && isDecisionMakerEmail(e.email)) || list[0] || null;
}

export function employeesFromLeadFields(lead = {}) {
  const fromArray = Array.isArray(lead.employees) ? lead.employees : [];
  const primary = normalizeEmployee({
    name: lead.contactName,
    title: lead.title,
    email: lead.email,
    phone: lead.phone,
    source: "primary",
  });
  return mergeEmployees(primary ? [primary] : [], fromArray);
}

export function applyPrimaryFromEmployees(lead, employees) {
  const primary = pickPrimaryEmployee(employees);
  if (!primary) {
    return { ...lead, employees: employees || [] };
  }
  return {
    ...lead,
    contactName: primary.name || lead.contactName || "",
    title: primary.title || lead.title || "",
    email: primary.email || lead.email || "",
    phone: primary.phone || lead.phone || "",
    emailSource: primary.email ? "public" : lead.emailSource || "",
    employees,
  };
}

export function parseEmployeesField(value) {
  if (Array.isArray(value)) return mergeEmployees(value, []);
  if (value && typeof value === "object") return mergeEmployees([value], []);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return mergeEmployees(Array.isArray(parsed) ? parsed : [], []);
    } catch {
      return [];
    }
  }
  return [];
}
