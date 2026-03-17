# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proyecto

Wallpaper web para **Wallpaper Engine** (Steam). El punto de entrada es `index.html`, cargado directamente por el motor de Wallpaper Engine vía CEF (Chromium Embedded Framework).

No hay build, bundler, ni servidor de desarrollo. Los cambios se ven recargando el wallpaper en Wallpaper Engine.

## Resolución del usuario

El usuario usa una pantalla **DQHD (5120×1440)**. Todo el sizing debe escalar correctamente en esa resolución y en otras (QHD, FHD, 4K).

## Cómo funciona el rendering en Wallpaper Engine

- El viewport CSS es exactamente la resolución física del monitor — no hay DPI scaling.
- `100vw` / `100vh` = píxeles reales de la pantalla.
- El wallpaper siempre es fullscreen, nunca cambia de tamaño → las media queries no tienen utilidad aquí.

## Wallpaper Engine API

`window.wallpaperPropertyListener` expone callbacks para recibir propiedades configuradas por el usuario en WE:

- `applyUserProperties`: recibe propiedades custom del `project.json` (e.g. `customcolor`).
- `applyGeneralProperties`: recibe propiedades generales del motor (e.g. `fps`).

Los colores en WE llegan como string `"R G B"` con valores `0–1`, hay que convertirlos a `0–255` para CSS.

## Idioma del contenido

Todo el contenido visible en el wallpaper (labels, títulos de paneles, placeholders) debe estar en **inglés**.

## Servidor local (API)

El wallpaper consume una API REST local en `http://127.0.0.1:7432` servida por `server/index.js` (Node.js).

El servidor se lanza automáticamente al iniciar Windows via `server/start.vbs`, que está en la carpeta `shell:startup`. Corre en background sin ventana visible.

**Para reiniciar tras cambios en `server/index.js`:**
1. Matar el proceso: `taskkill /F /IM node.exe` en terminal (o Task Manager → node.exe → End Task)
2. Relanzar: doble click en `server/start.vbs` o `wscript "...server\start.vbs"` en terminal

## Estructura

- `index.html` — markup del dashboard (3 columnas: tasks, tracker, panel derecho)
- `styles.css` — todos los estilos; layout con CSS Grid `1fr 1fr 1fr`
- `script.js` — integración con la API de Wallpaper Engine
- `project.json` — metadatos y propiedades configurables del wallpaper (tipo, título, user properties)
