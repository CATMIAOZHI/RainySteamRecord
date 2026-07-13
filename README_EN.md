# RainySteamRecord

> *"Steam recordings, Rainy style~"* 🐱

[![Release](https://github.com/CATMIAOZHI/RainySteamRecord/actions/workflows/release.yml/badge.svg)](https://github.com/CATMIAOZHI/RainySteamRecord/releases)
[![Version](https://img.shields.io/github/v/release/CATMIAOZHI/RainySteamRecord?color=ff85a2)](https://github.com/CATMIAOZHI/RainySteamRecord/releases/latest)
[![License](https://img.shields.io/badge/License-GPL--3.0-blue?color=ff85a2)](LICENSE)

A modern Windows desktop tool to browse and export Steam game recordings (DASH `.m4s` → `.mp4`). Sakura-themed UI, double-click instant preview, FFmpeg lossless conversion, 14 built-in themes.

RainySteamRecord — the Rainy Family tools.

---

## 🌸 Features

| Feature | Description |
|---------|-------------|
| 🎬 **Instant Preview** | Double-click a clip to play via MSE streaming; unsupported codecs can open in bundled mpv while the trim dialog stays available, without proxy transcoding |
| ✂️ **Start/End Trimming** | Set in/out points with sliders, manual timestamps, or I / O; choose accurate H.264/AAC re-encoding or fast lossless export with keyframe limitations |
| 🖼️ **Thumbnail Grid** | Auto-extracted first-frame thumbnails, 3-column card grid with pagination and smooth animations |
| 🎮 **Auto Game Names** | Identifies the game for each clip automatically, including non-Steam games (emulators, Epic, etc.) via Steam API + CRC32 appid |
| 📦 **Batch Export** | Select multiple clips and export as `.mp4` with FFmpeg `-c copy` lossless conversion, auto-named (GameName_DateTime.mp4) |
| 🎨 **14 Built-in Themes** | Rainy (default), Steam Dark, Cyberpunk, Neon Blue, Dracula, Nord, Gruvbox, Catppuccin, and more |
| 🌐 **Bilingual UI** | Chinese (default) / English via i18next |
| 🔄 **Update Checker** | Checks for latest GitHub Release on startup |
| 🔒 **Privacy** | No data collection, everything stored locally |

---

## 📥 Download

Visit [Releases](https://github.com/CATMIAOZHI/RainySteamRecord/releases) for the latest builds.

| Format | Description |
|--------|-------------|
| 📌 **NSIS Installer** (.exe) | Recommended |
| 📦 **MSI Installer** (.msi) | Enterprise deployment |

> FFmpeg is bundled — no separate installation needed~

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────┐
│                  React 19 + TypeScript            │
│          (Tailwind CSS + 14 themes + Zustand)     │
│                        │                          │
│           invoke ──────┤──── listen (event)       │
│                        ▼                          │
│             Tauri 2 IPC Channel                   │
│                        │                          │
│     ┌──────────┬───────┴──┬──────────┐            │
│     ▼          ▼          ▼          ▼            │
│  config.rs  steam.rs   ffmpeg.rs  streaming.rs    │
│  Config     Steam disc. Convert    MSE preview     │
│     │          │          │          │            │
│     ▼          ▼          ▼          ▼            │
│  JSON cfg   VDF parse   FFmpeg     fMP4 segments   │
│  GameIDs    CRC32      concat+mux  tauri::Response│
└──────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2 (Rust) |
| Backend | Pure Rust (no Node sidecar) |
| FFmpeg | Bundled binary (CI-downloaded, packaged as Tauri resource) |
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS + CSS variable themes |
| State | Zustand |
| i18n | i18next |

### Video Preview Pipeline

| Path | Method | First-Frame Latency |
|------|--------|---------------------|
| **MSE Streaming** (primary) | Read m4s segments → MediaSource SourceBuffer → `<video>` progressive playback | ~100ms |
| **Native mpv** (fallback) | Open `session.mpd` on demand for unsupported codecs while retaining the trim dialog for manual timestamps | No pre-merge or transcode |

Offers bundled mpv when MSE is unsupported while keeping the trim dialog open for manual timestamps. No proxy video is generated.

---

## 📁 Project Structure

```
RainySteamRecord/
├── src-tauri/
│   └── src/
│       ├── lib.rs          # Tauri command registration (20+ commands)
│       ├── config.rs       # Config + GameIDs management
│       ├── steam.rs        # Steam discovery, VDF parser, non-Steam games
│       ├── ffmpeg.rs       # m4s concat → mp4, thumbnail extraction, preview fallback
│       ├── streaming.rs     # MSE streaming preview (session.mpd parse, segment read)
│       ├── clip.rs          # Clip scanning, duration parsing, thumbnail generation
│       └── update.rs       # GitHub Release update check
├── src/
│   ├── components/
│   │   ├── VideoPreviewDialog.tsx  # MSE player + FFmpeg fallback
│   │   ├── ClipCard.tsx            # Thumbnail card (click select / dbl-click preview)
│   │   ├── ClipGrid.tsx            # 3-column grid + pagination
│   │   ├── FilterBar.tsx           # SteamID/Game/Type filters
│   │   ├── BottomBar.tsx           # Export/progress bar
│   │   ├── SettingsDialog.tsx      # Theme/language/path settings
│   │   ├── TitleBar.tsx            # Frameless window controls
│   │   └── SteamVersionPicker.tsx  # First-run Steam locator
│   ├── lib/
│   │   ├── tauri-bridge.ts  # Typed invoke wrappers
│   │   ├── theme.ts         # 14 theme management
│   │   └── i18n.ts          # i18next config
│   └── stores/
│       └── app.ts           # Zustand global state
├── locales/
│   ├── zh-CN.json
│   └── en-US.json
└── .github/workflows/
    └── release.yml          # CI: download FFmpeg → Tauri build → publish
```

---

## 🚀 Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (stable)
- [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- MSVC Build Tools (Windows)

### Install & Run

```bash
git clone https://github.com/CATMIAOZHI/RainySteamRecord
cd RainySteamRecord
npm install --legacy-peer-deps
npm run tauri:dev
```

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server (frontend only) |
| `npm run tauri:dev` | Start Tauri + frontend in dev mode |
| `npm run tauri:build` | Build production app (NSIS + MSI) |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | TypeScript type checking |

### FFmpeg Binary

FFmpeg is not committed to git (138MB). For local dev, manually place at `src-tauri/binaries/ffmpeg.exe`. CI downloads automatically. Path resolution: exe dir → `CARGO_MANIFEST_DIR/binaries` → `%LOCALAPPDATA%\RainySteamRecord` → system PATH.

---

## 🐱 About Rainy

Rainy is a tool series featuring a sakura-pink color scheme, pursuing modern, clean, and smooth user experiences.

- **Author**: CATMIAOZHI
- **Repo**: https://github.com/CATMIAOZHI/RainySteamRecord

---

## 📄 License

GPL-3.0. See [LICENSE](LICENSE).

Portions of the Steam discovery logic (binary VDF parsing, non-Steam game
appid CRC32 calculation) are based on [SteamClip](https://github.com/Nastas95/SteamClip)
by Nastas95, licensed under GPL-3.0.

---

*Made with 🐾 paws by Rainy*
