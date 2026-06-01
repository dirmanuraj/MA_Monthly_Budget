// ---------- State ----------
let DATA = null;
let currentMonth = null;
let editingId = null;
let appPassword = "";
const CAT_COLORS = {
  "Rent & Maintenance": "#6366f1",
  "Groceries & Outside Food": "#22d3ee",
  "Bills & Subscriptions": "#fbbf24",
  "Leisure & Entertainment": "#f472b6",
  "Miscellaneous": "#34d399",
};
let barChart, donutChart;

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const fmt = (n) =>
  (DATA?.currency || "₹") +
  Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const api = (url, opts = {}) =>
  fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-app-password": appPassword, ...(opts.headers || {}) },
  });

function toast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast" + (isError ? " error" : "");
  setTimeout(() => t.classList.add("hidden"), 2600);
  t.classList.remove("hidden");
}

function setSaveStatus(state) {
  const el = $("saveStatus");
  el.className = "save-status" + (state === "saving" ? " saving" : state === "error" ? " error" : "");
  el.textContent = state === "saving" ? "Saving…" : state === "error" ? "Save failed" : "Saved";
}

// ---------- Boot ----------
async function boot() {
  const cfg = await (await fetch("/api/config")).json();
  $("persistenceLabel").textContent =
    cfg.persistence === "github" ? "Synced to GitHub" : "Local storage (configure GitHub to persist)";
  if (cfg.requiresPassword) {
    $("loginScreen").classList.remove("hidden");
    $("loginBtn").onclick = doLogin;
    $("loginPassword").onkeydown = (e) => e.key === "Enter" && doLogin();
  } else {
    await loadApp();
  }
}

async function doLogin() {
  const pw = $("loginPassword").value;
  const res = await api("/api/login", { method: "POST", body: JSON.stringify({ password: pw }) });
  if (res.ok) {
    appPassword = pw;
    $("loginScreen").classList.add("hidden");
    await loadApp();
  } else {
    $("loginError").textContent = "Wrong password";
  }
}

async function loadApp() {
  const res = await api("/api/data");
  if (!res.ok) { toast("Could not load data", true); return; }
  DATA = await res.json();
  $("app").classList.remove("hidden");

  const months = Object.keys(DATA.months).sort();
  currentMonth = months[months.length - 1];
  const sel = $("monthSelect");
  sel.innerHTML = months.map((m) => `<option value="${m}">${DATA.months[m].label}</option>`).join("");
  sel.value = currentMonth;
  sel.onchange = () => { currentMonth = sel.value; render(); };

  $("addTxnBtn").onclick = () => openModal();
  $("cancelBtn").onclick = closeModal;
  $("saveTxnBtn").onclick = saveTxn;
  render();
}

// ---------- Computations ----------
function monthStats(monthKey) {
  const m = DATA.months[monthKey];
  const byCat = {};
  DATA.categories.forEach((c) => (byCat[c] = 0));
  m.transactions.forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + Number(t.amount); });
  const totalBudget = DATA.categories.reduce((s, c) => s + (m.budgets[c] || 0), 0);
  const totalSpent = Object.values(byCat).reduce((s, v) => s + v, 0);
  return { byCat, totalBudget, totalSpent, remaining: totalBudget - totalSpent };
}

// ---------- Render ----------
function render() {
  const m = DATA.months[currentMonth];
  const { byCat, totalBudget, totalSpent, remaining } = monthStats(currentMonth);
  const pct = totalBudget ? Math.round((totalSpent / totalBudget) * 100) : 0;

  // Cards
  $("summaryCards").innerHTML = `
    <div class="card accent"><div class="label">Total Budget</div><div class="value">${fmt(totalBudget)}</div><div class="sub">${m.label}</div></div>
    <div class="card"><div class="label">Spent</div><div class="value amber">${fmt(totalSpent)}</div><div class="sub">${pct}% of budget</div></div>
    <div class="card"><div class="label">Remaining</div><div class="value ${remaining < 0 ? "red" : "green"}">${fmt(remaining)}</div><div class="sub">${remaining < 0 ? "Over budget" : "Left to spend"}</div></div>
    <div class="card"><div class="label">Transactions</div><div class="value">${m.transactions.length}</div><div class="sub">this month</div></div>
  `;

  renderCategoryBars(m, byCat);
  renderTable(m);
  renderCharts(m, byCat);
}

function renderCategoryBars(m, byCat) {
  $("categoryBars").innerHTML = DATA.categories.map((c) => {
    const budget = m.budgets[c] || 0;
    const spent = byCat[c] || 0;
    const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
    const over = spent > budget;
    const color = over ? "var(--red)" : CAT_COLORS[c] || "var(--accent)";
    return `
      <div class="cat-row">
        <div class="cat-top">
          <span class="cat-name">${c}</span>
          <span class="cat-vals"><b>${fmt(spent)}</b> / ${fmt(budget)}</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
      </div>`;
  }).join("");
}

