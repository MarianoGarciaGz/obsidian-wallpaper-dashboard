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

## Unidades y sizing

- `html { font-size: 1vh }` → `1rem = 1vh`. En DQHD y QHD (ambas 1440px de alto): `1rem = 14.4px`.
- Usar `rem` para todo lo que deba escalar (padding, gap, border-radius, font-size).
- Evitar `px` para layout. Evitar `vw` como base de font-size (en pantallas ultrawide como DQHD, `1vw = 51.2px`).
- La altura del dashboard se calcula como `calc(100dvh - 2.5rem)` para descontar los paddings de `body` (0.5rem) y `.content` (2rem).

## Wallpaper Engine API

`window.wallpaperPropertyListener` expone callbacks para recibir propiedades configuradas por el usuario en WE:
- `applyUserProperties`: recibe propiedades custom del `project.json` (e.g. `customcolor`).
- `applyGeneralProperties`: recibe propiedades generales del motor (e.g. `fps`).

Los colores en WE llegan como string `"R G B"` con valores `0–1`, hay que convertirlos a `0–255` para CSS.

## Estructura

- `index.html` — markup del dashboard (3 columnas: tasks, tracker, panel derecho)
- `styles.css` — todos los estilos; layout con CSS Grid `1fr 1fr 1fr`
- `script.js` — integración con la API de Wallpaper Engine
- `project.json` — metadatos y propiedades configurables del wallpaper (tipo, título, user properties)
