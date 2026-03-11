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
            document.getElementById('background').style.backgroundColor = customColorAsCSS
        }
    }
}

// ── Obsidian API ──────────────────────────────────────────────
const API_BASE   = 'http://127.0.0.1:7432'
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

// ── Tasks panel ───────────────────────────────────────────────
async function loadTasks() {
    const data = await apiFetch('/api/today')
    if (data) renderTasks(data)
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

// ── Polling ───────────────────────────────────────────────────
function refreshAll() {
    loadTasks()
    loadFinances()
}

refreshAll()
setInterval(refreshAll, REFRESH_MS)

