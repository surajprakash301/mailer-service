const statsEl = document.getElementById("stats");
const cronBarEl = document.getElementById("cron-bar");
const leadsEl = document.getElementById("leads");
const metaEl = document.getElementById("meta");
const listCountEl = document.getElementById("list-count");
const searchEl = document.getElementById("search");
const dateFieldEl = document.getElementById("date-field");
const dateFromEl = document.getElementById("date-from");
const dateToEl = document.getElementById("date-to");

const CRON_CONSOLE_URL = "https://console.cron-job.org/jobs";
const TZ = "Asia/Kolkata";

let allLeads = [];
let filter = "all";
let industryFilter = "all";
let selectedId = null;
let showPlain = false;
let emailUrl = "";

const FOCUS_INDUSTRIES = [
  "Real Estate",
  "Healthcare",
  "Startups",
  "FMCG",
  "Jewellery",
  "Automobile",
  "Fashion",
];

const industryFiltersEl = document.getElementById("industry-filters");

async function api(path) {
  const res = await fetch(`/api${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatWhen(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: TZ,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return String(iso).slice(0, 16);
  }
}

function istDateKey(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return String(iso).slice(0, 10);
  }
}

function todayIstKey() {
  return istDateKey(new Date().toISOString());
}

function shiftIstKey(days) {
  const base = new Date(`${todayIstKey()}T12:00:00+05:30`);
  base.setDate(base.getDate() + days);
  return istDateKey(base.toISOString());
}

function leadDateIso(lead) {
  const field = dateFieldEl.value;
  if (field === "sent") return lead.sentAt || "";
  if (field === "followed") return lead.followedAt || lead.generatedAt || lead.updatedAt || "";
  if (field === "updated") return lead.updatedAt || lead.createdAt || "";
  return lead.createdAt || lead.updatedAt || "";
}

function isMock(lead) {
  return (
    lead.emailSource === "mock" ||
    String(lead.email || "").toLowerCase().endsWith("@loky-mock.test")
  );
}

function isPublic(lead) {
  return lead.emailSource === "public" && !isMock(lead);
}

function isToBeSent(lead) {
  const status = lead.displayStatus || lead.status;
  if (status === "to_send") return true;
  return status === "ready" && isPublic(lead) && Boolean(lead.body);
}

function statusLabel(lead) {
  if (isToBeSent(lead)) return "to be sent";
  if (lead.status === "ready") return "awaiting email";
  return lead.status || "—";
}

function statusClass(lead) {
  if (isToBeSent(lead)) return "to_send";
  return lead.status || "";
}

function normalizeIndustry(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Other";
  const lower = raw.toLowerCase();
  if (/real\s*estate|property|housing|developer/.test(lower)) return "Real Estate";
  if (/health|hospital|clinic|pharma/.test(lower)) return "Healthcare";
  if (/start\s*up|startup|consumer app/.test(lower)) return "Startups";
  if (/fmcg|fast.?moving/.test(lower)) return "FMCG";
  if (/jewel|gold|diamond/.test(lower)) return "Jewellery";
  if (/auto|car|bike|vehicle|dealer/.test(lower)) return "Automobile";
  if (/fashion|apparel|ethnic|boutique|garment/.test(lower)) return "Fashion";
  return raw;
}

function matchesFilter(lead) {
  if (filter === "all") return true;
  if (filter === "to_send") return isToBeSent(lead);
  if (filter === "gathered") return lead.status !== "sent";
  if (filter === "sent") return lead.status === "sent";
  if (filter === "ready") return lead.status === "ready" && !isToBeSent(lead);
  if (filter === "failed") return lead.status === "failed";
  if (filter === "public") return isPublic(lead);
  return true;
}

function matchesIndustry(lead) {
  if (industryFilter === "all") return true;
  return normalizeIndustry(lead.industry) === industryFilter;
}

function matchesDate(lead) {
  const from = dateFromEl.value;
  const to = dateToEl.value;
  if (!from && !to) return true;
  const key = istDateKey(leadDateIso(lead));
  if (!key) return false;
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

function matchesSearch(lead, q) {
  if (!q) return true;
  const hay = [
    lead.company,
    lead.contactName,
    lead.email,
    lead.phone,
    lead.title,
    lead.industry,
    lead.locationHint,
    lead.website,
    lead.nearestScreen,
    lead.buySignals,
    lead.notes,
    lead.subject,
    lead.status,
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function stat(label, value, tone = "") {
  return `<div class="stat"${tone ? ` data-tone="${tone}"` : ""}><span>${label}</span><strong>${value}</strong></div>`;
}

function filteredLeads() {
  const q = searchEl.value.trim().toLowerCase();
  return allLeads
    .filter(matchesFilter)
    .filter(matchesIndustry)
    .filter(matchesDate)
    .filter((lead) => matchesSearch(lead, q))
    .slice()
    .sort((a, b) => {
      const aTime = Date.parse(leadDateIso(a) || a.updatedAt || 0) || 0;
      const bTime = Date.parse(leadDateIso(b) || b.updatedAt || 0) || 0;
      return bTime - aTime;
    });
}

function renderIndustryFilters() {
  const present = new Set(allLeads.map((l) => normalizeIndustry(l.industry)));
  const labels = [
    ...FOCUS_INDUSTRIES,
    ...[...present].filter((i) => i && i !== "Other" && !FOCUS_INDUSTRIES.includes(i)).sort(),
  ];
  industryFiltersEl.innerHTML = [
    `<button type="button" class="filter industry-chip${industryFilter === "all" ? " is-active" : ""}" data-industry="all">All industries</button>`,
    ...labels.map(
      (label) =>
        `<button type="button" class="filter industry-chip${
          industryFilter === label ? " is-active" : ""
        }" data-industry="${escapeHtml(label)}">${escapeHtml(label)}</button>`,
    ),
  ].join("");
}

