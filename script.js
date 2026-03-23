var wallpaperSettings = {
  fps: 60,
};

window.wallpaperPropertyListener = {
  applyGeneralProperties: function (properties) {
    if (properties.fps) {
      wallpaperSettings.fps = properties.fps;
    }
  },
  applyUserProperties: function (properties) {
    if (properties.customcolor) {
      var customColor = properties.customcolor.value.split(" ");
      customColor = customColor.map(function (c) {
        return Math.ceil(c * 255);
      });
      var customColorAsCSS = "rgb(" + customColor + ")";
      document.documentElement.style.setProperty(
        "--background-color",
        customColorAsCSS,
      );
    }
  },
};

// ── Obsidian API ──────────────────────────────────────────────
const API_BASE = "http://127.0.0.1:7432";

let medianWakeUp = null; // minutos desde medianoche (mediana 7 días)
let nudgeBedtime = null; // bedtime target con -5min
let todayWakeUp = null; // wake_up real de hoy (si está registrado)
const REFRESH_MS = 5 * 60 * 1000;
const MXN_FMT = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

async function apiFetch(endpoint) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(API_BASE + endpoint, { signal: controller.signal });
    const data = await res.json();
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Time helper (client) ──────────────────────────────────────
function parseTimeToMins(str, nextDayIfEarly = false) {
  if (!str) return null;
  const m = String(str).match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = parseInt(m[2]);
  const period = m[3].toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  const total = h * 60 + min;
  return nextDayIfEarly && h < 6 ? total + 1440 : total;
}

// ── Tasks panel ───────────────────────────────────────────────
async function loadTasks() {
  const data = await apiFetch("/api/today");
  if (data) {
    if (data.wake_up) {
      todayWakeUp = parseTimeToMins(data.wake_up, false);
    }
    renderTasks(data);
  }
}

function renderTasks(data) {
  const container = document.getElementById("tasks-content");
  const dateEl = document.getElementById("tasks-date");
  if (!container) return;

  if (data.day_of_week) dateEl.textContent = data.day_of_week;

  if (!data.found) {
    container.innerHTML = '<p class="loading-msg">Sin nota para hoy</p>';
    return;
  }

  const frag = document.createDocumentFragment();

  for (const section of data.sections) {
    if (!section.tasks.length) continue;

    const heading = document.createElement("p");
    heading.className = "section-heading";
    heading.textContent = section.title;
    frag.appendChild(heading);

    const ul = document.createElement("ul");
    for (const task of section.tasks) {
      const li = document.createElement("li");
      if (task.checked) li.classList.add("task-done");

      const check = document.createElement("span");
      check.className = "task-check";
      check.textContent = task.checked ? "✓" : "·";

      const text = document.createElement("span");
      text.className = "task-text";
      // Limpiar links de Obsidian [[nota]] y [texto](url)
      text.textContent = task.text
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\[\[([^\]]+)\]\]/g, "$1");

      li.appendChild(check);
      li.appendChild(text);
      ul.appendChild(li);
    }
    frag.appendChild(ul);
  }

  container.innerHTML = "";
  container.appendChild(frag);
}

// ── Finance panel ─────────────────────────────────────────────
async function loadFinances() {
  const data = await apiFetch("/api/finances");
  if (data) renderFinances(data);
}

