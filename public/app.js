// ---------- State ----------
let DATA = null;
let currentMonth = null;   // "YYYY-MM"
let editingId = null;
let appPassword = "";
let barChart, donutChart;

const PALETTE = ["#6366f1", "#22d3ee", "#f59e0b", "#ec4899", "#10b981", "#a855f7", "#ef4444", "#14b8a6", "#f97316", "#3b82f6"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const fmt = (n) => (DATA?.currency || "₹") + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const api = (url, opts = {}) =>
  fetch(url, { ...opts, headers: { "Content-Type": "application/json", "x-app-password": appPassword, ...(opts.headers || {}) } });
const catColor = (cat) => { const i = DATA.categories.indexOf(cat); return PALETTE[i % PALETTE.length] || "#6366f1"; };

function toast(msg, isError = false) {
  const t = $("toast"); t.textContent = msg;
  t.className = "toast" + (isError ? " error" : "");
  t.classList.remove("hidden"); setTimeout(() => t.classList.add("hidden"), 2600);
}
function setSaveStatus(s) {
  const el = $("saveStatus");
  el.className = "save-status" + (s === "saving" ? " saving" : s === "error" ? " error" : "");
  el.textContent = s === "saving" ? "Saving…" : s === "error" ? "Save failed" : "Saved";
}

// ---------- Theme ----------
function initTheme() {
  const saved = localStorage.getItem("aisman-theme") || "dark";
  setTheme(saved);
  $("themeToggle").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("aisman-theme", theme);
  $("themeToggle").textContent = theme === "dark" ? "🌙" : "☀️";
  if (DATA) render();
}

// ---------- Boot ----------
async function boot() {
  initTheme();
  const cfg = await (await fetch("/api/config")).json();
  $("persistenceLabel").textContent = cfg.persistence === "github" ? "Synced to GitHub" : "Local storage — configure GitHub to persist";
  if (cfg.requiresPassword) {
    $("loginScreen").classList.remove("hidden");
    $("loginBtn").onclick = doLogin;
    $("loginPassword").onkeydown = (e) => e.key === "Enter" && doLogin();
  } else { await loadApp(); }
}
async function doLogin() {
  const pw = $("loginPassword").value;
  const res = await api("/api/login", { method: "POST", body: JSON.stringify({ password: pw }) });
  if (res.ok) { appPassword = pw; $("loginScreen").classList.add("hidden"); await loadApp(); }
  else { $("loginError").textContent = "Wrong password"; }
}

async function loadApp() {
  const res = await api("/api/data");
  if (!res.ok) { toast("Could not load data", true); return; }
  DATA = await res.json();
  if (!DATA.defaultBudgets) DATA.defaultBudgets = {};
  if (!Array.isArray(DATA.shoppingList)) DATA.shoppingList = [];
  $("app").classList.remove("hidden");

  // pick latest existing month, else today
  const months = Object.keys(DATA.months).sort();
  currentMonth = months.length ? months[months.length - 1] : isoMonth(new Date());

  buildPickers();
  $("addTxnBtn").onclick = () => openModal();
  $("cancelBtn").onclick = closeModal;
  $("saveTxnBtn").onclick = saveTxn;
  $("settingsBtn").onclick = openSettings;
  $("closeSettings").onclick = () => $("settingsOverlay").classList.add("hidden");
  $("addCatBtn").onclick = addCategoryRow;
  $("settingsSaveBtn").onclick = saveSettings;
  $("exportBtn").onclick = exportExcel;
  $("addItemBtn").onclick = addShopItem;
  $("newItem").onkeydown = (e) => e.key === "Enter" && addShopItem();
  $("clearListBtn").onclick = clearShopList;
  ensureMonth(currentMonth);
  render();
}

// ---------- Month / Year pickers (auto, all months & years) ----------
function isoMonth(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
function buildPickers() {
  const ms = $("monthSelect"), ys = $("yearSelect");
  ms.innerHTML = MONTH_NAMES.map((n, i) => `<option value="${String(i+1).padStart(2,"0")}">${n}</option>`).join("");
  // Years: from earliest data year (or 2024) to current year + 1
  const dataYears = Object.keys(DATA.months).map((k) => +k.split("-")[0]);
  const minY = Math.min(2024, ...(dataYears.length ? dataYears : [2026]));
  const maxY = Math.max(new Date().getFullYear() + 1, ...(dataYears.length ? dataYears : [2026]));
  let opts = ""; for (let y = minY; y <= maxY; y++) opts += `<option value="${y}">${y}</option>`;
  ys.innerHTML = opts;
  const [yy, mm] = currentMonth.split("-");
  ms.value = mm; ys.value = yy;
  const onChange = () => { currentMonth = ys.value + "-" + ms.value; ensureMonth(currentMonth); render(); };
  ms.onchange = onChange; ys.onchange = onChange;
}
// Auto-create a month with default budgets if it doesn't exist
function ensureMonth(key) {
  if (DATA.months[key]) return false;
  const [y, m] = key.split("-");
  DATA.months[key] = {
    label: `${MONTH_NAMES[+m - 1]} ${y}`,
    budgets: { ...defaultsForBudgets() },
    transactions: [],
  };
  return true;
}
function defaultsForBudgets() {
  const b = {};
  DATA.categories.forEach((c) => (b[c] = DATA.defaultBudgets[c] ?? 0));
  return b;
}

// ---------- Computations ----------
function monthStats(key) {
  const m = DATA.months[key];
  const byCat = {}; DATA.categories.forEach((c) => (byCat[c] = 0));
  m.transactions.forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + Number(t.amount); });
  const totalBudget = DATA.categories.reduce((s, c) => s + (m.budgets[c] || 0), 0);
  const totalSpent = Object.values(byCat).reduce((s, v) => s + v, 0);
  return { byCat, totalBudget, totalSpent, remaining: totalBudget - totalSpent };
}
function totalSavedAllMonths() {
  let saved = 0, count = 0;
  for (const key of Object.keys(DATA.months)) {
    const s = monthStats(key);
    if (s.totalSpent > 0) { saved += s.remaining; count++; }
  }
  return { saved, count };
}