function renderCronBar(health) {
  const runs = health.lastCronRuns || {};
  const gather = runs.gather || runs.morningGather || null;
  const send = runs.send || runs.campaign || null;
  const pills = [];
  if (gather?.at || gather?.finishedAt) {
    pills.push(
      `<span class="cron-pill">Last gather <strong>${escapeHtml(formatWhen(gather.at || gather.finishedAt))}</strong>${
        gather.summary?.added != null ? ` · +${escapeHtml(gather.summary.added)}` : ""
      }</span>`,
    );
  }
  if (send?.at || send?.finishedAt) {
    pills.push(
      `<span class="cron-pill">Last send <strong>${escapeHtml(formatWhen(send.at || send.finishedAt))}</strong>${
        send.summary?.sent != null ? ` · ${escapeHtml(send.summary.sent)} mailed` : ""
      }</span>`,
    );
  }
  cronBarEl.innerHTML = `
    <a class="cron-link" href="${CRON_CONSOLE_URL}" target="_blank" rel="noopener noreferrer">
      cron-job.org console ↗
    </a>
    <div class="cron-runs">${pills.join("") || `<span class="cron-pill">No cron run history yet</span>`}</div>
  `;
}

function renderStats(stats, health) {
  const mode = health.dryRun ? "DRY RUN" : "LIVE";
  const ai = health.liveGemini || health.liveOpenAI ? health.model : "template";
  metaEl.textContent = `${health.storage || "store"} · ${mode} · ${ai} · ${health.timezone || TZ}`;
  statsEl.innerHTML = [
    stat("Total", stats.total),
    stat("To be sent", stats.toSend ?? 0, "coral"),
    stat("Gathered", stats.gathered ?? stats.ready + stats.pending),
    stat("Awaiting email", stats.ready),
    stat("Sent", stats.sent, "sent"),
    stat("Drafted", stats.drafted ?? "—"),
    stat("Sent today", stats.sentToday),
    stat("Left today", stats.remainingToday),
  ].join("");
  renderCronBar(health);
}

function formatPhone(phone) {
  const raw = String(phone || "").trim();
  if (!raw) return "";
  return raw.startsWith("+") || raw.startsWith("0") ? raw : `+${raw}`;
}