function renderFinances(data) {
  const summaryEl = document.getElementById("finance-summary");
  const categoriesEl = document.getElementById("finance-categories");
  const transactionsEl = document.getElementById("finance-transactions");
  const monthEl = document.getElementById("finance-month");
  if (!summaryEl) return;

  // Mes
  if (data.month) {
    const [y, m] = data.month.split("-");
    const label = new Date(y, m - 1).toLocaleString("es-MX", {
      month: "long",
      year: "numeric",
    });
    monthEl.textContent = label;
  }

  // Resumen: ingreso / gastos / balance
  const stats = [
    {
      label: "Ingresos",
      value: data.income,
      cls: data.income > 0 ? "finance-positive" : "",
    },
    {
      label: "Gastos",
      value: data.expenses,
      cls: data.expenses > 0 ? "finance-negative" : "",
    },
    {
      label: "Balance",
      value: data.balance,
      cls: data.balance >= 0 ? "finance-positive" : "finance-negative",
    },
  ];

  const summaryFrag = document.createDocumentFragment();
  for (const s of stats) {
    const row = document.createElement("div");
    row.className = "finance-stat";
    const lbl = document.createElement("span");
    lbl.className = "finance-stat-label";
    lbl.textContent = s.label;
    const val = document.createElement("span");
    val.className = `finance-stat-value ${s.cls}`.trim();
    val.textContent = MXN_FMT.format(s.value);
    row.appendChild(lbl);
    row.appendChild(val);
    summaryFrag.appendChild(row);
  }
  summaryEl.innerHTML = "";
  summaryEl.appendChild(summaryFrag);

  // Categorías — barchart
  const cats = Object.entries(data.by_category).sort((a, b) => b[1] - a[1]);
  const maxAmt = cats[0]?.[1] || 1;
  const catFrag = document.createDocumentFragment();

  for (const [cat, amount] of cats) {
    const row = document.createElement("div");
    row.className = "cat-row";

    const lbl = document.createElement("span");
    lbl.className = "cat-label";
    lbl.textContent = cat;

    const track = document.createElement("div");
    track.className = "cat-bar-track";
    const bar = document.createElement("div");
    bar.className = "cat-bar";
    bar.style.width = `${(amount / maxAmt) * 100}%`;
    track.appendChild(bar);

    const amt = document.createElement("span");
    amt.className = "cat-amount";
    amt.textContent = MXN_FMT.format(amount);

    row.appendChild(lbl);
    row.appendChild(track);
    row.appendChild(amt);
    catFrag.appendChild(row);
  }
  categoriesEl.innerHTML = "";
  categoriesEl.appendChild(catFrag);

  // Últimas 5 transacciones
  const txFrag = document.createDocumentFragment();
  for (const tx of data.transactions) {
    const row = document.createElement("div");
    row.className = "tx-row";

    const info = document.createElement("span");
    info.className = "tx-info";
    info.textContent = tx.title;

    const amt = document.createElement("span");
    amt.className = `tx-amount ${tx.type === "income" ? "finance-positive" : "finance-negative"}`;
    amt.textContent =
      (tx.type === "income" ? "+" : "-") + MXN_FMT.format(tx.amount);

    row.appendChild(info);
    row.appendChild(amt);
    txFrag.appendChild(row);
  }
  transactionsEl.innerHTML = "";
  transactionsEl.appendChild(txFrag);
}

// ── Life in Weeks ─────────────────────────────────────────────
function renderLifeWeeks() {
  const BIRTH = new Date("2002-04-04");
  const TOTAL_YEARS = 90;
  const COLS = 52;
  const CELL = 10;
  const GAP = 2;
  const STEP = CELL + GAP;
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
  const now = new Date();

  let yearOfLife = now.getFullYear() - BIRTH.getFullYear();
  const birthdayThisYear = new Date(
    now.getFullYear(),
    BIRTH.getMonth(),
    BIRTH.getDate(),
  );
  if (now < birthdayThisYear) yearOfLife--;

  const yearStart = new Date(
    BIRTH.getFullYear() + yearOfLife,
    BIRTH.getMonth(),
    BIRTH.getDate(),
  );
  const weekInYear = Math.floor((now - yearStart) / MS_PER_WEEK);
  const currentCell = yearOfLife * COLS + weekInYear;

  const W = COLS * CELL + (COLS - 1) * GAP;
  const H = TOTAL_YEARS * CELL + (TOTAL_YEARS - 1) * GAP;
  const TOTAL_WEEKS = TOTAL_YEARS * COLS;

  const container = document.getElementById("weeks-grid");
  if (!container) return;

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");

  for (let i = 0; i < TOTAL_WEEKS; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x", col * STEP);
    rect.setAttribute("y", row * STEP);
    rect.setAttribute("width", CELL);
    rect.setAttribute("height", CELL);
    rect.setAttribute("rx", 1);
    if (i < currentCell) rect.setAttribute("class", "past");
    else if (i === currentCell) rect.setAttribute("class", "current");
    svg.appendChild(rect);
  }

  container.innerHTML = "";
  container.appendChild(svg);
}

renderLifeWeeks();