// ---------- Render ----------
function render() {
  const m = DATA.months[currentMonth];
  const { byCat, totalBudget, totalSpent, remaining } = monthStats(currentMonth);
  const pct = totalBudget ? Math.round((totalSpent / totalBudget) * 100) : 0;
  const saved = Math.max(0, remaining);

  $("summaryCards").innerHTML = `
    <div class="card accent"><div class="label">Total Budget</div><div class="value">${fmt(totalBudget)}</div><div class="sub">${m.label}</div></div>
    <div class="card"><div class="label">Spent</div><div class="value amber">${fmt(totalSpent)}</div><div class="sub">${pct}% of budget</div></div>
    <div class="card"><div class="label">${remaining < 0 ? "Over Budget" : "Remaining"}</div><div class="value ${remaining < 0 ? "red" : "green"}">${fmt(Math.abs(remaining))}</div><div class="sub">${remaining < 0 ? "above budget" : "left to spend"}</div></div>
    <div class="card"><div class="label">Transactions</div><div class="value">${m.transactions.length}</div><div class="sub">this month</div></div>`;

  // Savings strip
  const all = totalSavedAllMonths();
  const avg = all.count ? all.saved / all.count : 0;
  $("savingsStrip").innerHTML = `
    <div class="ss-item"><span>💰 Saved this month</span><b class="${saved>0?'green':'red'}">${fmt(remaining)}</b></div>
    <div class="ss-item"><span>Total saved (all tracked months)</span><b class="${all.saved>=0?'green':'red'}">${fmt(all.saved)}</b></div>
    <div class="ss-item"><span>Avg saved / month</span><b class="${avg>=0?'green':'red'}">${fmt(avg)}</b></div>`;

  renderCategoryBars(m, byCat);
  renderTable(m);
  renderShopList();
  renderCharts(m, byCat);
}

