const http = require("http");
const https = require("https");
const fs = require("fs/promises");
const path = require("path");
const { URL } = require("url");

// ── Configuración ─────────────────────────────────────────────
const VAULT_PATH = "C:\\Users\\maria\\Brain";
const JOURNAL_DIR = path.join(VAULT_PATH, "areas", "Personal", "Journal");
const FINANCE_DIR = path.join(VAULT_PATH, "areas", "Finances", "transactions");
const PORT = 7432;

// ── YAML frontmatter parser ───────────────────────────────────
// Lee líneas entre los dos `---` del inicio del archivo.
// Soporta strings, números, booleanos y listas simples.
function parseYAML(content) {
  const lines = content.split("\n");
  const result = {};

  if (lines[0].trim() !== "---") return result;

  let i = 1;
  let lastKey = null;

  while (i < lines.length && lines[i].trim() !== "---") {
    const line = lines[i];

    // Item de lista: "  - valor"
    if (/^\s+-\s*(.*)$/.test(line)) {
      const val = line.match(/^\s+-\s*(.*)$/)[1].trim();
      if (lastKey && Array.isArray(result[lastKey])) {
        if (val !== "") result[lastKey].push(castValue(val));
      }
      i++;
      continue;
    }

    // Par clave: valor
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    const raw = line.slice(colonIdx + 1).trim();
    lastKey = key;

    if (raw === "" || raw === null) {
      result[key] = []; // inicio de lista
    } else {
      // Quitar comillas
      const clean = raw.replace(/^["']|["']$/g, "");
      result[key] = castValue(clean);
    }

    i++;
  }

  return result;
}

function castValue(val) {
  if (val === "true") return true;
  if (val === "false") return false;
  const n = Number(val);
  if (!isNaN(n) && val !== "") return n;
  return val;
}

// Devuelve { yaml, bodyLines[] } — bodyLines es el texto después del segundo ---
function splitFrontmatter(content) {
  const lines = content.split("\n");
  if (lines[0].trim() !== "---") return { yaml: {}, bodyLines: lines };

  let end = 1;
  while (end < lines.length && lines[end].trim() !== "---") end++;

  return {
    yaml: parseYAML(content),
    bodyLines: lines.slice(end + 1),
  };
}

// ── Task extractor ────────────────────────────────────────────
// Agrupa checkboxes markdown por sección `##`.
// Subsecciones `###` se tratan como tareas planas bajo la sección padre.
function extractTasks(bodyLines) {
  const sections = [];
  let current = null;
  const TASK_RE = /^- \[([ xX])\] (.+)$/;
  const H2_RE = /^## (.+)$/;
  const H3_RE = /^### (.+)$/;

  for (const line of bodyLines) {
    const h2 = line.match(H2_RE);
    if (h2) {
      if (current && current.tasks.length > 0) sections.push(current);
      current = { title: h2[1].trim(), tasks: [] };
      continue;
    }

    // H3 no crea nueva sección, solo es un subtítulo visual — lo ignoramos
    if (H3_RE.test(line)) continue;

    const task = line.match(TASK_RE);
    if (task && current) {
      current.tasks.push({
        checked: task[1].toLowerCase() === "x",
        text: task[2].trim(),
      });
    }
  }

  if (current && current.tasks.length > 0) sections.push(current);
  return sections;
}

// ── Helpers de fecha ──────────────────────────────────────────
function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function currentMonth() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// ── Helpers de tiempo ─────────────────────────────────────────
// Parsea "11:00 AM" / "2:15 AM" → minutos desde medianoche
// bedtime con h < 6 → siguiente día (+1440)
function parseTimeMinutes(str, nextDayIfEarly = false) {
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

// Mediana de un array de números
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// Mediana ponderada — values y weights son arrays paralelos
// Pesos de recencia: índice 0 = día más antiguo, 6 = más reciente
const RECENCY_WEIGHTS = [1.0, 1.2, 1.5, 2.0, 2.5, 3.5, 4.5];

function weightedMedian(values, weights) {
  if (!values.length) return null;
  const pairs = values.map((v, i) => ({ v, w: weights[i] })).sort((a, b) => a.v - b.v);
  const totalWeight = pairs.reduce((s, p) => s + p.w, 0);
  let cumWeight = 0;
  for (const pair of pairs) {
    cumWeight += pair.w;
    if (cumWeight >= totalWeight / 2) return pair.v;
  }
  return pairs[pairs.length - 1].v;
}

// ── Google Calendar ───────────────────────────────────────────
const GOOGLE_CRED_FILE = path.join(
  __dirname,
  "client_secret_981571995116-q0nmotn597t1rju6380kmnuas58evis1.apps.googleusercontent.com.json"
);
const TOKEN_FILE = path.join(__dirname, "token.json");
const REDIRECT_URI = `http://localhost:${PORT}/auth/callback`;
const GCAL_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

let _googleCreds = null;
let _googleToken = null;

async function loadGoogleCreds() {
  if (_googleCreds) return _googleCreds;
  const raw = await fs.readFile(GOOGLE_CRED_FILE, "utf8");
  _googleCreds = JSON.parse(raw).installed;
  return _googleCreds;
}

async function loadGoogleToken() {
  if (_googleToken) return _googleToken;
  try {
    const raw = await fs.readFile(TOKEN_FILE, "utf8");
    _googleToken = JSON.parse(raw);
    return _googleToken;
  } catch {
    return null;
  }
}

async function saveGoogleToken(token) {
  _googleToken = token;
  await fs.writeFile(TOKEN_FILE, JSON.stringify(token, null, 2));
}

function httpsPost(url, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname, method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded",
                   "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(url, accessToken) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function getAccessToken() {
  const creds = await loadGoogleCreds();
  const token = await loadGoogleToken();
  if (!token?.refresh_token) return null;

  // Reuse existing access token if still valid
  if (token.access_token && token.expiry_date && Date.now() < token.expiry_date - 60000) {
    return token.access_token;
  }

  // Refresh
  const result = await httpsPost("https://oauth2.googleapis.com/token", {
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: token.refresh_token,
    grant_type: "refresh_token",
  });

  if (!result.access_token) return null;

  await saveGoogleToken({
    ...token,
    access_token: result.access_token,
    expiry_date: Date.now() + result.expires_in * 1000,
  });
  return result.access_token;
}

async function handleCalendar() {
  const accessToken = await getAccessToken();
  if (!accessToken) return { error: "not_authorized", events: [] };

  const now = new Date();
  const endOfPeriod = new Date(now);
  endOfPeriod.setDate(endOfPeriod.getDate() + 2);
  endOfPeriod.setHours(23, 59, 59, 999);

  const apiUrl = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events"
  );
  apiUrl.searchParams.set("timeMin", now.toISOString());
  apiUrl.searchParams.set("timeMax", endOfPeriod.toISOString());
  apiUrl.searchParams.set("orderBy", "startTime");
  apiUrl.searchParams.set("singleEvents", "true");
  apiUrl.searchParams.set("maxResults", "30");

  const data = await httpsGet(apiUrl.toString(), accessToken);

  // Group events by local date string (YYYY-MM-DD)
  const byDay = {};
  for (const e of data.items || []) {
    const start = e.start?.dateTime || e.start?.date;
    const dateKey = start ? start.slice(0, 10) : null;
    if (!dateKey) continue;
    if (!byDay[dateKey]) byDay[dateKey] = [];
    byDay[dateKey].push({
      id: e.id,
      title: e.summary || "(No title)",
      start,
      end: e.end?.dateTime || e.end?.date,
      allDay: !e.start?.dateTime,
      location: e.location || null,
    });
  }

  return { byDay };
}

async function handleAuthGoogle(res) {
  const creds = await loadGoogleCreds();
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", creds.client_id);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GCAL_SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  res.writeHead(302, { Location: authUrl.toString() });
  res.end();
}

async function handleAuthCallback(urlObj, res) {
  const code = urlObj.searchParams.get("code");
  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>Error: no authorization code received</h2>");
    return;
  }

  const creds = await loadGoogleCreds();
  const result = await httpsPost("https://oauth2.googleapis.com/token", {
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    code,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });

  if (!result.refresh_token) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h2>Error: no refresh token</h2><pre>${JSON.stringify(result, null, 2)}</pre>`);
    return;
  }

  await saveGoogleToken({
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    expiry_date: Date.now() + result.expires_in * 1000,
  });

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    `<h2 style="font-family:monospace;padding:2rem">Google Calendar authorized!<br>
    <small style="font-size:.7em;opacity:.6">You can close this tab.</small></h2>`
  );
}

// ── Rutas ─────────────────────────────────────────────────────

async function handleStats() {
  const FIELDS = ["mood", "energy", "focus", "stress", "exercise"];
  const MAX_VALUES = { mood: 5, energy: 5, focus: 5, stress: 5, exercise: 5, sleep_score: 100 };
  const IDEAL_BED_MINS = 1350; // 10:30 PM
  const BED_MAX_DEV = 180;     // 3h tolerance window for sleep score
  const NUDGE_ALPHA = 0.08;    // convergence rate (~2 months at ~70% adherence)
  const NUDGE_GRACE = 10;      // minutes — within this range, target = ideal (no pressure)

  const all = await fs.readdir(JOURNAL_DIR);
  const files = all
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .slice(-7);

  const sums = {};
  const counts = {};
  const wakeMinutes = [];
  const bedEntries = []; // { mins, weight } — tracks recency per entry
  const sleepDayScores = [];

  for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
    const content = await fs.readFile(path.join(JOURNAL_DIR, files[fileIdx]), "utf8");
    const { yaml } = splitFrontmatter(content);

    for (const field of FIELDS) {
      if (typeof yaml[field] === "number") {
        sums[field] = (sums[field] || 0) + yaml[field];
        counts[field] = (counts[field] || 0) + 1;
      }
    }

    const wMins = parseTimeMinutes(yaml.wake_up, false);
    const bMins = parseTimeMinutes(yaml.bedtime, true);

    if (wMins !== null) wakeMinutes.push(wMins);

    if (bMins !== null) {
      // Map file position to recency weight (oldest file → lowest weight)
      const weightIdx = RECENCY_WEIGHTS.length - files.length + fileIdx;
      bedEntries.push({ mins: bMins, weight: RECENCY_WEIGHTS[Math.max(0, weightIdx)] });
    }

    if (wMins !== null && bMins !== null) {
      const hours = (wMins + 1440 - bMins) / 60;
      const durScore = Math.min(hours / 8, 1);
      const timePenalty = Math.max(0, bMins - IDEAL_BED_MINS) / BED_MAX_DEV;
      const timeScore = Math.max(0, 1 - timePenalty);
      sleepDayScores.push(0.6 * durScore + 0.4 * timeScore);
    }
  }

  const averages = {};
  for (const field of FIELDS) {
    averages[field] = counts[field]
      ? Math.round((sums[field] / counts[field]) * 10) / 10
      : null;
  }

  if (sleepDayScores.length > 0) {
    const avg = sleepDayScores.reduce((a, b) => a + b, 0) / sleepDayScores.length;
    averages.sleep_score = Math.round(avg * 1000) / 10;
  }

  const medWake = median(wakeMinutes);
  const medBed = median(bedEntries.map((e) => e.mins));
  const weightedMedBed = weightedMedian(
    bedEntries.map((e) => e.mins),
    bedEntries.map((e) => e.weight)
  );

  // Nudge: proportional to distance, with grace zone near ideal
  let nudgeBedtime = null;
  let distanceToIdeal = null;
  if (weightedMedBed !== null) {
    distanceToIdeal = weightedMedBed - IDEAL_BED_MINS;
    nudgeBedtime =
      distanceToIdeal <= NUDGE_GRACE
        ? IDEAL_BED_MINS
        : Math.round(weightedMedBed - Math.max(3, distanceToIdeal * NUDGE_ALPHA));
  }

  return {
    days: files.length,
    averages,
    max: MAX_VALUES,
    medianWakeUp: medWake,
    medianBedtime: medBed,
    weightedMedianBed: weightedMedBed,
    distanceToIdeal,
    nudgeBedtime,
  };
}

async function handleToday() {
  const date = todayISO();
  const filePath = path.join(JOURNAL_DIR, `${date}.md`);

  try {
    await fs.access(filePath);
  } catch {
    return { found: false, date };
  }

  const content = await fs.readFile(filePath, "utf8");
  const { yaml, bodyLines } = splitFrontmatter(content);
  const sections = extractTasks(bodyLines);

  return {
    found: true,
    date,
    day_of_week: yaml.day_of_week ?? null,
    week_number: yaml.week_number ?? null,
    wake_up: yaml.wake_up || null,
    sections,
  };
}

async function handleFinances(month) {
  month = month || currentMonth();

  let files;
  try {
    const all = await fs.readdir(FINANCE_DIR);
    files = all.filter((f) => f.endsWith(".md") && f.startsWith(`${month}-`));
  } catch {
    files = [];
  }

  let income = 0;
  let expenses = 0;
  const byCategory = {};
  const transactions = [];

  for (const file of files) {
    const content = await fs.readFile(path.join(FINANCE_DIR, file), "utf8");
    const { yaml } = splitFrontmatter(content);

    const amount = Number(yaml.amount) || 0;
    const type = yaml.type;

    if (type === "income") {
      income += amount;
    } else if (type === "expense") {
      expenses += amount;
      const cat = yaml.category || "other";
      byCategory[cat] = (byCategory[cat] || 0) + amount;
    }

    transactions.push({
      title: yaml.title || file.replace(".md", ""),
      type: type || "unknown",
      amount,
      date: yaml.date || "",
      category: yaml.category || "",
    });
  }

  // Ordenar transacciones por fecha descendente, tomar las últimas 5
  transactions.sort((a, b) => b.date.localeCompare(a.date));
  const recent = transactions.slice(0, 5);

  return {
    month,
    currency: "MXN", // todas las transacciones del vault son MXN
    income: Math.round(income * 100) / 100,
    expenses: Math.round(expenses * 100) / 100,
    balance: Math.round((income - expenses) * 100) / 100,
    transaction_count: transactions.length,
    by_category: byCategory,
    transactions: recent,
  };
}

// ── Streaks ───────────────────────────────────────────────────
async function handleStreaks() {
  const TRACKED = ['daily_commit', 'algo_practice', 'english_practice', 'reading']
  const HISTORY_DAYS = 14

  const all = await fs.readdir(JOURNAL_DIR)
  const files = all
    .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .slice(-HISTORY_DAYS)

  const entries = []
  for (const file of files) {
    const content = await fs.readFile(path.join(JOURNAL_DIR, file), 'utf8')
    const { yaml } = splitFrontmatter(content)
    entries.push(yaml)
  }

  const result = {}
  for (const field of TRACKED) {
    const history = entries.map(yaml => {
      const val = yaml[field]
      return val === true ? true : val === false ? false : null
    })

    let streak = 0
    let i = history.length - 1
    const pending = history[i] === null
    if (pending) i--  // skip today if not logged yet
    for (; i >= 0; i--) {
      if (history[i] === true) streak++
      else break
    }

    result[field] = { streak, pending, history }
  }

  return result
}

// ── Servidor HTTP ─────────────────────────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-cache",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Preflight CORS
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // Auth routes (non-JSON, no CORS wrapper)
  if (url.pathname === "/auth/google") {
    try { await handleAuthGoogle(res); } catch (e) { res.writeHead(500); res.end(e.message); }
    return;
  }
  if (url.pathname === "/auth/callback") {
    try { await handleAuthCallback(url, res); } catch (e) { res.writeHead(500); res.end(e.message); }
    return;
  }

  const send = (status, data) => {
    res.writeHead(status, CORS_HEADERS);
    res.end(JSON.stringify(data));
  };

  try {
    if (url.pathname === "/api/today") {
      const data = await handleToday();
      send(200, data);
      return;
    }

    if (url.pathname === "/api/stats") {
      const data = await handleStats();
      send(200, data);
      return;
    }

    if (url.pathname === "/api/finances") {
      const month = url.searchParams.get("month") || undefined;
      const data = await handleFinances(month);
      send(200, data);
      return;
    }

    if (url.pathname === "/api/calendar") {
      const data = await handleCalendar();
      send(200, data);
      return;
    }

    if (url.pathname === "/api/streaks") {
      const data = await handleStreaks();
      send(200, data);
      return;
    }

    send(404, { error: "not found" });
  } catch (err) {
    console.error("[server error]", err);
    send(500, { error: err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Obsidian API server corriendo en http://127.0.0.1:${PORT}`);
  console.log(`  GET /api/today`);
  console.log(`  GET /api/finances?month=YYYY-MM`);
});
