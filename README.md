# Dashboard Wallpaper

Wallpaper interactivo para **Wallpaper Engine** (Steam) que muestra un dashboard en tiempo real con datos del vault de Obsidian, precio de Bitcoin, pomodoro y estadísticas personales.

![Stack](https://img.shields.io/badge/Wallpaper_Engine-CEF-blue) ![Stack](https://img.shields.io/badge/Node.js-API_local-green) ![Stack](https://img.shields.io/badge/Font-JetBrains_Mono-orange)

---

## Pantalla

**Resolución objetivo:** DQHD (5120×1440)

El wallpaper escala correctamente a QHD, FHD y 4K. El sistema de fuentes usa `1vh` como base (`html { font-size: 1vh }`) para evitar el problema de `vw` en pantallas ultrawide.

---

## Layout

```
┌─────────────────┬──────────────────────┬────────────────────────┐
│   Clock + Pomo  │  Tasks │  Finances   │  (espacio) │ Life Grid │
├─────────────────┴──────────────────────┴────────────────────────┤
│  Stats pills    │    (vacío)           │        BTC / USD       │
└─────────────────┴──────────────────────┴────────────────────────┘
```

### Top row
- **Clock card** — Reloj en tiempo real + timer Pomodoro (click = start/pause, doble click = reset). Dos pills verticales: progreso del Pomodoro y progreso del día.
- **Tasks** — Tareas del daily note de Obsidian del día actual.
- **Finances** — Resumen del mes actual: ingresos, gastos, balance, categorías y últimas transacciones.
- **Life in Weeks** — Grid SVG de 52×90 (semanas × años de vida). Semanas pasadas en `--muted`, semana actual en `--accent`. Calculado desde el cumpleaños alineado al calendario.

### Bottom row
- **Stats pills** — Promedios de los últimos 7 días de los campos del frontmatter de Obsidian: `exercise`, `energy`, `mood`, `stress`, `focus`. Con icono y porcentaje.
- **BTC / USD** — Precio del Bitcoin actualizado cada 60 segundos vía CoinGecko.

---

## Stack

| Capa | Tecnología |
|---|---|
| Wallpaper Engine | CEF (Chromium Embedded Framework) |
| Markup | HTML + CSS Grid / Flexbox |
| Estilos | CSS puro, variables custom, Bootstrap Icons |
| Lógica | JavaScript vanilla (sin frameworks) |
| API local | Node.js (built-ins únicamente, sin `npm install`) |
| Fuente | JetBrains Mono |
| Datos | Vault de Obsidian (archivos `.md` locales) |

---

## Servidor local

El wallpaper no puede leer archivos del sistema directamente desde CEF. Un servidor Node.js local en `http://127.0.0.1:7432` lee el vault de Obsidian y expone una API REST.

### Endpoints

| Endpoint | Descripción |
|---|---|
| `GET /api/today` | Tareas y frontmatter del daily note de hoy |
| `GET /api/finances?month=YYYY-MM` | Resumen financiero del mes |
| `GET /api/stats` | Promedios de 7 días de mood, energy, focus, stress, exercise |

### Inicio automático

`server/start.vbs` lanza el servidor en background sin ventana al iniciar Windows. Colocar un shortcut en:

```
C:\Users\<usuario>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\
```

### Reiniciar tras cambios en `server/index.js`

```bat
taskkill /F /IM node.exe
wscript "ruta\al\server\start.vbs"
```

---

## Paleta de colores

| Variable | Hex | Uso |
|---|---|---|
| `--background-color` | `#18100c` | Fondo principal |
| `--text-color` | `#f5efd5` | Texto general |
| `--accent` | `#ea7d54` | Elementos activos, positivos |
| `--muted` | `#a7927d` | Elementos secundarios |
| `--danger` | `#f15362` | Alertas, negativos |
| `--blue-night` | `#7371e6` | Mood, modo break del Pomodoro |

El color de fondo es configurable desde el panel de Wallpaper Engine (color picker → `customcolor`).

---

## Frontmatter esperado en daily notes

```yaml
---
date: 2026-03-18
bedtime: "2:30 AM"
wake_up: "8:00 AM"
exercise: 0
energy: 3
mood: 3
stress: 1
focus: 2
cigarettes: 5
daily_commit: false
algo_practice: false
english_practice: true
reading: false
---
```

Los campos numéricos `exercise`, `energy`, `mood`, `stress`, `focus` van de `0–5`. `cigarettes` es un conteo. Los booleanos `daily_commit`, `algo_practice`, `english_practice`, `reading` registran hábitos del día. `bedtime` y `wake_up` son strings en formato `"H:MM AM/PM"` y se usan para calcular el sleep score y el progreso del día en el pill del reloj.

---

## Estructura del proyecto

```
index/
├── index.html          # Markup del dashboard
├── styles.css          # Todos los estilos
├── script.js           # Lógica del cliente (WE API, fetch, render)
├── project.json        # Metadatos y propiedades de Wallpaper Engine
├── noise-light.png     # Textura de ruido para overlay
├── CLAUDE.md           # Instrucciones para Claude Code
└── server/
    ├── index.js        # Servidor Node.js (API REST)
    └── start.vbs       # Lanzador silencioso para Windows Startup
```