function renderCategoryBars(m, byCat) {
  $("categoryBars").innerHTML = DATA.categories.map((c) => {
    const budget = m.budgets[c] || 0, spent = byCat[c] || 0;
    const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
    const color = spent > budget ? "var(--red)" : catColor(c);
    return `<div class="cat-row"><div class="cat-top"><span class="cat-name">${esc(c)}</span>
      <span class="cat-vals"><b>${fmt(spent)}</b> / ${fmt(budget)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div></div>`;
  }).join("");
}

function renderTable(m) {
  const sorted = [...m.transactions].sort((a, b) => b.date.localeCompare(a.date));
  $("txnCount").textContent = `(${sorted.length})`;
  $("emptyState").classList.toggle("hidden", sorted.length > 0);
  $("txnBody").innerHTML = sorted.map((t) => `<tr>
    <td>${formatDate(t.date)}</td>
    <td><span class="pill" style="background:${hexToRgba(catColor(t.category),0.18)};color:${catColor(t.category)}">${esc(t.category)}</span></td>
    <td class="num">${fmt(t.amount)}</td>
    <td>${esc(t.remarks || "")}</td>
    <td><div class="row-actions">
      <button class="icon-btn" onclick="openModal('${t.id}')">✎</button>
      <button class="icon-btn del" onclick="deleteTxn('${t.id}')">✕</button>
    </div></td></tr>`).join("");
}

function renderCharts(m, byCat) {
  const labels = DATA.categories;
  const budgets = labels.map((c) => m.budgets[c] || 0);
  const spent = labels.map((c) => byCat[c] || 0);
  const colors = labels.map(catColor);
  const dark = document.documentElement.dataset.theme === "dark";
  const tickColor = dark ? "#9aa3ba" : "#6b7385";
  const gridColor = dark ? "rgba(255,255,255,.07)" : "rgba(20,24,40,.08)";

  if (barChart) barChart.destroy();
  barChart = new Chart($("barChart"), {
    type: "bar",
    data: { labels: labels.map(shortLabel), datasets: [
      { label: "Budget", data: budgets, backgroundColor: dark ? "rgba(154,163,186,.3)" : "rgba(107,115,133,.25)", borderRadius: 6 },
      { label: "Spent", data: spent, backgroundColor: colors, borderRadius: 6 } ] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: tickColor, boxWidth: 14, font: { size: 12 } } },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.raw)}` } } },
      scales: { x: { ticks: { color: tickColor, font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: tickColor, callback: (v) => "₹" + v / 1000 + "k" }, grid: { color: gridColor } } } },
  });

  if (donutChart) donutChart.destroy();
  const has = spent.some((v) => v > 0);
  donutChart = new Chart($("donutChart"), {
    type: "doughnut",
    data: { labels: has ? labels : ["No spending yet"],
      datasets: [{ data: has ? spent : [1], backgroundColor: has ? colors : ["rgba(150,150,150,.2)"], borderColor: dark ? "#0a0c12" : "#eef1fb", borderWidth: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "62%",
      plugins: { legend: { position: "bottom", labels: { color: tickColor, padding: 14, font: { size: 11 }, boxWidth: 12 } },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmt(c.raw)}` } } } },
  });
}

// ---------- Transaction modal ----------
function openModal(id = null) {
  editingId = id;
  $("fCategory").innerHTML = DATA.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  if (id) {
    const t = DATA.months[currentMonth].transactions.find((x) => x.id === id);
    $("modalTitle").textContent = "Edit transaction";
    $("fDate").value = t.date; $("fCategory").value = t.category; $("fAmount").value = t.amount; $("fRemarks").value = t.remarks || "";
  } else {
    $("modalTitle").textContent = "Add transaction";
    $("fDate").value = currentMonth + "-01"; $("fCategory").value = DATA.categories[0]; $("fAmount").value = ""; $("fRemarks").value = "";
  }
  $("modal").classList.remove("hidden");
}
function closeModal() { $("modal").classList.add("hidden"); editingId = null; }

