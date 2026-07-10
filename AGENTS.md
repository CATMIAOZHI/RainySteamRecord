# AGENTS.md — RainySteamRecord Project Context

> This file is for AI agents (opencode) to understand the project context across conversations.

## Project Overview

**RainySteamRecord** — A modern Windows GUI tool to browse and export Steam game recordings (DASH `.m4s` → `.mp4`).

- **Repo**: https://github.com/CATMIAOZHI/RainySteamRecord
- **License**: GPL-3.0 (portions based on SteamClip by Nastas95, also GPL-3.0)
- **Platform**: Windows only
- **Language**: UI bilingual (zh-CN default / en-US) via i18next; code comments/logs in English

## Architecture

```
React UI ──invoke──▶ Rust (Tauri 2) ── direct fs/subprocess
     ◀──event──
```

All backend logic is in Rust (no Node sidecar). Tauri commands handle everything directly.

| Layer | Tech | Location |
|-------|------|----------|
| Desktop shell + backend | Tauri 2 (Rust) | `src-tauri/src/` |
| Frontend | React 19 + TypeScript + Vite | `src/` |
| Styling | Tailwind CSS + CSS variables (14 themes) | `src/styles/` |
| State | Zustand | `src/stores/app.ts` |
| i18n | i18next + react-i18next | `locales/`, `src/lib/i18n.ts` |

## Rust Backend Modules

| Module | File | Description |
|--------|------|-------------|
| config | `config.rs` | JSON config + GameIDs.json in `%LOCALAPPDATA%\RainySteamRecord\` |
| steam | `steam.rs` | Steam discovery, binary VDF parser, non-Steam CRC32 appid, Steam API |
| ffmpeg | `ffmpeg.rs` | m4s concat → mp4, natural sort, thumbnail extraction |
| clip | `clip.rs` | Clip scanning, duration parsing (ISO 8601), thumbnail generation |
| update | `update.rs` | GitHub release check |

## Frontend Components

| Component | File | Description |
|-----------|------|-------------|
| TitleBar | `components/TitleBar.tsx` | Frameless window controls (minimize/close) |
| FilterBar | `components/FilterBar.tsx` | SteamID / Game / Media type selects |
| ClipGrid | `components/ClipGrid.tsx` | 3-column grid, pagination |
| ClipCard | `components/ClipCard.tsx` | Thumbnail card with selection state |
| BottomBar | `components/BottomBar.tsx` | Pagination + Convert/ExportAll/Clear buttons + progress bar |
| SettingsDialog | `components/SettingsDialog.tsx` | Theme/language/export path/game IDs/updates |
| SteamVersionPicker | `components/SteamVersionPicker.tsx` | First-run Steam location selection |

## Themes (14 total, Rainy is default)

Default theme is "雨晴" (Rainy) — pink/sakura color scheme per user's design system.

## Commands

```bash
npm run dev          # Vite dev server (frontend only, port 1420)
npm run tauri:dev    # Full app dev (Tauri + frontend)
npm run tauri:build  # Production build (Windows installer: nsis + msi)
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
```

## Git Configuration

- **Author**: CATMIAOZHI <109326062+CATMIAOZHI@users.noreply.github.com>
- **Signing**: SSH (ed25519), global
- All commits show "Verified" on GitHub

## Development Environment

- **OS**: Windows (win32)
- **Shell**: PowerShell 5.1
- **Working dir**: `C:\Users\CAT\Documents\workspace\steamclip\RainySteamRecord`
- **Rust cargo path**: `C:\Users\CAT\.cargo\bin`
- **gh CLI**: v2.96.0, authenticated as CATMIAOZHI
- **MSVC Build Tools**: NOT installed (needed for `cargo build` / `tauri:dev`)

## Conventions

- **No comments in code** unless explicitly requested
- **No emojis** in code or commits unless requested
- **Rainy style**: pink/sakura color scheme is default theme
- **Commit messages**: concise, descriptive
- **Run lint + typecheck** before considering a task complete

## User Preferences

- Chinese-first (zh-CN default, primary README)
- Prefers concise responses (CLI environment)
- GitHub account: CATMIAOZHI
- Naming convention: `Rainy` prefix for projects
- Wants modern + smooth UI