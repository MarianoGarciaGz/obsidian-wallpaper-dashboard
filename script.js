var wallpaperSettings = {
    fps: 60
}

window.wallpaperPropertyListener = {
    applyGeneralProperties: function (properties) {
        if (properties.fps) {
            wallpaperSettings.fps = properties.fps
        }
    },
    applyUserProperties: function (properties) {
        if (properties.customcolor) {
            var customColor = properties.customcolor.value.split(' ')
            customColor = customColor.map(function (c) {
                return Math.ceil(c * 255)
            })
            var customColorAsCSS = 'rgb(' + customColor + ')'
            document.documentElement.style.setProperty('--background-color', customColorAsCSS)
        }
    }
}

// ── Obsidian API ──────────────────────────────────────────────
const API_BASE   = 'http://127.0.0.1:7432'

let medianWakeUp = null   // minutos desde medianoche (mediana 7 días)
let nudgeBedtime = null   // bedtime target con -5min
let todayWakeUp  = null   // wake_up real de hoy (si está registrado)
const REFRESH_MS = 5 * 60 * 1000
const MXN_FMT    = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })

async function apiFetch(endpoint) {
    const controller = new AbortController()
    const timeout    = setTimeout(() => controller.abort(), 10000)
    try {
        const res  = await fetch(API_BASE + endpoint, { signal: controller.signal })
        const data = await res.json()
        return data
    } catch {
        return null
    } finally {
        clearTimeout(timeout)
    }
}

// ── Time helper (client) ──────────────────────────────────────
function parseTimeToMins(str, nextDayIfEarly = false) {
    if (!str) return null
    const m = String(str).match(/(\d+):(\d+)\s*(AM|PM)/i)
    if (!m) return null
    let h = parseInt(m[1])
    const min = parseInt(m[2])
    const period = m[3].toUpperCase()
    if (period === 'PM' && h !== 12) h += 12
    if (period === 'AM' && h === 12) h = 0
    const total = h * 60 + min
    return (nextDayIfEarly && h < 6) ? total + 1440 : total
}

// ── Tasks panel ───────────────────────────────────────────────
async function loadTasks() {
    const data = await apiFetch('/api/today')
    if (data) {
        if (data.wake_up) {
            todayWakeUp = parseTimeToMins(data.wake_up, false)
        }
        renderTasks(data)
    }
}

function renderTasks(data) {
    const container = document.getElementById('tasks-content')
    const dateEl    = document.getElementById('tasks-date')
    if (!container) return

    if (data.day_of_week) dateEl.textContent = data.day_of_week

    if (!data.found) {
        container.innerHTML = '<p class="loading-msg">Sin nota para hoy</p>'
        return
    }

    const frag = document.createDocumentFragment()

    for (const section of data.sections) {
        if (!section.tasks.length) continue

        const heading  = document.createElement('p')
        heading.className = 'section-heading'
        heading.textContent = section.title
        frag.appendChild(heading)

        const ul = document.createElement('ul')
        for (const task of section.tasks) {
            const li    = document.createElement('li')
            if (task.checked) li.classList.add('task-done')

            const check = document.createElement('span')
            check.className   = 'task-check'
            check.textContent = task.checked ? '✓' : '·'

            const text  = document.createElement('span')
            text.className   = 'task-text'
            // Limpiar links de Obsidian [[nota]] y [texto](url)
            text.textContent = task.text
                .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                .replace(/\[\[([^\]]+)\]\]/g, '$1')

            li.appendChild(check)
            li.appendChild(text)
            ul.appendChild(li)
        }
        frag.appendChild(ul)
    }

    container.innerHTML = ''
    container.appendChild(frag)
}

// ── Finance panel ─────────────────────────────────────────────
async function loadFinances() {
    const data = await apiFetch('/api/finances')
    if (data) renderFinances(data)
}

