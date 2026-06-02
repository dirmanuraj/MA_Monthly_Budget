// ---------- State ----------
let DATA = null, currentMonth = null, editingId = null, appPassword = "";
let barChart, yearChart;
let filterText = "", filterCat = "all";
const PALETTE = ["#6366f1", "#22d3ee", "#f59e0b", "#ec4899", "#10b981", "#a855f7", "#ef4444", "#14b8a6", "#f97316", "#3b82f6"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const fmt = (n) => (DATA?.currency || "₹") + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const api = (url, opts = {}) =>
  fetch(url, { ...opts, headers: { "Content-Type": "application/json", "x-app-password": appPassword, ...(opts.headers || {}) } });
const catColor = (cat) => { const i = DATA.categories.indexOf(cat); return PALETTE[i % PALETTE.length] || "#6366f1"; };
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const curM = () => DATA.months[currentMonth];
const uid = (p) => p + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

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
function hashPin(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return "h" + h; }
function download(name, text, type) {
  const blob = new Blob([text], { type: type || "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

// ---------- Theme ----------
function initTheme() {
  setTheme(localStorage.getItem("aisman-theme") || "dark");
  $("themeToggle").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("aisman-theme", theme);
  $("themeToggle").innerHTML = theme === "dark" ? ICON_MOON : ICON_SUN;
  if (DATA) render();
}

// ---------- Boot ----------
async function boot() {
  initTheme();
  if ("serviceWorker" in navigator) {
    try { navigator.serviceWorker.register("/sw.js"); } catch (e) {}
  }
  const cfg = await (await fetch("/api/config")).json();
  const _t = new Date();
  const _bd = $("brandDate"); if (_bd) _bd.textContent = _t.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (cfg.requiresPassword) {
    $("loginScreen").classList.remove("hidden");
    $("loginBtn").onclick = doLogin;
    $("loginPassword").onkeydown = (e) => e.key === "Enter" && doLogin();
  } else {
    maybePinThenLoad();
  }
}
function maybePinThenLoad() {
  const pin = localStorage.getItem("aisman-pin");
  if (!pin) { loadApp(); return; }
  const sc = $("pinScreen"); sc.classList.remove("hidden");
  const tryUnlock = () => {
    if (hashPin($("pinInput").value) === pin) { sc.classList.add("hidden"); loadApp(); }
    else { $("pinError").textContent = "Wrong PIN"; $("pinInput").value = ""; }
  };
  $("pinBtn").onclick = tryUnlock;
  $("pinInput").onkeydown = (e) => e.key === "Enter" && tryUnlock();
  $("pinInput").focus();
}
async function doLogin() {
  const pw = $("loginPassword").value;
  const res = await api("/api/login", { method: "POST", body: JSON.stringify({ password: pw }) });
  if (res.ok) { appPassword = pw; $("loginScreen").classList.add("hidden"); maybePinThenLoad(); }
  else { $("loginError").textContent = "Wrong password"; }
}

async function loadApp() {
  const res = await api("/api/data");
  if (!res.ok) { toast("Could not load data", true); return; }
  DATA = await res.json();
  DATA.defaultBudgets = DATA.defaultBudgets || {};
  DATA.shoppingList = Array.isArray(DATA.shoppingList) ? DATA.shoppingList : [];
  DATA.presets = Array.isArray(DATA.presets) ? DATA.presets : [];
  DATA.recurring = Array.isArray(DATA.recurring) ? DATA.recurring : [];
  DATA.staples = Array.isArray(DATA.staples) ? DATA.staples : [];
  $("app").classList.remove("hidden");

  const months = Object.keys(DATA.months).sort();
  currentMonth = months.length ? months[months.length - 1] : isoMonth(new Date());

  buildPickers();
  wireUI();
  ensureMonth(currentMonth);
  render();
}

function wireUI() {
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
  $("applyRecurringBtn").onclick = applyRecurring;
  $("dupMonthBtn").onclick = duplicateLastMonth;
  $("csvBtn").onclick = () => $("csvInput").click();
  $("csvInput").onchange = importCSV;
  $("searchInput").oninput = (e) => { filterText = e.target.value.toLowerCase(); renderTable(curM()); };
  $("filterCat").onchange = (e) => { filterCat = e.target.value; renderTable(curM()); };
  $("addPresetBtn").onclick = addPreset;
  $("addRecBtn").onclick = addRecurring;
  $("addStapleBtn").onclick = addStaple;
  $("setPinBtn").onclick = setPin;
  $("pinModalCancel").onclick = () => $("pinModal").classList.add("hidden");
  $("pinModalSave").onclick = savePinFromModal;
  $("pinConfirm").addEventListener("keydown", (e) => { if (e.key === "Enter") savePinFromModal(); });
  $("removePinBtn").onclick = removePin;
  $("backupBtn").onclick = () => download(`AisMan-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(DATA, null, 2));
  $("restoreBtn").onclick = () => $("restoreInput").click();
  $("restoreInput").onchange = restoreBackup;
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
function defaultsForBudgets() { const b = {}; DATA.categories.forEach((c) => (b[c] = DATA.defaultBudgets[c] ?? 0)); return b; }
function prevMonthKey(key) { const [y, m] = key.split("-").map(Number); const d = new Date(y, m - 2, 1); return isoMonth(d); }
function daysInMonth(key) { const [y, m] = key.split("-").map(Number); return new Date(y, m, 0).getDate(); }

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
  for (const key of Object.keys(DATA.months)) { const s = monthStats(key); if (s.totalSpent > 0) { saved += s.remaining; count++; } }
  return { saved, count };
}

// ---------- Render ----------
function render() {
  const m = curM();
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

  renderPaceAndAlerts(totalBudget, totalSpent, remaining);
  renderPresetChips();
  populateFilterCats();
  renderCategoryBars(m, byCat);
  renderTable(m);
  renderStapleChips();
  renderShopList();
  renderBarChart(m, byCat);
  renderRings(m, byCat, totalBudget, totalSpent);
  renderYearChart();
}

function renderPaceAndAlerts(totalBudget, totalSpent, remaining) {
  const today = new Date();
  const isCurrent = currentMonth === isoMonth(today);
  const ps = $("paceStrip"), ab = $("alertBanner");
  if (isCurrent && totalBudget > 0) {
    const dim = daysInMonth(currentMonth), day = today.getDate();
    const daysLeft = Math.max(1, dim - day + 1);
    const safe = remaining / daysLeft;
    const projected = totalSpent / (day / dim);
    ps.classList.remove("hidden");
    ps.innerHTML = `
      <div class="ss-item"><span>Safe to spend / day</span><b class="${safe>=0?'green':'red'}">${fmt(Math.max(0, safe))}</b></div>
      <div class="ss-item"><span>Days left</span><b>${daysLeft}</b></div>
      <div class="ss-item"><span>Projected month-end</span><b class="${projected>totalBudget?'red':'green'}">${fmt(projected)}</b></div>`;
    if (projected > totalBudget * 1.02) {
      ab.className = "alert-banner danger";
      ab.textContent = `⚠️ At this pace you're on track to spend about ${fmt(projected)} — over your ${fmt(totalBudget)} budget.`;
    } else if (totalSpent >= totalBudget) {
      ab.className = "alert-banner danger"; ab.textContent = `⚠️ You've reached your total budget for ${curM().label}.`;
    } else if (totalSpent >= totalBudget * 0.8) {
      ab.className = "alert-banner"; ab.textContent = `Heads up: you've used ${Math.round(totalSpent/totalBudget*100)}% of this month's budget.`;
    } else { ab.className = "alert-banner hidden"; }
  } else {
    ps.classList.add("hidden");
    if (totalSpent > totalBudget && totalBudget > 0) { ab.className = "alert-banner danger"; ab.textContent = `This month went ${fmt(totalSpent-totalBudget)} over budget.`; }
    else ab.className = "alert-banner hidden";
  }
}

function renderPresetChips() {
  $("presetChips").innerHTML = DATA.presets.map((p) =>
    `<span class="chip" onclick="usePreset('${p.id}')"><span>＋ ${esc(p.label)}</span></span>`).join("");
}
function renderStapleChips() {
  $("stapleChips").innerHTML = DATA.staples.map((s) =>
    `<span class="chip" onclick="addStapleToList('${esc(s)}')"><span>＋ ${esc(s)}</span></span>`).join("");
}

function populateFilterCats() {
  const sel = $("filterCat");
  sel.innerHTML = `<option value="all">All categories</option>` + DATA.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  sel.value = DATA.categories.includes(filterCat) ? filterCat : "all";
  if (sel.value !== filterCat) filterCat = "all";
}

function renderCategoryBars(m, byCat) {
  const prevKey = prevMonthKey(currentMonth);
  const prev = DATA.months[prevKey] ? monthStats(prevKey).byCat : null;
  $("categoryBars").innerHTML = DATA.categories.map((c) => {
    const budget = m.budgets[c] || 0, spent = byCat[c] || 0;
    const ratio = budget ? spent / budget : 0;
    const p = Math.min(100, ratio * 100);
    const color = spent > budget ? "var(--red)" : ratio >= 0.8 ? "var(--amber)" : catColor(c);
    let delta = "";
    if (prev && prev[c] > 0) {
      const d = Math.round((spent - prev[c]) / prev[c] * 100);
      const cls = d > 1 ? "up" : d < -1 ? "down" : "flat";
      const arrow = d > 1 ? "▲" : d < -1 ? "▼" : "—";
      delta = `<span class="cat-delta ${cls}">${arrow} ${Math.abs(d)}%</span>`;
    }
    return `<div class="cat-row"><div class="cat-top"><span class="cat-name">${esc(c)}${delta}</span>
      <span class="cat-vals"><b>${fmt(spent)}</b> / ${fmt(budget)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${p}%;background:${color}"></div></div></div>`;
  }).join("");
}

function renderTable(m) {
  let rows = [...m.transactions].sort((a, b) => b.date.localeCompare(a.date));
  if (filterCat !== "all") rows = rows.filter((t) => t.category === filterCat);
  if (filterText) rows = rows.filter((t) => (t.remarks || "").toLowerCase().includes(filterText) || t.category.toLowerCase().includes(filterText));
  $("txnCount").textContent = `(${rows.length}${rows.length !== m.transactions.length ? " of " + m.transactions.length : ""})`;
  $("emptyState").classList.toggle("hidden", rows.length > 0);
  $("txnBody").innerHTML = rows.map((t) => `<tr>
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
  const labels = DATA.categories, dark = document.documentElement.dataset.theme === "dark";
  const tick = dark ? "#9aa3ba" : "#6b7385", grid = dark ? "rgba(255,255,255,.07)" : "rgba(20,24,40,.08)";
  if (barChart) barChart.destroy();
  barChart = new Chart($("barChart"), {
    type: "bar",
    data: { labels: labels.map(shortLabel), datasets: [
      { label: "Budget", data: labels.map((c) => m.budgets[c] || 0), backgroundColor: dark ? "rgba(154,163,186,.28)" : "rgba(107,115,133,.25)", borderRadius: 6 },
      { label: "Spent", data: labels.map((c) => byCat[c] || 0), backgroundColor: labels.map(catColor), borderRadius: 6 } ] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: tick, boxWidth: 14, font: { size: 12 } } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.raw)}` } } },
      scales: { x: { ticks: { color: tick, font: { size: 10 } }, grid: { display: false } }, y: { ticks: { color: tick, callback: (v) => "₹" + v / 1000 + "k" }, grid: { color: grid } } } },
  });
}