async function saveTxn() {
  const date = $("fDate").value, category = $("fCategory").value;
  const amount = parseFloat($("fAmount").value), remarks = $("fRemarks").value.trim();
  if (!date || !category || isNaN(amount)) { toast("Fill date, category and amount", true); return; }
  const txns = DATA.months[currentMonth].transactions;
  if (editingId) { Object.assign(txns.find((x) => x.id === editingId), { date, category, amount, remarks }); }
  else { txns.push({ id: "t" + Date.now().toString(36), date, category, amount, remarks }); }
  closeModal(); render(); await persist();
}
async function deleteTxn(id) {
  if (!confirm("Delete this transaction?")) return;
  const m = DATA.months[currentMonth];
  m.transactions = m.transactions.filter((t) => t.id !== id);
  render(); await persist();
}

// ---------- Settings ----------
function openSettings() {
  const m = DATA.months[currentMonth];
  $("settingsMonthLabel").textContent = `Editing budgets for ${m.label}`;
  renderBudgetRows(m.budgets);
  $("applyAll").checked = false;
  $("settingsOverlay").classList.remove("hidden");
}
function renderBudgetRows(budgets) {
  $("budgetRows").innerHTML = DATA.categories.map((c) => `
    <div class="budget-row" data-cat="${esc(c)}">
      <span class="bcat">${esc(c)}</span>
      <input type="number" class="glass-input bbudget" min="0" value="${budgets[c] ?? 0}" />
      <button class="icon-btn del" onclick="removeCategory('${esc(c)}')">✕</button>
    </div>`).join("");
  updateSettingsTotal();
  document.querySelectorAll(".bbudget").forEach((i) => (i.oninput = updateSettingsTotal));
}
function updateSettingsTotal() {
  let total = 0; document.querySelectorAll(".bbudget").forEach((i) => (total += +i.value || 0));
  $("settingsTotal").textContent = fmt(total);
}
function addCategoryRow() {
  const name = $("newCatName").value.trim();
  const budget = parseFloat($("newCatBudget").value) || 0;
  if (!name) { toast("Enter a category name", true); return; }
  if (DATA.categories.includes(name)) { toast("Category already exists", true); return; }
  DATA.categories.push(name);
  DATA.defaultBudgets[name] = budget;
  Object.values(DATA.months).forEach((m) => { if (!(name in m.budgets)) m.budgets[name] = budget; });
  $("newCatName").value = ""; $("newCatBudget").value = "";
  renderBudgetRows(DATA.months[currentMonth].budgets);
}
function removeCategory(cat) {
  if (!confirm(`Remove category "${cat}"? Existing transactions keep their label but it won't be budgeted.`)) return;
  DATA.categories = DATA.categories.filter((c) => c !== cat);
  delete DATA.defaultBudgets[cat];
  Object.values(DATA.months).forEach((m) => delete m.budgets[cat]);
  renderBudgetRows(DATA.months[currentMonth].budgets);
}
async function saveSettings() {
  const newBudgets = {};
  document.querySelectorAll(".budget-row").forEach((row) => {
    newBudgets[row.dataset.cat] = +row.querySelector(".bbudget").value || 0;
  });
  DATA.months[currentMonth].budgets = newBudgets;
  DATA.defaultBudgets = { ...DATA.defaultBudgets, ...newBudgets }; // newest become defaults for new months
  if ($("applyAll").checked) {
    Object.values(DATA.months).forEach((m) => { m.budgets = { ...newBudgets }; });
  }
  $("settingsOverlay").classList.add("hidden");
  render(); await persist();
  toast("Budgets updated");
}

