// ---------- State ----------
let DATA = null, currentMonth = null, editingId = null, appPassword = "";
let barChart;
const PALETTE = ["#6366f1", "#22d3ee", "#f59e0b", "#ec4899", "#10b981", "#a855f7", "#ef4444", "#14b8a6", "#f97316", "#3b82f6"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const fmt = (n) => (DATA?.currency || "₹") + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const api = (url, opts = {}) =>
  fetch(url, { ...opts, headers: { "Content-Type": "application/json", "x-app-password": appPassword, ...(opts.headers || {}) } });
const catColor = (cat) => { const i = DATA.categories.indexOf(cat); return PALETTE[i % PALETTE.length] || "#6366f1"; };
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

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
  setTheme(localStorage.getItem("aisman-theme") || "dark");
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
  $("exportBtn").onclick = exportPDF;
  $("addItemBtn").onclick = addShopItem;
  $("newItem").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addShopItem(); } });
  $("clearListBtn").onclick = clearShopList;
  ensureMonth(currentMonth);
  render();
}

// ---------- Month / Year pickers ----------
function isoMonth(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
function buildPickers() {
  const ms = $("monthSelect"), ys = $("yearSelect");
  ms.innerHTML = MONTH_NAMES.map((n, i) => `<option value="${String(i+1).padStart(2,"0")}">${n}</option>`).join("");
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
function ensureMonth(key) {
  if (DATA.months[key]) return;
  const [y, m] = key.split("-");
  DATA.months[key] = { label: `${MONTH_NAMES[+m - 1]} ${y}`, budgets: defaultsForBudgets(), transactions: [] };
}
function defaultsForBudgets() {
  const b = {}; DATA.categories.forEach((c) => (b[c] = DATA.defaultBudgets[c] ?? 0)); return b;
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

  $("summaryCards").innerHTML = `
    <div class="card accent"><div class="label">Total Budget</div><div class="value">${fmt(totalBudget)}</div><div class="sub">${m.label}</div></div>
    <div class="card"><div class="label">Spent</div><div class="value amber">${fmt(totalSpent)}</div><div class="sub">${pct}% of budget</div></div>
    <div class="card"><div class="label">${remaining < 0 ? "Over Budget" : "Remaining"}</div><div class="value ${remaining < 0 ? "red" : "green"}">${fmt(Math.abs(remaining))}</div><div class="sub">${remaining < 0 ? "above budget" : "left to spend"}</div></div>
    <div class="card"><div class="label">Transactions</div><div class="value">${m.transactions.length}</div><div class="sub">this month</div></div>`;

  const all = totalSavedAllMonths();
  const avg = all.count ? all.saved / all.count : 0;
  $("savingsStrip").innerHTML = `
    <div class="ss-item"><span>💰 Saved this month</span><b class="${remaining>=0?'green':'red'}">${fmt(remaining)}</b></div>
    <div class="ss-item"><span>Total saved (all tracked months)</span><b class="${all.saved>=0?'green':'red'}">${fmt(all.saved)}</b></div>
    <div class="ss-item"><span>Avg saved / month</span><b class="${avg>=0?'green':'red'}">${fmt(avg)}</b></div>`;

  renderCategoryBars(m, byCat);
  renderTable(m);
  renderShopList();
  renderBarChart(m, byCat);
  renderRings(m, byCat, totalBudget, totalSpent);
}

function renderCategoryBars(m, byCat) {
  $("categoryBars").innerHTML = DATA.categories.map((c) => {
    const budget = m.budgets[c] || 0, spent = byCat[c] || 0;
    const p = budget ? Math.min(100, (spent / budget) * 100) : 0;
    const color = spent > budget ? "var(--red)" : catColor(c);
    return `<div class="cat-row"><div class="cat-top"><span class="cat-name">${esc(c)}</span>
      <span class="cat-vals"><b>${fmt(spent)}</b> / ${fmt(budget)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${p}%;background:${color}"></div></div></div>`;
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

// ---------- Bar chart ----------
function renderBarChart(m, byCat) {
  const labels = DATA.categories;
  const dark = document.documentElement.dataset.theme === "dark";
  const tick = dark ? "#9aa3ba" : "#6b7385";
  const grid = dark ? "rgba(255,255,255,.07)" : "rgba(20,24,40,.08)";
  if (barChart) barChart.destroy();
  barChart = new Chart($("barChart"), {
    type: "bar",
    data: { labels: labels.map(shortLabel), datasets: [
      { label: "Budget", data: labels.map((c) => m.budgets[c] || 0), backgroundColor: dark ? "rgba(154,163,186,.28)" : "rgba(107,115,133,.25)", borderRadius: 6 },
      { label: "Spent", data: labels.map((c) => byCat[c] || 0), backgroundColor: labels.map(catColor), borderRadius: 6 } ] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: tick, boxWidth: 14, font: { size: 12 } } },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.raw)}` } } },
      scales: { x: { ticks: { color: tick, font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: tick, callback: (v) => "₹" + v / 1000 + "k" }, grid: { color: grid } } } },
  });
}

// ---------- Apple Watch-style activity rings ----------
function renderRings(m, byCat, totalBudget, totalSpent) {
  const size = 260, cx = size / 2, cy = size / 2;
  const n = DATA.categories.length;
  const rMax = size / 2 - 8, rMin = 38;
  const step = n > 1 ? (rMax - rMin) / (n - 1) : 0;
  const sw = Math.min(14, Math.max(6, step - 4));
  const textCol = cssVar("--text") || "#fff";
  const mutedCol = cssVar("--muted") || "#888";
  const trackCol = document.documentElement.dataset.theme === "dark" ? "rgba(255,255,255,.08)" : "rgba(20,24,40,.08)";
  const overallPct = totalBudget ? Math.round((totalSpent / totalBudget) * 100) : 0;

  let rings = "";
  DATA.categories.forEach((c, i) => {
    const r = rMax - i * step;
    const C = 2 * Math.PI * r;
    const budget = m.budgets[c] || 0, spent = byCat[c] || 0;
    const ratio = budget ? Math.min(spent / budget, 1) : 0;
    const over = budget && spent > budget;
    const col = over ? "#f87171" : catColor(c);
    rings += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="${trackCol}" stroke-width="${sw.toFixed(1)}"></circle>`;
    rings += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${sw.toFixed(1)}" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - ratio)).toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"></circle>`;
  });

  const svg = `<svg class="ring-svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Spending against budget by category">
    ${rings}
    <text x="${cx}" y="${cy - 5}" text-anchor="middle" font-size="26" font-weight="800" fill="${textCol}">${overallPct}%</text>
    <text x="${cx}" y="${cy + 15}" text-anchor="middle" font-size="10" font-weight="600" fill="${mutedCol}">of budget</text>
  </svg>`;

  const legend = `<div class="ring-legend">` + DATA.categories.map((c) => {
    const budget = m.budgets[c] || 0, spent = byCat[c] || 0;
    const p = budget ? Math.round((spent / budget) * 100) : 0;
    const over = budget && spent > budget;
    const col = over ? "#f87171" : catColor(c);
    return `<div class="rl"><span class="dot" style="background:${col};color:${col}"></span>
      <span class="nm">${esc(c)}</span>
      <span class="vl"><b>${fmt(spent)}</b> / ${fmt(budget)} · ${p}%</span></div>`;
  }).join("") + `</div>`;

  $("ringBox").innerHTML = svg + legend;
}

// ---------- Grocery buy list ----------
function renderShopList() {
  const list = DATA.shoppingList || [];
  $("listCount").textContent = list.length ? `(${list.filter((i) => !i.done).length} to buy)` : "";
  $("listEmpty").classList.toggle("hidden", list.length > 0);
  $("shopList").innerHTML = list.map((it) => `
    <li class="shop-item ${it.done ? "done" : ""}">
      <input type="checkbox" ${it.done ? "checked" : ""} onchange="toggleItem('${it.id}')" />
      <span class="item-text">${esc(it.text)}</span>
      <button class="icon-btn del" onclick="deleteItem('${it.id}')">✕</button>
    </li>`).join("");
}
async function addShopItem() {
  const input = $("newItem");
  const text = (input.value || "").trim();
  if (!text) { input.focus(); return; }
  DATA.shoppingList.push({ id: "s" + Date.now().toString(36), text, done: false });
  input.value = ""; input.focus(); renderShopList(); await persist();
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
  DATA.months[currentMonth].transactions = DATA.months[currentMonth].transactions.filter((t) => t.id !== id);
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
  document.querySelectorAll(".budget-row").forEach((row) => { newBudgets[row.dataset.cat] = +row.querySelector(".bbudget").value || 0; });
  DATA.months[currentMonth].budgets = newBudgets;
  DATA.defaultBudgets = { ...DATA.defaultBudgets, ...newBudgets };
  if ($("applyAll").checked) Object.values(DATA.months).forEach((m) => { m.budgets = { ...newBudgets }; });
  $("settingsOverlay").classList.add("hidden");
  render(); await persist(); toast("Budgets updated");
}

// ---------- PDF export (designed report) ----------
function rs(n) { return "Rs " + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 }); }
function fmtDatePdf(iso) { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y.slice(2)}`; }
function exportPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40;
  const ind = [99, 102, 241], dark = [17, 18, 24], gray = [120, 125, 140], green = [16, 150, 110], red = [220, 70, 70];

  // Header band
  doc.setFillColor(...dark); doc.roundedRect(M, 34, W - 2 * M, 66, 12, 12, "F");
  doc.setFillColor(...ind); doc.roundedRect(M + 16, 50, 34, 34, 9, 9, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text("MA", M + 33, 72, { align: "center" });
  doc.setFontSize(17); doc.text("AisMan Expense Tracker", M + 64, 65);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(185, 190, 205);
  doc.text("Financial report  ·  generated " + new Date().toLocaleDateString("en-GB"), M + 64, 82);

  let y = 124;
  doc.setTextColor(...dark); doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text("Overview — all months", M, y);

  const months = Object.keys(DATA.months).sort();
  const sumBody = months.map((k) => { const s = monthStats(k); return [DATA.months[k].label, rs(s.totalBudget), rs(s.totalSpent), rs(s.remaining), String(DATA.months[k].transactions.length)]; });
  doc.autoTable({
    startY: y + 10, head: [["Month", "Budget", "Spent", "Saved / Over", "Txns"]], body: sumBody, theme: "grid",
    headStyles: { fillColor: ind, textColor: 255, fontStyle: "bold", fontSize: 9.5 },
    styles: { fontSize: 9, cellPadding: 6 },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "center" } },
    margin: { left: M, right: M },
    didParseCell: (d) => { if (d.section === "body" && d.column.index === 3) { const s = monthStats(months[d.row.index]); d.cell.styles.textColor = s.remaining >= 0 ? green : red; d.cell.styles.fontStyle = "bold"; } },
  });
  y = doc.lastAutoTable.finalY + 26;

  months.forEach((k) => {
    const m = DATA.months[k], s = monthStats(k);
    if (y > H - 150) { doc.addPage(); y = 50; }
    doc.setFillColor(...ind); doc.roundedRect(M, y, W - 2 * M, 28, 7, 7, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(11.5); doc.text(m.label, M + 14, y + 18);
    doc.setFontSize(9.5); doc.setFont("helvetica", "normal");
    doc.text(`Budget ${rs(s.totalBudget)}   ·   Spent ${rs(s.totalSpent)}   ·   ${s.remaining >= 0 ? "Saved" : "Over"} ${rs(Math.abs(s.remaining))}`, W - M - 14, y + 18, { align: "right" });
    y += 28 + 12;

    const catBody = DATA.categories.map((c) => { const b = m.budgets[c] || 0, sp = s.byCat[c] || 0; return [c, rs(b), rs(sp), rs(b - sp), (b ? Math.round(sp / b * 100) : 0) + "%"]; });
    doc.autoTable({
      startY: y, head: [["Category", "Budget", "Spent", "Remaining", "Used"]], body: catBody, theme: "striped",
      headStyles: { fillColor: dark, textColor: 255, fontSize: 9 }, styles: { fontSize: 9, cellPadding: 5 },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right", cellWidth: 56 } },
      margin: { left: M, right: M },
      didParseCell: (d) => { if (d.section === "body") { const c = DATA.categories[d.row.index], b = m.budgets[c] || 0, sp = s.byCat[c] || 0; if (b && sp > b && d.column.index >= 2) { d.cell.styles.textColor = red; } } },
    });
    y = doc.lastAutoTable.finalY + 12;

    if (m.transactions.length) {
      const tx = [...m.transactions].sort((a, b) => a.date.localeCompare(b.date)).map((t) => [fmtDatePdf(t.date), t.category, rs(t.amount), t.remarks || ""]);
      doc.autoTable({
        startY: y, head: [["Date", "Category", "Amount", "Remarks"]], body: tx, theme: "grid",
        headStyles: { fillColor: [232, 234, 242], textColor: dark, fontSize: 8.5 }, styles: { fontSize: 8, cellPadding: 4 },
        columnStyles: { 2: { halign: "right" } }, margin: { left: M, right: M },
      });
      y = doc.lastAutoTable.finalY + 26;
    } else {
      doc.setTextColor(...gray); doc.setFont("helvetica", "italic"); doc.setFontSize(9);
      doc.text("No transactions recorded for this month.", M, y + 6); y += 28;
    }
  });

  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...gray);
    doc.text(`AisMan Expense Tracker   ·   page ${i} of ${pages}`, W / 2, H - 22, { align: "center" });
  }
  doc.save(`AisMan-Expenses-${new Date().toISOString().slice(0, 10)}.pdf`);
  toast("PDF downloaded");
}

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
function shortLabel(c) { return c.length > 11 ? c.split(" ")[0] : c; }
function hexToRgba(hex, a) { if (!hex || hex[0] !== "#") return `rgba(99,102,241,${a})`; const n = parseInt(hex.slice(1), 16); return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

window.openModal = openModal;
window.deleteTxn = deleteTxn;
window.removeCategory = removeCategory;
window.toggleItem = toggleItem;
window.deleteItem = deleteItem;
boot();