// ---------- Year at a glance ----------
function renderYearChart() {
  const year = $("yearSelect").value;
  $("yearLabel").textContent = year;
  const dark = document.documentElement.dataset.theme === "dark";
  const tick = dark ? "#9aa3ba" : "#6b7385", grid = dark ? "rgba(255,255,255,.07)" : "rgba(20,24,40,.08)";
  const spent = [], saved = [], budget = [];
  for (let mo = 1; mo <= 12; mo++) {
    const key = `${year}-${String(mo).padStart(2, "0")}`;
    if (DATA.months[key]) { const s = monthStats(key); spent.push(s.totalSpent); saved.push(Math.max(0, s.remaining)); budget.push(s.totalBudget); }
    else { spent.push(0); saved.push(0); budget.push(0); }
  }
  if (yearChart) yearChart.destroy();
  yearChart = new Chart($("yearChart"), {
    type: "bar",
    data: { labels: MONTH_NAMES.map((n) => n.slice(0, 3)), datasets: [
      { label: "Spent", data: spent, backgroundColor: "#6366f1", borderRadius: 5, stack: "a" },
      { label: "Saved", data: saved, backgroundColor: "#10b981", borderRadius: 5, stack: "a" },
      { label: "Budget", type: "line", data: budget, borderColor: dark ? "#9aa3ba" : "#6b7385", borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5 } ] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: tick, boxWidth: 14, font: { size: 12 } } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.raw)}` } } },
      scales: { x: { ticks: { color: tick, font: { size: 10 } }, grid: { display: false }, stacked: true }, y: { ticks: { color: tick, callback: (v) => "₹" + v / 1000 + "k" }, grid: { color: grid }, stacked: true } } },
  });
}

// ---------- Activity rings (animated) ----------
function renderRings(m, byCat, totalBudget, totalSpent) {
  const size = 260, cx = size / 2, cy = size / 2, n = DATA.categories.length;
  const rMax = size / 2 - 8, rMin = 38, step = n > 1 ? (rMax - rMin) / (n - 1) : 0;
  const sw = Math.min(14, Math.max(6, step - 4));
  const textCol = cssVar("--text") || "#fff", mutedCol = cssVar("--muted") || "#888";
  const trackCol = document.documentElement.dataset.theme === "dark" ? "rgba(255,255,255,.08)" : "rgba(20,24,40,.08)";
  const overallPct = totalBudget ? Math.round((totalSpent / totalBudget) * 100) : 0;
  let rings = "";
  DATA.categories.forEach((c, i) => {
    const r = rMax - i * step, C = 2 * Math.PI * r;
    const budget = m.budgets[c] || 0, spent = byCat[c] || 0;
    const ratio = budget ? Math.min(spent / budget, 1) : 0;
    const col = budget && spent > budget ? "#f87171" : catColor(c);
    rings += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="${trackCol}" stroke-width="${sw.toFixed(1)}"></circle>`;
    rings += `<circle class="ring-prog" cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${sw.toFixed(1)}" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" data-final="${(C*(1-ratio)).toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"></circle>`;
  });
  const svg = `<svg class="ring-svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Spending against budget by category">
    ${rings}
    <text x="${cx}" y="${cy - 5}" text-anchor="middle" font-size="26" font-weight="800" fill="${textCol}">${overallPct}%</text>
    <text x="${cx}" y="${cy + 15}" text-anchor="middle" font-size="10" font-weight="600" fill="${mutedCol}">of budget</text></svg>`;
  const legend = `<div class="ring-legend">` + DATA.categories.map((c) => {
    const budget = m.budgets[c] || 0, spent = byCat[c] || 0, p = budget ? Math.round(spent / budget * 100) : 0;
    const col = budget && spent > budget ? "#f87171" : catColor(c);
    return `<div class="rl"><span class="dot" style="background:${col};color:${col}"></span><span class="nm">${esc(c)}</span><span class="vl"><b>${fmt(spent)}</b> / ${fmt(budget)} · ${p}%</span></div>`;
  }).join("") + `</div>`;
  $("ringBox").innerHTML = svg + legend;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll("#ringBox .ring-prog").forEach((c) => c.setAttribute("stroke-dashoffset", c.dataset.final));
  }));
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
      <button class="icon-btn log" title="Log as grocery expense" onclick="logItemExpense('${it.id}')">₹</button>
      <button class="icon-btn del" onclick="deleteItem('${it.id}')">✕</button>
    </li>`).join("");
}
async function addShopItem() {
  const input = $("newItem"); const text = (input.value || "").trim();
  if (!text) { input.focus(); return; }
  DATA.shoppingList.push({ id: uid("s"), text, done: false });
  input.value = ""; input.focus(); renderShopList(); await persist();
}
function addStapleToList(name) {
  if (DATA.shoppingList.some((i) => i.text.toLowerCase() === name.toLowerCase() && !i.done)) { toast(`${name} is already on the list`); return; }
  DATA.shoppingList.push({ id: uid("s"), text: name, done: false });
  renderShopList(); persist();
}
async function toggleItem(id) { const it = DATA.shoppingList.find((x) => x.id === id); if (it) it.done = !it.done; renderShopList(); await persist(); }
async function deleteItem(id) { DATA.shoppingList = DATA.shoppingList.filter((x) => x.id !== id); renderShopList(); await persist(); }
async function clearShopList() { if (!DATA.shoppingList.length) return; if (!confirm("Clear the entire buy list?")) return; DATA.shoppingList = []; renderShopList(); await persist(); }
function logItemExpense(id) {
  const it = DATA.shoppingList.find((x) => x.id === id); if (!it) return;
  const groceryCat = DATA.categories.find((c) => /groc/i.test(c)) || DATA.categories[0];
  openModal(null, { category: groceryCat, remarks: it.text });
}

// ---------- Transaction modal ----------
function openModal(id = null, prefill = null) {
  editingId = id;
  $("fCategory").innerHTML = DATA.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  if (id) {
    const t = curM().transactions.find((x) => x.id === id);
    $("modalTitle").textContent = "Edit transaction";
    $("fDate").value = t.date; $("fCategory").value = t.category; $("fAmount").value = t.amount; $("fRemarks").value = t.remarks || "";
  } else {
    $("modalTitle").textContent = "Add transaction";
    $("fDate").value = currentMonth + "-01";
    $("fCategory").value = (prefill && prefill.category) || DATA.categories[0];
    $("fAmount").value = ""; $("fRemarks").value = (prefill && prefill.remarks) || "";
  }
  $("modal").classList.remove("hidden");
  setTimeout(() => $("fAmount").focus(), 50);
}
function closeModal() { $("modal").classList.add("hidden"); editingId = null; }
async function saveTxn() {
  const date = $("fDate").value, category = $("fCategory").value;
  const amount = parseFloat($("fAmount").value), remarks = $("fRemarks").value.trim();
  if (!date || !category || isNaN(amount)) { toast("Fill date, category and amount", true); return; }
  const key = date.slice(0, 7); ensureMonth(key);
  const txns = DATA.months[key].transactions;
  if (editingId) { const t = curM().transactions.find((x) => x.id === editingId); Object.assign(t, { date, category, amount, remarks }); }
  else { txns.push({ id: uid("t"), date, category, amount, remarks }); }
  if (key !== currentMonth && !editingId) { currentMonth = key; buildPickers(); }
  closeModal(); render(); await persist();
}
async function deleteTxn(id) {
  if (!confirm("Delete this transaction?")) return;
  curM().transactions = curM().transactions.filter((t) => t.id !== id);
  render(); await persist();
}

// ---------- Recurring / duplicate / CSV ----------
async function applyRecurring() {
  if (!DATA.recurring.length) { toast("No recurring templates — add some in Settings", true); return; }
  const m = curM(); let added = 0;
  DATA.recurring.forEach((r) => {
    if (m.transactions.some((t) => t.recurringId === r.id)) return;
    const day = Math.min(r.day || 1, daysInMonth(currentMonth));
    m.transactions.push({ id: uid("t"), date: `${currentMonth}-${String(day).padStart(2, "0")}`, category: r.category, amount: r.amount, remarks: r.remarks, recurringId: r.id });
    added++;
  });
  if (added) { render(); await persist(); toast(`Added ${added} recurring item${added > 1 ? "s" : ""}`); }
  else toast("All recurring items already added this month");
}
async function duplicateLastMonth() {
  const keys = Object.keys(DATA.months).filter((k) => k < currentMonth && DATA.months[k].transactions.length).sort();
  if (!keys.length) { toast("No earlier month with transactions to copy", true); return; }
  const src = DATA.months[keys[keys.length - 1]];
  if (!confirm(`Copy ${src.transactions.length} transactions from ${src.label} into ${curM().label}?`)) return;
  const dim = daysInMonth(currentMonth);
  src.transactions.forEach((t) => {
    const day = Math.min(+t.date.slice(8, 10), dim);
    curM().transactions.push({ id: uid("t"), date: `${currentMonth}-${String(day).padStart(2, "0")}`, category: t.category, amount: t.amount, remarks: t.remarks });
  });
  render(); await persist(); toast(`Copied from ${src.label}`);
}
function parseFlexDate(s) {
  s = (s || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let mm = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (mm) { let [, d, m, y] = mm; if (y.length === 2) y = "20" + y; return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`; }
  return null;
}
async function importCSV(e) {
  const file = e.target.files[0]; if (!file) return;
  const text = await file.text();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let added = 0;
  lines.forEach((line) => {
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cells.length < 3) return;
    const date = parseFlexDate(cells[0]); if (!date) return; // skips header
    const category = cells[1], amount = parseFloat((cells[2] || "").replace(/[^0-9.\-]/g, "")), remarks = cells[3] || "";
    if (isNaN(amount)) return;
    const key = date.slice(0, 7); ensureMonth(key);
    DATA.months[key].transactions.push({ id: uid("t"), date, category, amount, remarks });
    added++;
  });
  e.target.value = "";
  if (added) { buildPickers(); render(); await persist(); toast(`Imported ${added} transactions`); }
  else toast("No valid rows found. Expected: Date, Category, Amount, Remarks", true);
}

