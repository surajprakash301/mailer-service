const statsEl = document.getElementById("stats");
const leadsEl = document.getElementById("leads");
const metaEl = document.getElementById("meta");
const form = document.getElementById("lead-form");
const researchForm = document.getElementById("research-form");
const preview = document.getElementById("preview");
const logEl = document.getElementById("log");

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function stat(label, value) {
  return `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`;
}

function fillForm(lead) {
  if (!lead) return;
  for (const name of [
    "company",
    "contactName",
    "email",
    "title",
    "industry",
    "locationHint",
    "website",
    "notes",
  ]) {
    if (form.elements[name] && lead[name] !== undefined) {
      form.elements[name].value = lead[name] || "";
    }
  }
}

function renderLog(title, steps) {
  logEl.innerHTML = `<h2>${title}</h2><ol>${(steps || [])
    .map(
      (s) =>
        `<li class="${s.ok ? "ok" : "fail"}"><strong>${escapeHtml(s.name)}</strong> — ${escapeHtml(s.detail || "")}</li>`,
    )
    .join("")}</ol>`;
}

async function refresh() {
  const [{ leads }, stats, health] = await Promise.all([
    api("/leads"),
    api("/stats"),
    api("/health"),
  ]);

  const ai = health.liveOpenAI ? health.model : "template draft";
  metaEl.textContent = `${health.cron} · ${health.timezone} · ${health.dryRun ? "DRY RUN" : "LIVE"} · ${ai}`;
  statsEl.innerHTML = [
    stat("Leads", stats.total),
    stat("Pending", stats.pending),
    stat("Ready", stats.ready),
    stat("Sent", stats.sent),
    stat("Failed", stats.failed),
    stat("Left today", stats.remainingToday),
  ].join("");

  leadsEl.innerHTML =
    leads
      .slice()
      .reverse()
      .map(
        (lead) => `
      <article>
        <div class="row">
          <div>
            <strong>${escapeHtml(lead.company || lead.email)}</strong>
            <div>${escapeHtml(lead.contactName)} · ${escapeHtml(lead.email)}</div>
            <div class="words">${escapeHtml(lead.emailSource || "")} ${escapeHtml(lead.locationHint || "")}</div>
          </div>
          <span class="status">${escapeHtml(lead.status)}</span>
        </div>
        <div class="actions">
          <button type="button" data-act="generate" data-id="${lead.id}">Generate</button>
          <button type="button" class="ghost" data-act="preview" data-id="${lead.id}">Preview</button>
          <button type="button" class="ghost" data-act="send" data-id="${lead.id}">Send</button>
          <button type="button" class="ghost" data-act="delete" data-id="${lead.id}">Delete</button>
        </div>
      </article>`,
      )
      .join("") || "<p>No leads yet.</p>";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    await api("/leads", { method: "POST", body: JSON.stringify(data) });
    form.reset();
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

async function runResearch({ fillOnly }) {
  const query = researchForm.elements.query.value.trim();
  const discover = researchForm.elements.discover.checked;
  const button = document.getElementById("run-research");
  button.disabled = true;
  logEl.innerHTML = "<p>Researching public sources…</p>";
  try {
    if (fillOnly) {
      const { research } = await api("/research", {
        method: "POST",
        body: JSON.stringify({ query }),
      });
      fillForm(research.lead);
      renderLog("Research", [
        { name: "research", ok: true, detail: research.summary },
        { name: "email", ok: true, detail: `${research.lead.emailSource}: ${research.lead.email}` },
      ]);
    } else if (discover) {
      const { results } = await api("/pipeline/discover", {
        method: "POST",
        body: JSON.stringify({ query, limit: 3 }),
      });
      const first = results.find((r) => r.ok)?.lead;
      fillForm(first);
      renderLog(
        "Discover",
        results.flatMap((r) =>
          r.ok
            ? r.steps.map((s) => ({ ...s, detail: `${r.company}: ${s.detail}` }))
            : [{ name: r.company, ok: false, detail: r.error }],
        ),
      );
    } else {
      const result = await api("/pipeline/run", {
        method: "POST",
        body: JSON.stringify({ query }),
      });
      fillForm(result.lead);
      renderLog("Pipeline", result.steps);
    }
    await refresh();
  } catch (err) {
    renderLog("Failed", [{ name: "error", ok: false, detail: err.message }]);
    alert(err.message);
  } finally {
    button.disabled = false;
  }
}

researchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await runResearch({ fillOnly: false });
});

document.getElementById("fill-only").addEventListener("click", async () => {
  if (!researchForm.elements.query.value.trim()) {
    researchForm.elements.query.reportValidity();
    return;
  }
  await runResearch({ fillOnly: true });
});

leadsEl.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const { act, id } = button.dataset;
  try {
    if (act === "generate") {
      button.disabled = true;
      await api(`/leads/${id}/generate`, { method: "POST", body: "{}" });
      await refresh();
    }
    if (act === "send") {
      if (!confirm("Send this email? In dry-run it will be marked sent without Resend.")) return;
      await api(`/leads/${id}/send`, { method: "POST", body: "{}" });
      await refresh();
    }
    if (act === "delete") {
      if (!confirm("Delete this lead?")) return;
      await api(`/leads/${id}`, { method: "DELETE" });
      await refresh();
    }
    if (act === "preview") {
      const { lead } = await api(`/leads/${id}`);
      fillForm(lead);
      document.getElementById("preview-title").textContent = lead.company || lead.email;
      document.getElementById("preview-subject").textContent = lead.subject || "(not generated)";
      document.getElementById("preview-body").textContent = lead.body || "";
      document.getElementById("preview-words").textContent = lead.wordCount
        ? `${lead.wordCount} words`
        : "";
      preview.showModal();
    }
  } catch (err) {
    alert(err.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById("run-campaign").addEventListener("click", async () => {
  if (!confirm("Generate missing copy and mock-send up to the daily cap?")) return;
  try {
    const { report } = await api("/campaigns/run", { method: "POST", body: "{}" });
    alert(JSON.stringify(report, null, 2));
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

refresh().catch((err) => {
  metaEl.textContent = err.message;
});