function renderTable(m) {
  const body = $("txnBody");
  const sorted = [...m.transactions].sort((a, b) => b.date.localeCompare(a.date));
  $("txnCount").textContent = `(${sorted.length})`;
  $("emptyState").classList.toggle("hidden", sorted.length > 0);
  body.innerHTML = sorted.map((t) => `
    <tr>
      <td>${formatDate(t.date)}</td>
      <td><span class="pill" style="background:${hexToRgba(CAT_COLORS[t.category],0.15)};color:${CAT_COLORS[t.category]}">${t.category}</span></td>
      <td class="num">${fmt(t.amount)}</td>
      <td>${escapeHtml(t.remarks || "")}</td>
      <td><div class="row-actions">
        <button class="icon-btn" onclick="openModal('${t.id}')">✎</button>
        <button class="icon-btn del" onclick="deleteTxn('${t.id}')">✕</button>
      </div></td>
    </tr>`).join("");
}

function renderCharts(m, byCat) {
  const labels = DATA.categories;
  const budgets = labels.map((c) => m.budgets[c] || 0);
  const spent = labels.map((c) => byCat[c] || 0);
  const colors = labels.map((c) => CAT_COLORS[c] || "#6366f1");

  if (barChart) barChart.destroy();
  barChart = new Chart($("barChart"), {
    type: "bar",
    data: {
      labels: labels.map(shortLabel),
      datasets: [
        { label: "Budget", data: budgets, backgroundColor: "rgba(139,147,167,0.35)", borderRadius: 6 },
        { label: "Spent", data: spent, backgroundColor: colors, borderRadius: 6 },
      ],
    },
    options: chartOpts(true),
  });

  if (donutChart) donutChart.destroy();
  const split = labels.map((c) => byCat[c] || 0);
  const hasData = split.some((v) => v > 0);
  donutChart = new Chart($("donutChart"), {
    type: "doughnut",
    data: {
      labels: hasData ? labels : ["No spending yet"],
      datasets: [{ data: hasData ? split : [1], backgroundColor: hasData ? colors : ["#2a3040"], borderColor: "#1a1e29", borderWidth: 3 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { color: "#8b93a7", padding: 14, font: { size: 11 }, boxWidth: 12 } },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${fmt(ctx.raw)}` } },
      },
    },
  });
}

function chartOpts(stacked) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: "#8b93a7", font: { size: 12 }, boxWidth: 14 } },
      tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } },
    },
    scales: {
      x: { ticks: { color: "#8b93a7", font: { size: 10 } }, grid: { display: false } },
      y: { ticks: { color: "#8b93a7", callback: (v) => "₹" + v / 1000 + "k" }, grid: { color: "rgba(42,48,64,.5)" } },
    },
  };
}

// ---------- Modal / CRUD ----------
function openModal(id = null) {
  editingId = id;
  $("fCategory").innerHTML = DATA.categories.map((c) => `<option value="${c}">${c}</option>`).join("");
  if (id) {
    const t = DATA.months[currentMonth].transactions.find((x) => x.id === id);
    $("modalTitle").textContent = "Edit transaction";
    $("fDate").value = t.date;
    $("fCategory").value = t.category;
    $("fAmount").value = t.amount;
    $("fRemarks").value = t.remarks || "";
  } else {
    $("modalTitle").textContent = "Add transaction";
    $("fDate").value = currentMonth + "-01";
    $("fCategory").value = DATA.categories[0];
    $("fAmount").value = "";
    $("fRemarks").value = "";
  }
  $("modal").classList.remove("hidden");
}
function closeModal() { $("modal").classList.add("hidden"); editingId = null; }

async function saveTxn() {
  const date = $("fDate").value;
  const category = $("fCategory").value;
  const amount = parseFloat($("fAmount").value);
  const remarks = $("fRemarks").value.trim();
  if (!date || !category || isNaN(amount)) { toast("Fill date, category and amount", true); return; }

  const txns = DATA.months[currentMonth].transactions;
  if (editingId) {
    const t = txns.find((x) => x.id === editingId);
    Object.assign(t, { date, category, amount, remarks });
  } else {
    txns.push({ id: "t" + Date.now().toString(36), date, category, amount, remarks });
  }
  closeModal();
  render();
  await persist();
}

async function deleteTxn(id) {
  if (!confirm("Delete this transaction?")) return;
  const m = DATA.months[currentMonth];
  m.transactions = m.transactions.filter((t) => t.id !== id);
  render();
  await persist();
}

async function persist() {
  setSaveStatus("saving");
  try {
    const res = await api("/api/data", { method: "POST", body: JSON.stringify(DATA) });
    if (!res.ok) throw new Error();
    setSaveStatus("saved");
    toast("Saved");
  } catch {
    setSaveStatus("error");
    toast("Could not save changes", true);
  }
}

// ---------- Utils ----------
function formatDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}
function shortLabel(c) {
  const map = { "Rent & Maintenance": "Rent", "Groceries & Outside Food": "Groceries", "Bills & Subscriptions": "Bills", "Leisure & Entertainment": "Leisure", "Miscellaneous": "Misc" };
  return map[c] || c;
}
function hexToRgba(hex, a) {
  if (!hex) return `rgba(99,102,241,${a})`;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

window.openModal = openModal;
window.deleteTxn = deleteTxn;
boot();