// ---------- Settings ----------
function openSettings() {
  $("settingsMonthLabel").textContent = `Editing budgets for ${curM().label}`;
  renderBudgetRows(curM().budgets);
  $("applyAll").checked = false;
  renderPresetRows(); renderRecurringRows(); renderStapleManage();
  $("newPresetCat").innerHTML = DATA.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  $("newRecCat").innerHTML = DATA.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  $("pinStatus").textContent = localStorage.getItem("aisman-pin") ? "PIN is ON for this device." : "No PIN set on this device.";
  $("settingsOverlay").classList.remove("hidden");
}
function renderBudgetRows(budgets) {
  $("budgetRows").innerHTML = DATA.categories.map((c) => `
    <div class="budget-row" data-cat="${esc(c)}"><span class="bcat">${esc(c)}</span>
      <input type="number" class="glass-input bbudget" min="0" value="${budgets[c] ?? 0}" />
      <button class="icon-btn del" onclick="removeCategory('${esc(c)}')">✕</button></div>`).join("");
  updateSettingsTotal();
  document.querySelectorAll(".bbudget").forEach((i) => (i.oninput = updateSettingsTotal));
}
function updateSettingsTotal() { let t = 0; document.querySelectorAll(".bbudget").forEach((i) => (t += +i.value || 0)); $("settingsTotal").textContent = fmt(t); }
function addCategoryRow() {
  const name = $("newCatName").value.trim(), budget = parseFloat($("newCatBudget").value) || 0;
  if (!name) { toast("Enter a category name", true); return; }
  if (DATA.categories.includes(name)) { toast("Category already exists", true); return; }
  DATA.categories.push(name); DATA.defaultBudgets[name] = budget;
  Object.values(DATA.months).forEach((m) => { if (!(name in m.budgets)) m.budgets[name] = budget; });
  $("newCatName").value = ""; $("newCatBudget").value = "";
  renderBudgetRows(curM().budgets);
}
function removeCategory(cat) {
  if (!confirm(`Remove "${cat}"? Existing transactions keep their label but it won't be budgeted.`)) return;
  DATA.categories = DATA.categories.filter((c) => c !== cat); delete DATA.defaultBudgets[cat];
  Object.values(DATA.months).forEach((m) => delete m.budgets[cat]);
  renderBudgetRows(curM().budgets);
}
async function saveSettings() {
  const nb = {}; document.querySelectorAll(".budget-row").forEach((r) => { nb[r.dataset.cat] = +r.querySelector(".bbudget").value || 0; });
  curM().budgets = nb; DATA.defaultBudgets = { ...DATA.defaultBudgets, ...nb };
  if ($("applyAll").checked) Object.values(DATA.months).forEach((m) => { m.budgets = { ...nb }; });
  $("settingsOverlay").classList.add("hidden"); render(); await persist(); toast("Budgets updated");
}