function renderFinances(data) {
    const summaryEl      = document.getElementById('finance-summary')
    const categoriesEl   = document.getElementById('finance-categories')
    const transactionsEl = document.getElementById('finance-transactions')
    const monthEl        = document.getElementById('finance-month')
    if (!summaryEl) return

    // Mes
    if (data.month) {
        const [y, m] = data.month.split('-')
        const label  = new Date(y, m - 1).toLocaleString('es-MX', { month: 'long', year: 'numeric' })
        monthEl.textContent = label
    }

    // Resumen: ingreso / gastos / balance
    const stats = [
        { label: 'Ingresos',  value: data.income,   cls: data.income  > 0 ? 'finance-positive' : '' },
        { label: 'Gastos',    value: data.expenses,  cls: data.expenses > 0 ? 'finance-negative' : '' },
        { label: 'Balance',   value: data.balance,   cls: data.balance >= 0 ? 'finance-positive' : 'finance-negative' },
    ]

    const summaryFrag = document.createDocumentFragment()
    for (const s of stats) {
        const row   = document.createElement('div')
        row.className = 'finance-stat'
        const lbl   = document.createElement('span')
        lbl.className   = 'finance-stat-label'
        lbl.textContent = s.label
        const val   = document.createElement('span')
        val.className   = `finance-stat-value ${s.cls}`.trim()
        val.textContent = MXN_FMT.format(s.value)
        row.appendChild(lbl)
        row.appendChild(val)
        summaryFrag.appendChild(row)
    }
    summaryEl.innerHTML = ''
    summaryEl.appendChild(summaryFrag)

    // Categorías — barchart
    const cats     = Object.entries(data.by_category).sort((a, b) => b[1] - a[1])
    const maxAmt   = cats[0]?.[1] || 1
    const catFrag  = document.createDocumentFragment()

    for (const [cat, amount] of cats) {
        const row   = document.createElement('div')
        row.className = 'cat-row'

        const lbl   = document.createElement('span')
        lbl.className   = 'cat-label'
        lbl.textContent = cat

        const track = document.createElement('div')
        track.className = 'cat-bar-track'
        const bar   = document.createElement('div')
        bar.className = 'cat-bar'
        bar.style.width = `${(amount / maxAmt) * 100}%`
        track.appendChild(bar)

        const amt   = document.createElement('span')
        amt.className   = 'cat-amount'
        amt.textContent = MXN_FMT.format(amount)

        row.appendChild(lbl)
        row.appendChild(track)
        row.appendChild(amt)
        catFrag.appendChild(row)
    }
    categoriesEl.innerHTML = ''
    categoriesEl.appendChild(catFrag)

    // Últimas 5 transacciones
    const txFrag = document.createDocumentFragment()
    for (const tx of data.transactions) {
        const row  = document.createElement('div')
        row.className = 'tx-row'

        const info = document.createElement('span')
        info.className   = 'tx-info'
        info.textContent = tx.title

        const amt  = document.createElement('span')
        amt.className   = `tx-amount ${tx.type === 'income' ? 'finance-positive' : 'finance-negative'}`
        amt.textContent = (tx.type === 'income' ? '+' : '-') + MXN_FMT.format(tx.amount)

        row.appendChild(info)
        row.appendChild(amt)
        txFrag.appendChild(row)
    }
    transactionsEl.innerHTML = ''
    transactionsEl.appendChild(txFrag)
}

// ── Life in Weeks ─────────────────────────────────────────────
function renderLifeWeeks() {
    const BIRTH       = new Date('2002-04-04')
    const TOTAL_YEARS = 90
    const TOTAL_WEEKS = TOTAL_YEARS * 52
    const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000
    const now         = new Date()

    // Año de vida actual (0-indexed), alineado al cumpleaños
    let yearOfLife = now.getFullYear() - BIRTH.getFullYear()
    const birthdayThisYear = new Date(now.getFullYear(), BIRTH.getMonth(), BIRTH.getDate())
    if (now < birthdayThisYear) yearOfLife--

    // Semana dentro del año actual (0-indexed)
    const yearStart  = new Date(BIRTH.getFullYear() + yearOfLife, BIRTH.getMonth(), BIRTH.getDate())
    const weekInYear = Math.floor((now - yearStart) / MS_PER_WEEK)

    const currentCell = yearOfLife * 52 + weekInYear

    const grid = document.getElementById('weeks-grid')
    if (!grid) return

    const frag = document.createDocumentFragment()
    for (let i = 0; i < TOTAL_WEEKS; i++) {
        const cell = document.createElement('div')
        cell.className = 'week-cell'
        if (i < currentCell)        cell.classList.add('past')
        else if (i === currentCell) cell.classList.add('current')
        frag.appendChild(cell)
    }
    grid.innerHTML = ''
    grid.appendChild(frag)
}