// ---------- Grocery buy list ----------
function renderShopList() {
  const list = DATA.shoppingList || [];
  $("listCount").textContent = list.length ? `(${list.filter(i=>!i.done).length} to buy)` : "";
  $("listEmpty").classList.toggle("hidden", list.length > 0);
  $("shopList").innerHTML = list.map((it) => `
    <li class="shop-item ${it.done ? "done" : ""}">
      <input type="checkbox" ${it.done ? "checked" : ""} onchange="toggleItem('${it.id}')" />
      <span class="item-text">${esc(it.text)}</span>
      <button class="icon-btn del" onclick="deleteItem('${it.id}')">✕</button>
    </li>`).join("");
}
async function addShopItem() {
  const input = $("newItem"); const text = input.value.trim();
  if (!text) return;
  DATA.shoppingList.push({ id: "s" + Date.now().toString(36), text, done: false });
  input.value = ""; renderShopList(); await persist();
}
async function toggleItem(id) {
  const it = DATA.shoppingList.find((x) => x.id === id);
  if (it) it.done = !it.done;
  renderShopList(); await persist();
}
async function deleteItem(id) {
  DATA.shoppingList = DATA.shoppingList.filter((x) => x.id !== id);
  renderShopList(); await persist();
}
async function clearShopList() {
  if (!DATA.shoppingList.length) return;
  if (!confirm("Clear the entire buy list?")) return;
  DATA.shoppingList = []; renderShopList(); await persist();
}

// ---------- Excel export ----------
function exportExcel() {
  const wb = XLSX.utils.book_new();
  const summary = [["Month", "Total Budget", "Total Spent", "Saved / Over", "Transactions"]];
  const monthKeys = Object.keys(DATA.months).sort();
  monthKeys.forEach((key) => {
    const m = DATA.months[key];
    const { totalBudget, totalSpent, remaining } = monthStats(key);
    summary.push([m.label, totalBudget, totalSpent, remaining, m.transactions.length]);

    // Per-month sheet: budgets block + transactions
    const rows = [["Category", "Budget", "Spent", "Remaining"]];
    const stats = monthStats(key);
    DATA.categories.forEach((c) => {
      rows.push([c, m.budgets[c] || 0, stats.byCat[c] || 0, (m.budgets[c] || 0) - (stats.byCat[c] || 0)]);
    });
    rows.push([]); rows.push(["Date", "Category", "Amount", "Remarks"]);
    [...m.transactions].sort((a, b) => a.date.localeCompare(b.date))
      .forEach((t) => rows.push([t.date, t.category, t.amount, t.remarks || ""]));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 24 }, { wch: 22 }, { wch: 12 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(m.label));
  });
  const sws = XLSX.utils.aoa_to_sheet(summary);
  sws["!cols"] = [{ wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, sws, "Summary");
  // move Summary to front
  wb.SheetNames.unshift(wb.SheetNames.pop());
  XLSX.writeFile(wb, `AisMan-Expenses-${new Date().toISOString().slice(0,10)}.xlsx`);
  toast("Excel downloaded");
}
function safeSheetName(s) { return s.replace(/[\\/?*\[\]:]/g, "").slice(0, 31); }

// ---------- Persist ----------
async function persist() {
  setSaveStatus("saving");
  try {
    const res = await api("/api/data", { method: "POST", body: JSON.stringify(DATA) });
    if (!res.ok) throw new Error();
    setSaveStatus("saved");
  } catch { setSaveStatus("error"); toast("Could not save changes", true); }
}

// ---------- Utils ----------
function formatDate(iso) { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y.slice(2)}`; }
function shortLabel(c) { return c.length > 10 ? c.split(" ")[0] : c; }
function hexToRgba(hex, a) { if (!hex || hex[0] !== "#") return `rgba(99,102,241,${a})`; const n = parseInt(hex.slice(1), 16); return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

window.openModal = openModal;
window.deleteTxn = deleteTxn;
window.removeCategory = removeCategory;
window.toggleItem = toggleItem;
window.deleteItem = deleteItem;
boot();