function whatsappLabel(wa) {
  if (!wa || typeof wa !== "object") return "";
  if (wa.status === "sent") return "WhatsApp sent";
  if (wa.status === "mock_sent") return "WhatsApp dry-run";
  if (wa.status === "skipped") return "WhatsApp skipped";
  if (wa.onWhatsApp) return "On WhatsApp";
  if (wa.canMessage) return "WhatsApp ok";
  return "";
}

function leadDetailsMarkup(lead) {
  const phone = formatPhone(lead.phone);
  const wa = whatsappLabel(lead.whatsapp);
  const sources = Array.isArray(lead.sources) ? lead.sources.filter(Boolean) : [];
  const rows = [
    ["Contact", lead.contactName],
    ["Title", lead.title],
    ["Email", lead.email],
    ["Phone", phone],
    ["Website", lead.website],
    ["Industry", lead.industry],
    ["Location", lead.locationHint],
    ["Nearest screen", lead.nearestScreen],
    ["Priority", lead.priority],
    ["Confidence", lead.confidence == null || lead.confidence === "" ? "" : String(lead.confidence)],
    ["Buy signals", lead.buySignals],
    ["Notes", lead.notes],
    ["Query wave", lead.queryWave],
    ["Research query", lead.researchQuery],
    ["Email source", lead.emailSource],
    ["Operator", lead.operator],
    ["Network", lead.network],
    ["Word count", lead.wordCount ? String(lead.wordCount) : ""],
    ["Last error", lead.lastError],
    ["WhatsApp", wa || (lead.whatsapp?.e164 ? lead.whatsapp.e164 : "")],
  ].filter(([, value]) => value);

  const rowHtml = rows
    .map(([label, value]) => {
      let display = escapeHtml(value);
      if (label === "Phone" && phone) {
        display = `<a href="tel:${escapeHtml(phone)}" data-act="external">${escapeHtml(phone)}</a>`;
      } else if (label === "Email" && lead.email) {
        display = `<a href="mailto:${escapeHtml(lead.email)}" data-act="external">${escapeHtml(lead.email)}</a>`;
      } else if (label === "Website" && lead.website) {
        const href = /^https?:\/\//i.test(lead.website) ? lead.website : `https://${lead.website}`;
        display = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" data-act="external">${escapeHtml(lead.website)}</a>`;
      }
      return `<div class="detail-row"><span>${escapeHtml(label)}</span><strong>${display}</strong></div>`;
    })
    .join("");

  const sourceHtml = sources.length
    ? `<div class="detail-row detail-sources"><span>Sources</span><strong>${sources
        .map((s) => {
          const href = /^https?:\/\//i.test(s) ? s : "";
          return href
            ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" data-act="external">${escapeHtml(s)}</a>`
            : escapeHtml(s);
        })
        .join("<br>")}</strong></div>`
    : "";

  return `<div class="lead-details">${rowHtml}${sourceHtml}</div>`;
}

function previewMarkup(lead) {
  const phone = formatPhone(lead.phone);
  const followedLine = lead.followedAt || lead.generatedAt
    ? `Followed ${formatWhen(lead.followedAt || lead.generatedAt)}`
    : "";
  const addedLine = lead.createdAt ? `Added ${formatWhen(lead.createdAt)}` : "";
  const statusLine =
    lead.status === "sent"
      ? `Sent ${formatWhen(lead.sentAt) || ""}`.trim()
      : isToBeSent(lead)
        ? "To be sent"
        : `Status · ${statusLabel(lead)}`;
  const meta = [statusLine, followedLine, addedLine].filter(Boolean).join(" · ");
  const plainHidden = showPlain ? "" : " is-hidden";
  const frameHidden = showPlain ? " is-hidden" : "";
  const toggleLabel = showPlain ? "HTML view" : "Plain text";
  const contactBits = [
    lead.contactName || "Contact",
    lead.email || "—",
    phone || null,
  ].filter(Boolean);

  return `
    <div class="inline-preview" data-preview-for="${escapeHtml(lead.id)}" aria-live="polite">
      <div class="preview-meta">
        <div>
          <p class="eyebrow">${escapeHtml(meta)}</p>
          <h3>${escapeHtml(lead.company || lead.email || "Lead")}</h3>
          <p class="preview-to">${escapeHtml(contactBits.join(" · "))}</p>
        </div>
        <div class="preview-actions">
          <button type="button" class="ghost" data-act="open-html"${lead.body ? "" : " disabled"}>Open HTML</button>
          <button type="button" class="ghost" data-act="toggle-text">${toggleLabel}</button>
          <button type="button" class="ghost" data-act="close-preview">Close</button>
        </div>
      </div>
      ${leadDetailsMarkup(lead)}
      <p class="subject-line"><span>Subject</span> <strong>${escapeHtml(lead.subject || "(no subject yet)")}</strong></p>
      <div class="frame-wrap">
        <iframe class="email-frame${frameHidden}" title="Email HTML preview" sandbox="allow-same-origin allow-popups"></iframe>
        <pre class="plain${plainHidden}"></pre>
      </div>
    </div>`;
}

function hydrateInlinePreview(lead) {
  const panel = [...leadsEl.querySelectorAll("[data-preview-for]")].find(
    (el) => el.getAttribute("data-preview-for") === lead.id,
  );
  if (!panel) return;
  const frame = panel.querySelector(".email-frame");
  const plain = panel.querySelector(".plain");
  plain.textContent = lead.body || "(No drafted body yet — generate copy first.)";

  emailUrl = lead.body ? `/api/leads/${encodeURIComponent(lead.id)}/email` : "";
  if (!lead.body) {
    frame.removeAttribute("src");
    frame.srcdoc = `<p style="font-family:sans-serif;padding:24px;color:#4b5563">No drafted email for this lead yet.</p>`;
  } else {
    frame.removeAttribute("srcdoc");
    frame.src = emailUrl;
  }

  requestAnimationFrame(() => {
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

function renderList() {
  const leads = filteredLeads();
  listCountEl.textContent = String(leads.length);
  if (!leads.length) {
    leadsEl.innerHTML = `<div class="empty"><p>No leads match this filter${
      dateFromEl.value || dateToEl.value ? " / date range" : ""
    }.</p></div>`;
    return;
  }

  leadsEl.innerHTML = leads
    .map((lead) => {
      const added = formatWhen(lead.createdAt || lead.updatedAt);
      const followed = formatWhen(lead.followedAt || lead.generatedAt);
      const sent = formatWhen(lead.sentAt);
      const phone = formatPhone(lead.phone);
      const wa = whatsappLabel(lead.whatsapp);
      const sourceChip = isPublic(lead)
        ? `<span class="chip public">public</span>`
        : isMock(lead)
          ? `<span class="chip mock">mock</span>`
          : "";
      const drafted = lead.body ? `<span class="chip">drafted</span>` : `<span class="chip">no draft</span>`;
      const selected = lead.id === selectedId;
      const label = statusLabel(lead);
      const klass = statusClass(lead);
      const titleBit = lead.title ? ` · ${escapeHtml(lead.title)}` : "";
      const metaBits = [
        lead.industry || null,
        lead.locationHint || null,
        lead.nearestScreen ? `Screen: ${lead.nearestScreen}` : null,
        lead.priority || null,
      ].filter(Boolean);
      return `
        <article class="lead-block${selected ? " is-open" : ""}" data-lead-id="${escapeHtml(lead.id)}">
          <button type="button" class="lead${selected ? " is-selected" : ""}" data-id="${escapeHtml(lead.id)}" aria-expanded="${selected ? "true" : "false"}">
            <div class="lead-top">
              <div class="lead-company">${escapeHtml(lead.company || lead.email || "Untitled")}</div>
              <span class="badge ${escapeHtml(klass)}">${escapeHtml(label)}</span>
            </div>
            <div class="lead-sub">${escapeHtml(lead.contactName || "—")}${titleBit}</div>
            <div class="lead-sub lead-contacts">
              <span>${escapeHtml(lead.email || "no email")}</span>
              <span class="${phone ? "has-phone" : "no-phone"}">${phone ? escapeHtml(phone) : "no phone"}</span>
              ${lead.website ? `<span class="lead-site">${escapeHtml(lead.website.replace(/^https?:\/\//i, ""))}</span>` : ""}
            </div>
            ${metaBits.length ? `<div class="lead-sub">${escapeHtml(metaBits.join(" · "))}</div>` : ""}
            ${lead.buySignals ? `<div class="lead-sub lead-signals">${escapeHtml(lead.buySignals)}</div>` : ""}
            <div class="chips">
              ${sourceChip}
              ${drafted}
              ${phone ? `<span class="chip phone">Phone</span>` : ""}
              ${wa ? `<span class="chip public">${escapeHtml(wa)}</span>` : ""}
              ${lead.wordCount ? `<span class="chip">${escapeHtml(String(lead.wordCount))} words</span>` : ""}
              ${added ? `<span class="chip">Added ${escapeHtml(added)} IST</span>` : ""}
              ${isToBeSent(lead) && followed ? `<span class="chip">Followed ${escapeHtml(followed)} IST</span>` : ""}
              ${sent ? `<span class="chip public">Sent ${escapeHtml(sent)} IST</span>` : ""}
            </div>
          </button>
          ${selected ? previewMarkup(lead) : ""}
        </article>`;
    })
    .join("");

  if (selectedId) {
    const lead = allLeads.find((item) => item.id === selectedId);
    if (lead) hydrateInlinePreview(lead);
  }
}

function selectLead(id) {
  selectedId = selectedId === id ? null : id;
  renderList();
}

function applyPreset(preset) {
  if (preset === "clear") {
    dateFromEl.value = "";
    dateToEl.value = "";
  } else if (preset === "today") {
    const t = todayIstKey();
    dateFromEl.value = t;
    dateToEl.value = t;
  } else if (preset === "yesterday") {
    const y = shiftIstKey(-1);
    dateFromEl.value = y;
    dateToEl.value = y;
  } else if (preset === "7d") {
    dateFromEl.value = shiftIstKey(-6);
    dateToEl.value = todayIstKey();
  }
  renderList();
}

async function refresh() {
  const [{ leads }, stats, health] = await Promise.all([
    api("/leads"),
    api("/stats"),
    api("/health"),
  ]);
  allLeads = leads || [];
  renderStats(stats, health);
  renderIndustryFilters();
  renderList();
}

document.querySelector(".filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  filter = button.dataset.filter;
  for (const el of document.querySelectorAll(".filters > .filter")) {
    const active = el === button;
    el.classList.toggle("is-active", active);
    el.setAttribute("aria-selected", active ? "true" : "false");
  }
  renderList();
});

industryFiltersEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-industry]");
  if (!button) return;
  industryFilter = button.dataset.industry || "all";
  renderIndustryFilters();
  renderList();
});

document.querySelector(".date-presets").addEventListener("click", (event) => {
  const button = event.target.closest("[data-preset]");
  if (!button) return;
  applyPreset(button.dataset.preset);
});

for (const el of [searchEl, dateFieldEl, dateFromEl, dateToEl]) {
  el.addEventListener("input", () => renderList());
  el.addEventListener("change", () => renderList());
}

leadsEl.addEventListener("click", (event) => {
  const actionBtn = event.target.closest("[data-act]");
  if (actionBtn) {
    const act = actionBtn.dataset.act;
    if (act === "external") {
      event.stopPropagation();
      return;
    }
    if (act === "open-html") {
      if (emailUrl) window.open(emailUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (act === "toggle-text") {
      showPlain = !showPlain;
      renderList();
      return;
    }
    if (act === "close-preview") {
      selectedId = null;
      renderList();
      return;
    }
  }

  const button = event.target.closest(".lead");
  if (!button) return;
  selectLead(button.dataset.id);
});

refresh().catch((err) => {
  metaEl.textContent = err.message;
  leadsEl.innerHTML = `<div class="empty"><p>${escapeHtml(err.message)}</p></div>`;
  cronBarEl.innerHTML = `<a class="cron-link" href="${CRON_CONSOLE_URL}" target="_blank" rel="noopener noreferrer">cron-job.org console ↗</a>`;
});