// ── Clock ─────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  document.getElementById("clock-time").textContent = `${h}:${m}`;

  // Date
  const dateEl = document.getElementById("clock-date");
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }

  // Day progress pill
  const fill = document.getElementById("clock-day-fill");
  const dayPct = document.getElementById("clock-day-pct");
  if (fill) {
    const mins = now.getHours() * 60 + now.getMinutes();
    const wake = todayWakeUp ?? medianWakeUp;
    const bed = nudgeBedtime;

    // Fill % — necesita wake
    let pct;
    if (wake !== null && bed !== null) {
      const total = bed - wake;
      const elapsed = mins < wake ? mins + 1440 - wake : mins - wake;
      pct = Math.round(Math.min(Math.max(elapsed / total, 0), 1) * 100);
    } else {
      pct = Math.round(((mins % 720) / 720) * 100);
    }
    fill.style.setProperty("--fill", pct + "%");
    if (dayPct) dayPct.textContent = pct + "%";

    // Color — solo necesita bed
    if (bed !== null) {
      const minsNorm = mins < 6 * 60 ? mins + 1440 : mins;
      const remaining = bed - minsNorm;
      if (remaining <= 0) {
        fill.style.background = "var(--danger)";
      } else if (remaining <= 120) {
        fill.style.background = "var(--blue-night)";
      } else {
        fill.style.background = "var(--muted)";
      }
    } else {
      fill.style.background = "var(--muted)";
    }
  }
}

updateClock();
setInterval(updateClock, 1000);

// ── Bitcoin price ─────────────────────────────────────────────
const USD_FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const BTC_REFRESH_MS = 60 * 1000;

async function loadBTC() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      { signal: controller.signal },
    );
    const data = await res.json();
    const price = data?.bitcoin?.usd;
    if (!price) return;

    document.getElementById("btc-price").textContent = USD_FMT.format(price);
    document.getElementById("btc-updated").textContent =
      new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
  } catch {
    // silently fail — keeps last value on screen
  } finally {
    clearTimeout(timeout);
  }
}

// ── Stat Chart (monthly line) ─────────────────────────────────
const STAT_CHART_CONFIG = {
  exercise: { label: "Exercise", color: "var(--accent)", max: 5 },
  energy: { label: "Energy", color: "#c4a45a", max: 5 },
  mood: { label: "Mood", color: "var(--blue-night)", max: 5 },
  stress: { label: "Stress", color: "var(--danger)", max: 5 },
  focus: { label: "Focus", color: "var(--muted)", max: 5 },
  sleep_score: { label: "Sleep Score", color: "#7b9dd4", max: 100 },
};

let statHistoryData = null;
let activeStatField = "mood";

async function loadStatHistory() {
  const data = await apiFetch("/api/stat-history");
  if (data) {
    statHistoryData = data;
    renderStatChart();
  }
}

