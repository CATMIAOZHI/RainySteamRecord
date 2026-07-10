# RainySteamRecord

[![License](https://img.shields.io/badge/License-GPL--3.0-blue?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows-blue?style=for-the-badge)](#)
[![Tech](https://img.shields.io/badge/Tauri-2.x-orange?style=for-the-badge)](https://tauri.app)

> A modern GUI tool to browse and export Steam game recordings (DASH `.m4s` → `.mp4`).

Steam stores recordings as segmented `.m4s` files (DASH format). The native export works, but often produces pixelation and stuttering. RainySteamRecord converts those recordings to clean `.mp4` files using FFmpeg, with no artifacts and no length limits.

---

## Features

- **Clip browser** — recordings displayed in a thumbnail grid with virtual scrolling, smooth animations, and page controls
- **Automatic game names** — identifies the game for each clip automatically, including non-Steam games
- **FFmpeg bundled** — no separate installation needed
- **13 built-in themes** — Steam Dark, Cyberpunk, Neon Blue, Dracula, Nord, Gruvbox, Catppuccin, and more
- **Bilingual UI** — Chinese / English with `i18next`
- **Privacy** — no data collection, everything stored locally

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2 (Rust) |
| Backend core | Node.js sidecar (stdio JSON-RPC) |
| FFmpeg | `ffmpeg-static` (bundled binary) |
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS + shadcn/ui |
| State | Zustand |
| i18n | i18next |

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (stable)
- [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)

### Install & Run

```bash
git clone https://github.com/CATMIAOZHI/RainySteamRecord
cd RainySteamRecord
npm install
npm run tauri:dev
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server (frontend only) |
| `npm run tauri:dev` | Start Tauri + frontend in dev mode |
| `npm run tauri:build` | Build production app |
| `npm run node:dev` | Start Node sidecar standalone (debug) |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | TypeScript type checking |
| `npm run test` | Run Vitest tests |

---

## License

GPL-3.0. See [LICENSE](LICENSE).

Portions of the Steam discovery logic (binary VDF parsing, non-Steam game
appid CRC32 calculation) are based on [SteamClip](https://github.com/Nastas95/SteamClip)
by Nastas95, licensed under GPL-3.0.

---

*Developed for the PC gaming community.*