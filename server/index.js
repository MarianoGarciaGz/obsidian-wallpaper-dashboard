const http = require('http')
const fs   = require('fs/promises')
const path = require('path')
const { URL } = require('url')

// ── Configuración ─────────────────────────────────────────────
const VAULT_PATH  = 'C:\\Users\\maria\\Brain'
const JOURNAL_DIR = path.join(VAULT_PATH, 'areas', 'Personal', 'Journal')
const FINANCE_DIR = path.join(VAULT_PATH, 'areas', 'Finances', 'transactions')
const PORT        = 7432

// ── YAML frontmatter parser ───────────────────────────────────
// Lee líneas entre los dos `---` del inicio del archivo.
// Soporta strings, números, booleanos y listas simples.
function parseYAML(content) {
    const lines  = content.split('\n')
    const result = {}

    if (lines[0].trim() !== '---') return result

    let i = 1
    let lastKey = null

    while (i < lines.length && lines[i].trim() !== '---') {
        const line = lines[i]

        // Item de lista: "  - valor"
        if (/^\s+-\s*(.*)$/.test(line)) {
            const val = line.match(/^\s+-\s*(.*)$/)[1].trim()
            if (lastKey && Array.isArray(result[lastKey])) {
                if (val !== '') result[lastKey].push(castValue(val))
            }
            i++
            continue
        }

        // Par clave: valor
        const colonIdx = line.indexOf(':')
        if (colonIdx === -1) { i++; continue }

        const key = line.slice(0, colonIdx).trim()
        const raw = line.slice(colonIdx + 1).trim()
        lastKey   = key

        if (raw === '' || raw === null) {
            result[key] = []  // inicio de lista
        } else {
            // Quitar comillas
            const clean = raw.replace(/^["']|["']$/g, '')
            result[key] = castValue(clean)
        }

        i++
    }

    return result
}

function castValue(val) {
    if (val === 'true')  return true
    if (val === 'false') return false
    const n = Number(val)
    if (!isNaN(n) && val !== '') return n
    return val
}

// Devuelve { yaml, bodyLines[] } — bodyLines es el texto después del segundo ---
function splitFrontmatter(content) {
    const lines = content.split('\n')
    if (lines[0].trim() !== '---') return { yaml: {}, bodyLines: lines }

    let end = 1
    while (end < lines.length && lines[end].trim() !== '---') end++

    return {
        yaml:      parseYAML(content),
        bodyLines: lines.slice(end + 1),
    }
}

// ── Task extractor ────────────────────────────────────────────
// Agrupa checkboxes markdown por sección `##`.
// Subsecciones `###` se tratan como tareas planas bajo la sección padre.
function extractTasks(bodyLines) {
    const sections  = []
    let current     = null
    const TASK_RE   = /^- \[([ xX])\] (.+)$/
    const H2_RE     = /^## (.+)$/
    const H3_RE     = /^### (.+)$/

    for (const line of bodyLines) {
        const h2 = line.match(H2_RE)
        if (h2) {
            if (current && current.tasks.length > 0) sections.push(current)
            current = { title: h2[1].trim(), tasks: [] }
            continue
        }

        // H3 no crea nueva sección, solo es un subtítulo visual — lo ignoramos
        if (H3_RE.test(line)) continue

        const task = line.match(TASK_RE)
        if (task && current) {
            current.tasks.push({
                checked: task[1].toLowerCase() === 'x',
                text:    task[2].trim(),
            })
        }
    }

    if (current && current.tasks.length > 0) sections.push(current)
    return sections
}

// ── Helpers de fecha ──────────────────────────────────────────
function todayISO() {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
}

function currentMonth() {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    return `${y}-${m}`
}

// ── Rutas ─────────────────────────────────────────────────────

async function handleToday() {
    const date     = todayISO()
    const filePath = path.join(JOURNAL_DIR, `${date}.md`)

    try {
        await fs.access(filePath)
    } catch {
        return { found: false, date }
    }

    const content             = await fs.readFile(filePath, 'utf8')
    const { yaml, bodyLines } = splitFrontmatter(content)
    const sections            = extractTasks(bodyLines)

    return {
        found:       true,
        date,
        day_of_week: yaml.day_of_week ?? null,
        week_number: yaml.week_number ?? null,
        sections,
    }
}

async function handleFinances(month) {
    month = month || currentMonth()

    let files
    try {
        const all = await fs.readdir(FINANCE_DIR)
        files = all.filter(f => f.endsWith('.md') && f.startsWith(`${month}-`))
    } catch {
        files = []
    }

    let income   = 0
    let expenses = 0
    const byCategory  = {}
    const transactions = []

    for (const file of files) {
        const content = await fs.readFile(path.join(FINANCE_DIR, file), 'utf8')
        const { yaml } = splitFrontmatter(content)

        const amount = Number(yaml.amount) || 0
        const type   = yaml.type

        if (type === 'income') {
            income += amount
        } else if (type === 'expense') {
            expenses += amount
            const cat = yaml.category || 'other'
            byCategory[cat] = (byCategory[cat] || 0) + amount
        }

        transactions.push({
            title:    yaml.title    || file.replace('.md', ''),
            type:     type          || 'unknown',
            amount,
            date:     yaml.date     || '',
            category: yaml.category || '',
        })
    }

    // Ordenar transacciones por fecha descendente, tomar las últimas 5
    transactions.sort((a, b) => b.date.localeCompare(a.date))
    const recent = transactions.slice(0, 5)

    return {
        month,
        currency:          'MXN',  // todas las transacciones del vault son MXN
        income:            Math.round(income * 100) / 100,
        expenses:          Math.round(expenses * 100) / 100,
        balance:           Math.round((income - expenses) * 100) / 100,
        transaction_count: transactions.length,
        by_category:       byCategory,
        transactions:      recent,
    }
}

// ── Servidor HTTP ─────────────────────────────────────────────
const CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type':                 'application/json; charset=utf-8',
    'Cache-Control':                'no-cache',
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`)

    // Preflight CORS
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS)
        res.end()
        return
    }

    const send = (status, data) => {
        res.writeHead(status, CORS_HEADERS)
        res.end(JSON.stringify(data))
    }

    try {
        if (url.pathname === '/api/today') {
            const data = await handleToday()
            send(200, data)
            return
        }

        if (url.pathname === '/api/finances') {
            const month = url.searchParams.get('month') || undefined
            const data  = await handleFinances(month)
            send(200, data)
            return
        }

        send(404, { error: 'not found' })
    } catch (err) {
        console.error('[server error]', err)
        send(500, { error: err.message })
    }
})

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Obsidian API server corriendo en http://127.0.0.1:${PORT}`)
    console.log(`  GET /api/today`)
    console.log(`  GET /api/finances?month=YYYY-MM`)
})