function renderStatChart() {
  const wrap = document.getElementById("stat-chart-wrap");
  if (!wrap || !statHistoryData) return;

  const config = STAT_CHART_CONFIG[activeStatField];

  const values = statHistoryData.fields[activeStatField];
  const days = statHistoryData.daysInMonth;
  const maxVal = config.max;
  const today = new Date().getDate();

  // SVG dimensions from container
  const rect = wrap.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;
  if (W === 0 || H === 0) return;
  const PAD_B = H * 0.1;
  const plotW = W;
  const plotH = H - PAD_B;

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  // Resolve CSS variable colors
  const tempEl = document.createElement("div");
  tempEl.style.color = config.color;
  document.body.appendChild(tempEl);
  const resolvedColor = getComputedStyle(tempEl).color;
  document.body.removeChild(tempEl);

  // Y-axis grid lines
  const ySteps = maxVal <= 5 ? maxVal : 5;
  for (let i = 0; i <= ySteps; i++) {
    const y = plotH - (i / ySteps) * plotH;

    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", 0);
    line.setAttribute("x2", W);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    line.setAttribute("stroke", "rgba(245,239,213,0.08)");
    line.setAttribute("stroke-width", "0.5");
    svg.appendChild(line);
  }

  // X-axis day labels
  const fontSize = 16;
  for (let d = 1; d <= days; d++) {
    if (d % 5 === 0 || d === 1) {
      const x = ((d - 1) / (days - 1)) * plotW;
      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", x);
      label.setAttribute("y", H - fontSize * 0.3);
      label.setAttribute("text-anchor", "middle");
      label.style.cssText = `font-size:${fontSize}px;font-family:JetBrains Mono,monospace;fill:rgba(245,239,213,0.35)`;
      label.textContent = d;
      svg.appendChild(label);
    }
  }

  // Build points for the line (skip nulls)
  const points = [];
  for (let d = 0; d < days; d++) {
    if (values[d] == null || d + 1 > today) continue;
    const x = (d / (days - 1)) * plotW;
    const y = plotH - (values[d] / maxVal) * plotH;
    points.push({ x, y, val: values[d], day: d + 1 });
  }

  if (points.length > 1) {
    // Area fill
    const areaPath = document.createElementNS(ns, "path");
    const baseY = plotH;
    let areaD = `M${points[0].x},${baseY} L${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++)
      areaD += ` L${points[i].x},${points[i].y}`;
    areaD += ` L${points[points.length - 1].x},${baseY} Z`;
    areaPath.setAttribute("d", areaD);
    areaPath.setAttribute("fill", resolvedColor);
    areaPath.setAttribute("opacity", "0.08");
    svg.appendChild(areaPath);

    // Line
    const linePath = document.createElementNS(ns, "path");
    let lineD = `M${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++)
      lineD += ` L${points[i].x},${points[i].y}`;
    linePath.setAttribute("d", lineD);
    linePath.setAttribute("fill", "none");
    linePath.setAttribute("stroke", resolvedColor);
    linePath.setAttribute("stroke-width", Math.max(1, W * 0.003));
    linePath.setAttribute("stroke-linejoin", "round");
    linePath.setAttribute("stroke-linecap", "round");
    svg.appendChild(linePath);
  }

  // Dots
  for (const pt of points) {
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", pt.x);
    circle.setAttribute("cy", pt.y);
    const dotR = Math.max(1.5, W * 0.004);
    circle.setAttribute("r", pt.day === today ? dotR * 1.5 : dotR);
    circle.setAttribute("fill", resolvedColor);
    if (pt.day === today) circle.setAttribute("opacity", "1");
    else circle.setAttribute("opacity", "0.6");
    svg.appendChild(circle);
  }

  wrap.innerHTML = "";
  wrap.appendChild(svg);
}

// Make stat pills clickable
document.querySelectorAll(".stat-pill").forEach((pill) => {
  pill.style.cursor = "pointer";
  pill.addEventListener("click", () => {
    const field = pill.dataset.field;
    if (!field || !STAT_CHART_CONFIG[field]) return;
    activeStatField = field;
    // Update active class
    document
      .querySelectorAll(".stat-pill")
      .forEach((p) => p.classList.remove("stat-pill--active"));
    pill.classList.add("stat-pill--active");
    renderStatChart();
  });
});

// Set initial active pill
const initialPill = document.querySelector('.stat-pill[data-field="mood"]');
if (initialPill) initialPill.classList.add("stat-pill--active");

// ── Stats pills ───────────────────────────────────────────────
async function loadStats() {
  const data = await apiFetch("/api/stats");
  if (data) {
    medianWakeUp = data.medianWakeUp ?? null;
    nudgeBedtime = data.nudgeBedtime ?? null;
    renderStats(data);
  }
}

function renderStats(data) {
  document.querySelectorAll(".stat-pill").forEach((pill) => {
    const field = pill.dataset.field;
    const avg = data.averages?.[field];
    const max = data.max?.[field];
    if (avg == null || !max) return;
    const pct = Math.min(100, Math.round((avg / max) * 100));
    pill.querySelector(".pill-fill").style.setProperty("--fill", pct + "%");
    pill.querySelector(".pill-pct").textContent = pct + "%";
  });
}

// ── Streaks ───────────────────────────────────────────────────
const STREAK_CONFIG = [
  { field: "daily_commit", label: "Commit" },
  { field: "algo_practice", label: "Algorithm" },
  { field: "english_practice", label: "English" },
  { field: "reading", label: "Reading" },
];

async function loadStreaks() {
  const data = await apiFetch("/api/streaks");
  if (data) renderStreaks(data);
}