// presets
function renderPresetRows() {
  $("presetRows").innerHTML = DATA.presets.map((p) => `
    <div class="manage-row"><div class="mr-main">${esc(p.label)} <span class="mr-sub">· ${esc(p.category)}${p.remarks ? " · " + esc(p.remarks) : ""}</span></div>
      <button class="icon-btn del" onclick="removePreset('${p.id}')">✕</button></div>`).join("") || `<p class="muted">No presets yet.</p>`;
}
async function addPreset() {
  const label = $("newPresetLabel").value.trim(), category = $("newPresetCat").value, remarks = $("newPresetRemarks").value.trim();
  if (!label) { toast("Enter a preset label", true); return; }
  DATA.presets.push({ id: uid("p"), label, category, remarks });
  $("newPresetLabel").value = ""; $("newPresetRemarks").value = "";
  renderPresetRows(); renderPresetChips(); await persist();
}
async function removePreset(id) { DATA.presets = DATA.presets.filter((p) => p.id !== id); renderPresetRows(); renderPresetChips(); await persist(); }
function usePreset(id) { const p = DATA.presets.find((x) => x.id === id); if (p) openModal(null, { category: p.category, remarks: p.remarks }); }

// recurring
function renderRecurringRows() {
  $("recurringRows").innerHTML = DATA.recurring.map((r) => `
    <div class="manage-row"><div class="mr-main">${esc(r.remarks || r.category)} <span class="mr-sub">· ${fmt(r.amount)} · ${esc(r.category)} · day ${r.day}</span></div>
      <button class="icon-btn del" onclick="removeRecurring('${r.id}')">✕</button></div>`).join("") || `<p class="muted">No recurring templates yet.</p>`;
}
async function addRecurring() {
  const category = $("newRecCat").value, amount = parseFloat($("newRecAmount").value), remarks = $("newRecRemarks").value.trim(), day = Math.min(31, Math.max(1, parseInt($("newRecDay").value) || 1));
  if (isNaN(amount)) { toast("Enter an amount", true); return; }
  DATA.recurring.push({ id: uid("r"), category, amount, remarks, day });
  $("newRecAmount").value = ""; $("newRecRemarks").value = ""; $("newRecDay").value = "";
  renderRecurringRows(); await persist();
}
async function removeRecurring(id) { DATA.recurring = DATA.recurring.filter((r) => r.id !== id); renderRecurringRows(); await persist(); }