renderLifeWeeks()

// ── Clock ─────────────────────────────────────────────────────
function updateClock() {
    const now = new Date()
    const h   = String(now.getHours()).padStart(2, '0')
    const m   = String(now.getMinutes()).padStart(2, '0')
    document.getElementById('clock-time').textContent = `${h}:${m}`

    // Day progress pill
    const fill    = document.getElementById('clock-day-fill')
    const dayPct  = document.getElementById('clock-day-pct')
    if (fill) {
        const mins = now.getHours() * 60 + now.getMinutes()
        const wake = todayWakeUp ?? medianWakeUp
        const bed  = nudgeBedtime

        // Fill % — necesita wake
        let pct
        if (wake !== null && bed !== null) {
            const total   = bed - wake
            const elapsed = mins < wake ? mins + 1440 - wake : mins - wake
            pct = Math.round(Math.min(Math.max(elapsed / total, 0), 1) * 100)
        } else {
            pct = Math.round(((mins % 720) / 720) * 100)
        }
        fill.style.setProperty('--fill', pct + '%')
        if (dayPct) dayPct.textContent = pct + '%'

        // Color — solo necesita bed
        if (bed !== null) {
            const minsNorm  = mins < 6 * 60 ? mins + 1440 : mins
            const remaining = bed - minsNorm
            if (remaining <= 0) {
                fill.style.background = 'var(--danger)'
            } else if (remaining <= 120) {
                fill.style.background = 'var(--blue-night)'
            } else {
                fill.style.background = 'var(--muted)'
            }
        } else {
            fill.style.background = 'var(--muted)'
        }
    }
}

updateClock()
setInterval(updateClock, 1000)

// ── Bitcoin price ─────────────────────────────────────────────
const USD_FMT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const BTC_REFRESH_MS = 60 * 1000

async function loadBTC() {
    const controller = new AbortController()
    const timeout    = setTimeout(() => controller.abort(), 10000)
    try {
        const res  = await fetch(
            'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
            { signal: controller.signal }
        )
        const data = await res.json()
        const price = data?.bitcoin?.usd
        if (!price) return

        document.getElementById('btc-price').textContent   = USD_FMT.format(price)
        document.getElementById('btc-updated').textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    } catch {
        // silently fail — keeps last value on screen
    } finally {
        clearTimeout(timeout)
    }
}

// ── Stats pills ───────────────────────────────────────────────
async function loadStats() {
    const data = await apiFetch('/api/stats')
    if (data) {
        medianWakeUp = data.medianWakeUp ?? null
        nudgeBedtime = data.nudgeBedtime ?? null
        renderStats(data)
    }
}

function renderStats(data) {
    document.querySelectorAll('.stat-pill').forEach(pill => {
        const field = pill.dataset.field
        const avg   = data.averages?.[field]
        const max   = data.max?.[field]
        if (avg == null || !max) return
        const pct = Math.min(100, Math.round((avg / max) * 100))
        pill.querySelector('.stat-pill-fill').style.setProperty('--fill', pct + '%')
        pill.querySelector('.stat-pill-pct').textContent = pct + '%'
    })
}

// ── Polling ───────────────────────────────────────────────────
function refreshAll() {
    loadTasks()
    loadFinances()
    loadStats()
}

refreshAll()
setInterval(refreshAll, REFRESH_MS)

loadBTC()
setInterval(loadBTC, BTC_REFRESH_MS)