function renderStreaks(data) {
  const panel = document.getElementById("streaks-panel");
  if (!panel) return;

  const firstItem = Object.values(data)[0];
  const COLS = firstItem?.history.length || 15;
  const today = new Date();

  const frag = document.createDocumentFragment();

  // Grid columns: label col + N cell cols
  panel.style.gridTemplateColumns = `auto repeat(${COLS}, 1fr)`;

  // Header: empty label spacer + day-number cells
  const spacer = document.createElement("div");
  spacer.className = "streak-label-col";
  frag.appendChild(spacer);

  for (let i = 0; i < COLS; i++) {
    const daysAgo = COLS - 1 - i;
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    const dayNum = d.getDate();
    const cell = document.createElement("span");
    cell.className = "streak-day-label";
    if (dayNum % 5 === 0) cell.textContent = dayNum;
    frag.appendChild(cell);
  }

  // Data rows — flat grid items (label-col + N cells per row)
  for (const { field, label } of STREAK_CONFIG) {
    const item = data[field];
    if (!item) continue;

    const labelCol = document.createElement("div");
    labelCol.className = "streak-label-col";

    const nameEl = document.createElement("span");
    nameEl.className = "streak-name";
    nameEl.textContent = label;

    const countEl = document.createElement("span");
    countEl.className = "streak-count";
    countEl.textContent = item.streak;

    labelCol.appendChild(nameEl);
    labelCol.appendChild(countEl);
    frag.appendChild(labelCol);

    const lastIdx = item.history.length - 1;
    item.history.forEach((val, colIdx) => {
      const cell = document.createElement("span");
      cell.className = "streak-cell";
      const isPendingToday = item.pending && colIdx === lastIdx;
      if (isPendingToday) cell.classList.add("streak-cell--pending");
      else if (val === true) cell.classList.add("streak-cell--done");
      else if (val === false) cell.classList.add("streak-cell--miss");
      else cell.classList.add("streak-cell--empty");
      frag.appendChild(cell);
    });
  }

  panel.innerHTML = "";
  panel.appendChild(frag);
}

// ── Calendar ──────────────────────────────────────────────────
let calendarEvents = [];

async function loadCalendar() {
  const data = await apiFetch("/api/calendar");
  if (data) renderCalendar(data);
}

function renderCalendar(data) {
  const content = document.getElementById("cal-content");
  const statusEl = document.getElementById("cal-status");
  if (!content) return;

  if (data.error === "not_authorized") {
    content.innerHTML =
      '<p class="cal-auth-hint">Open localhost:7432/auth/google to connect</p>';
    return;
  }

  const byDay = data.byDay || {};

  // Flatten all events for renderNextEvent (today + future)
  calendarEvents = Object.values(byDay).flat();
  renderNextEvent();

  const dayKeys = Object.keys(byDay).sort();
  if (dayKeys.length === 0) {
    content.innerHTML = '<p class="loading-msg">No events</p>';
    if (statusEl) statusEl.textContent = "3 days";
    return;
  }

  if (statusEl) statusEl.textContent = "3 days";

  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const tom = new Date(today);
  tom.setDate(tom.getDate() + 1);
  const tomKey = tom.toISOString().slice(0, 10);

  function dayLabel(key) {
    if (key === todayKey) return "Today";
    if (key === tomKey) return "Tomorrow";
    return new Date(key + "T12:00:00").toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }

  const frag = document.createDocumentFragment();
  for (const key of dayKeys) {
    const heading = document.createElement("p");
    heading.className = "cal-day-heading";
    heading.textContent = dayLabel(key);
    frag.appendChild(heading);

    for (const event of byDay[key]) {
      const row = document.createElement("div");
      row.className = "cal-event";

      const timeEl = document.createElement("span");
      timeEl.className = "cal-event-time";
      timeEl.textContent = event.allDay
        ? "All day"
        : new Date(event.start).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          });

      const titleEl = document.createElement("span");
      titleEl.className = "cal-event-title";
      titleEl.textContent = event.title;

      row.appendChild(timeEl);
      row.appendChild(titleEl);
      frag.appendChild(row);
    }
  }

  content.innerHTML = "";
  content.appendChild(frag);
}