// staples
function renderStapleManage() {
  $("stapleManage").innerHTML = DATA.staples.map((s, i) => `<span class="chip">${esc(s)} <span class="x" onclick="removeStaple(${i})">✕</span></span>`).join("") || `<p class="muted">No staples yet.</p>`;
}
async function addStaple() {
  const v = $("newStaple").value.trim(); if (!v) return;
  if (!DATA.staples.includes(v)) DATA.staples.push(v);
  $("newStaple").value = ""; renderStapleManage(); renderStapleChips(); await persist();
}
async function removeStaple(i) { DATA.staples.splice(i, 1); renderStapleManage(); renderStapleChips(); await persist(); }

// PIN
function setPin() {
  $("pinNew").value = ""; $("pinConfirm").value = "";
  $("pinModal").classList.remove("hidden");
  setTimeout(() => $("pinNew").focus(), 50);
}
function savePinFromModal() {
  const p = $("pinNew").value.trim(), c = $("pinConfirm").value.trim();
  if (!p) { toast("Enter a PIN", true); return; }
  if (p !== c) { toast("PINs didn't match", true); return; }
  localStorage.setItem("aisman-pin", hashPin(p));
  $("pinStatus").textContent = "PIN is ON for this device.";
  $("pinModal").classList.add("hidden");
  toast("PIN set for this device");
}
function removePin() { localStorage.removeItem("aisman-pin"); $("pinStatus").textContent = "No PIN set on this device."; toast("PIN removed"); }