function renderNextEvent() {
  const titleEl = document.getElementById("next-event-title");
  const etaEl = document.getElementById("next-event-eta");
  const wrapEl = document.getElementById("next-event");
  const barWrapEl = document.getElementById("next-event-bar-wrap");
  const barFillEl = document.getElementById("next-event-bar-fill");
  if (!titleEl) return;

  const now = Date.now();
  const next = calendarEvents
    .filter((e) => !e.allDay && new Date(e.end).getTime() > now)
    .sort((a, b) => new Date(a.start) - new Date(b.start))[0];

  if (!next) {
    wrapEl.hidden = true;
    barWrapEl.hidden = true;
    return;
  }

  const startMs = new Date(next.start).getTime();
  const diffMs = startMs - now;
  const diffMin = Math.round(diffMs / 60000);
  const WINDOW = 60 * 60000;

  let eta;
  if (diffMs <= 0) eta = "now";
  else if (diffMin < 60) eta = `in ${diffMin}m`;
  else eta = `in ${Math.floor(diffMin / 60)}h ${diffMin % 60}m`;

  const fill =
    diffMs <= 0 ? 100 : Math.max(0, Math.round((1 - diffMs / WINDOW) * 100));
  const urgent = diffMin <= 10 && diffMs > 0;

  titleEl.textContent = next.title;
  etaEl.textContent = eta;
  wrapEl.hidden = false;
  wrapEl.classList.toggle("urgent", urgent);

  barWrapEl.hidden = fill <= 0;
  barFillEl.style.width = fill + "%";
  barFillEl.classList.toggle("urgent", urgent);
}

// ── Sleep Tracker ─────────────────────────────────────────────
async function loadSleepTracker() {
  const data = await apiFetch("/api/sleep-tracker");
  if (data) renderSleepTracker(data);
}

function getSleepCells(bedtime, wakeUp, hours) {
  if (bedtime === null || wakeUp === null) return hours.map(() => false);
  const bedNorm = bedtime < 18 * 60 ? bedtime + 1440 : bedtime;
  const wakeNorm = wakeUp < 18 * 60 ? wakeUp + 1440 : wakeUp;
  return hours.map((h) => {
    const hNorm = h < 18 ? h + 24 : h;
    const hStart = hNorm * 60;
    const hEnd = (hNorm + 1) * 60;
    return bedNorm < hEnd && wakeNorm > hStart;
  });
}

function renderSleepTracker(data) {
  const container = document.querySelector(".weeks-left");
  if (!container) return;

  const today = new Date().getDate();

  // Compute dynamic hour range from actual sleep data
  let minBedNorm = Infinity;
  let maxWakeNorm = -Infinity;

  for (const day of data.days) {
    if (day.bedtime !== null && day.wakeUp !== null) {
      const bedNorm = day.bedtime < 18 * 60 ? day.bedtime + 1440 : day.bedtime;
      const wakeNorm = day.wakeUp < 18 * 60 ? day.wakeUp + 1440 : day.wakeUp;
      if (bedNorm < minBedNorm) minBedNorm = bedNorm;
      if (wakeNorm > maxWakeNorm) maxWakeNorm = wakeNorm;
    }
  }

  // Fallback if no data yet
  if (minBedNorm === Infinity) {
    minBedNorm = 1440;
    maxWakeNorm = 1920;
  }

  // Build hours array with 1h padding on each side
  const startH = Math.floor(minBedNorm / 60) - 1;
  const endH = Math.floor(maxWakeNorm / 60) + 1;
  const sleepHours = [];
  for (let h = startH; h <= endH; h++) {
    sleepHours.push(((h % 24) + 24) % 24);
  }

  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const DAY_NAMES = ["S", "M", "T", "W", "T", "F", "S"];

  const frag = document.createDocumentFragment();

  const title = document.createElement("h2");
  title.className = "panel-title";
  title.textContent = "Sleep ";
  const monthSpan = document.createElement("span");
  monthSpan.className = "panel-status";
  monthSpan.textContent = MONTHS[data.month - 1];
  title.appendChild(monthSpan);
  frag.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "sleep-grid";
  grid.style.gridTemplateColumns = `auto repeat(${sleepHours.length}, 1fr)`;
  grid.style.gridTemplateRows = `auto repeat(${data.daysInMonth}, 1fr)`;

  // Header row
  const corner = document.createElement("span");
  corner.className = "sleep-header";
  grid.appendChild(corner);

  for (const h of sleepHours) {
    const hdr = document.createElement("span");
    hdr.className = "sleep-header";
    hdr.textContent = h;
    grid.appendChild(hdr);
  }

  // Day rows
  for (const day of data.days) {
    const d = new Date(day.date + "T12:00:00");
    const label = document.createElement("span");
    label.className = "sleep-day-label";
    label.textContent = `${DAY_NAMES[d.getDay()]} ${day.day}`;
    if (day.day > today) label.style.opacity = "0.15";
    grid.appendChild(label);

    const sleeping = getSleepCells(day.bedtime, day.wakeUp, sleepHours);
    for (let i = 0; i < sleepHours.length; i++) {
      const cell = document.createElement("span");
      cell.className = "sleep-cell";
      if (day.day > today) cell.classList.add("sleep-cell--future");
      else if (sleeping[i]) cell.classList.add("sleep-cell--filled");
      else if (day.bedtime !== null) cell.classList.add("sleep-cell--empty");
      else cell.classList.add("sleep-cell--nodata");
      grid.appendChild(cell);
    }
  }

  frag.appendChild(grid);
  container.innerHTML = "";
  container.appendChild(frag);
}