// backup / restore
async function restoreBackup(e) {
  const file = e.target.files[0]; if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || typeof parsed !== "object" || !parsed.months) throw new Error("bad file");
    DATA = parsed;
    DATA.presets = DATA.presets || []; DATA.recurring = DATA.recurring || []; DATA.staples = DATA.staples || []; DATA.shoppingList = DATA.shoppingList || [];
    const months = Object.keys(DATA.months).sort(); currentMonth = months[months.length - 1];
    buildPickers(); $("settingsOverlay").classList.add("hidden"); render(); await persist(); toast("Backup restored");
  } catch { toast("That doesn't look like a valid backup file", true); }
  e.target.value = "";
}

// ---------- PDF export ----------
function rs(n) { return "Rs " + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 }); }
function fmtDatePdf(iso) { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y.slice(2)}`; }
function exportPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40;
  const ind = [99, 102, 241], dark = [17, 18, 24], gray = [120, 125, 140], green = [16, 150, 110], red = [220, 70, 70];
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
  doc.autoTable({ startY: y + 10, head: [["Month", "Budget", "Spent", "Saved / Over", "Txns"]], body: sumBody, theme: "grid",
    headStyles: { fillColor: ind, textColor: 255, fontStyle: "bold", fontSize: 9.5 }, styles: { fontSize: 9, cellPadding: 6 },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "center" } }, margin: { left: M, right: M },
    didParseCell: (d) => { if (d.section === "body" && d.column.index === 3) { const s = monthStats(months[d.row.index]); d.cell.styles.textColor = s.remaining >= 0 ? green : red; d.cell.styles.fontStyle = "bold"; } } });
  y = doc.lastAutoTable.finalY + 26;
  months.forEach((k) => {
    const m = DATA.months[k], s = monthStats(k);
    if (y > H - 150) { doc.addPage(); y = 50; }
    doc.setFillColor(...ind); doc.roundedRect(M, y, W - 2 * M, 28, 7, 7, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(11.5); doc.text(m.label, M + 14, y + 18);
    doc.setFontSize(9.5); doc.setFont("helvetica", "normal");
    doc.text(`Budget ${rs(s.totalBudget)}   ·   Spent ${rs(s.totalSpent)}   ·   ${s.remaining >= 0 ? "Saved" : "Over"} ${rs(Math.abs(s.remaining))}`, W - M - 14, y + 18, { align: "right" });
    y += 40;
    const catBody = DATA.categories.map((c) => { const b = m.budgets[c] || 0, sp = s.byCat[c] || 0; return [c, rs(b), rs(sp), rs(b - sp), (b ? Math.round(sp / b * 100) : 0) + "%"]; });
    doc.autoTable({ startY: y, head: [["Category", "Budget", "Spent", "Remaining", "Used"]], body: catBody, theme: "striped",
      headStyles: { fillColor: dark, textColor: 255, fontSize: 9 }, styles: { fontSize: 9, cellPadding: 5 },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right", cellWidth: 56 } }, margin: { left: M, right: M },
      didParseCell: (d) => { if (d.section === "body") { const c = DATA.categories[d.row.index], b = m.budgets[c] || 0, sp = s.byCat[c] || 0; if (b && sp > b && d.column.index >= 2) d.cell.styles.textColor = red; } } });
    y = doc.lastAutoTable.finalY + 12;
    if (m.transactions.length) {
      const tx = [...m.transactions].sort((a, b) => a.date.localeCompare(b.date)).map((t) => [fmtDatePdf(t.date), t.category, rs(t.amount), t.remarks || ""]);
      doc.autoTable({ startY: y, head: [["Date", "Category", "Amount", "Remarks"]], body: tx, theme: "grid",
        headStyles: { fillColor: [232, 234, 242], textColor: dark, fontSize: 8.5 }, styles: { fontSize: 8, cellPadding: 4 }, columnStyles: { 2: { halign: "right" } }, margin: { left: M, right: M } });
      y = doc.lastAutoTable.finalY + 26;
    } else { doc.setTextColor(...gray); doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.text("No transactions recorded.", M, y + 6); y += 28; }
  });
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...gray); doc.text(`AisMan Expense Tracker   ·   page ${i} of ${pages}`, W / 2, H - 22, { align: "center" }); }
  doc.save(`AisMan-Expenses-${new Date().toISOString().slice(0, 10)}.pdf`); toast("PDF downloaded");
}

// ---------- Persist ----------
async function persist() {
  setSaveStatus("saving");
  try { const res = await api("/api/data", { method: "POST", body: JSON.stringify(DATA) }); if (!res.ok) throw new Error(); setSaveStatus("saved"); }
  catch { setSaveStatus("error"); toast("Could not save changes", true); }
}

// ---------- Utils ----------
function formatDate(iso) { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y.slice(2)}`; }
function shortLabel(c) { return c.length > 11 ? c.split(" ")[0] : c; }
function hexToRgba(hex, a) { if (!hex || hex[0] !== "#") return `rgba(99,102,241,${a})`; const n = parseInt(hex.slice(1), 16); return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

Object.assign(window, { openModal, deleteTxn, removeCategory, toggleItem, deleteItem, usePreset, removePreset, removeRecurring, removeStaple, addStapleToList, logItemExpense });
boot();