// ── Polling ───────────────────────────────────────────────────
function refreshAll() {
  loadTasks();
  loadFinances();
  loadStats();
  loadCalendar();
  loadStreaks();
  loadSleepTracker();
}

refreshAll();
setInterval(refreshAll, REFRESH_MS);

loadBTC();
setInterval(loadBTC, BTC_REFRESH_MS);
loadStatHistory();
setInterval(loadStatHistory, REFRESH_MS);
setInterval(renderNextEvent, 30_000);

// ── Pomodoro ─────────────────────────────────────────────────
const POMO_SECS = { work: 25 * 60, short: 5 * 60, long: 15 * 60 };
const POMO_LABEL = { work: "Work", short: "Break", long: "Long Break" };

let pomoPhase = "work";
let pomoLeft = POMO_SECS.work;
let pomoRunning = false;
let pomoSession = 0;
let pomoTimer = null;

function pomoTick() {
  pomoLeft--;
  if (pomoLeft <= 0) {
    clearInterval(pomoTimer);
    pomoTimer = null;
    pomoRunning = false;
    if (pomoPhase === "work") {
      pomoSession++;
      pomoPhase = pomoSession % 4 === 0 ? "long" : "short";
    } else {
      pomoPhase = "work";
    }
    pomoLeft = POMO_SECS[pomoPhase];
  }
  renderPomo();
}

function pomoToggle() {
  if (pomoRunning) {
    clearInterval(pomoTimer);
    pomoTimer = null;
    pomoRunning = false;
  } else {
    pomoTimer = setInterval(pomoTick, 1000);
    pomoRunning = true;
  }
  renderPomo();
}

function pomoReset() {
  clearInterval(pomoTimer);
  pomoTimer = null;
  pomoRunning = false;
  pomoPhase = "work";
  pomoLeft = POMO_SECS.work;
  pomoSession = 0;
  renderPomo();
}

function renderPomo() {
  const m = String(Math.floor(pomoLeft / 60)).padStart(2, "0");
  const s = String(pomoLeft % 60).padStart(2, "0");
  document.getElementById("pomo-countdown").textContent = `${m}:${s}`;
  document.getElementById("pomo-phase").textContent = POMO_LABEL[pomoPhase];
  const dot = document.getElementById("pomo-dot");
  dot.style.opacity = pomoRunning ? "1" : "0.3";
  dot.style.background =
    pomoPhase === "work" ? "var(--accent)" : "var(--blue-night)";
  const total = POMO_SECS[pomoPhase];
  const pct = ((1 - pomoLeft / total) * 100).toFixed(2);
  const pomoColor =
    pomoPhase === "work" ? "var(--accent)" : "var(--blue-night)";
  clockFaceEl.style.setProperty("--pomo-fill", pct + "%");
  clockFaceEl.style.setProperty("--pomo-color", pomoColor);
}

let pomoClickTimer = null;
const clockFaceEl = document.querySelector(".clock-face");

clockFaceEl.addEventListener("click", () => {
  if (pomoClickTimer) {
    clearTimeout(pomoClickTimer);
    pomoClickTimer = null;
    pomoReset();
  } else {
    pomoClickTimer = setTimeout(() => {
      pomoClickTimer = null;
      pomoToggle();
    }, 300);
  }
});

renderPomo();
