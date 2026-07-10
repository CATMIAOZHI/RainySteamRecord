# AGENTS.md — RainySteamRecord Project Context

> This file is for AI agents (opencode) to understand the project context across conversations.
> It captures architecture decisions, conventions, and current progress.

---

## Project Overview

**RainySteamRecord** — A modern Windows GUI tool to browse and export Steam game recordings (DASH `.m4s` → `.mp4`).

- **Repo**: https://github.com/CATMIAOZHI/RainySteamRecord
- **License**: GPL-3.0 (portions based on SteamClip by Nastas95, also GPL-3.0)
- **Platform**: Windows only (no Linux/macOS support)
- **Language**: UI bilingual (zh-CN / en-US) via i18next; **Chinese is primary** (default language, primary README); code comments/logs in English

## Architecture

```
React UI ──invoke──▶ Rust (Tauri) ──stdio JSON-RPC──▶ Node sidecar
     ◀──event──          ◀──event──
```

| Layer | Tech | Location |
|-------|------|----------|
| Desktop shell | Tauri 2 (Rust) | `src-tauri/` |
| Backend core | Node.js sidecar (stdio JSON-RPC) | `src-node/` |
| Frontend | React 19 + TypeScript + Vite | `src/` |
| Styling | Tailwind CSS + CSS variables (themes) | `src/styles/` |
| State | Zustand | `src/stores/` (not yet created) |
| i18n | i18next + react-i18next | `locales/`, `src/lib/i18n.ts` |

## Tech Stack Details

- **Node**: v24.16.0
- **npm**: 11.13.0
- **Rust**: 1.97.0 (stable, via rustup)
- **Tauri**: 2.x
- **Bundle targets**: nsis, msi (Windows installers only)
- **FFmpeg**: will use `ffmpeg-static` npm package (bundled binary, not yet installed)

## Project Structure

```
RainySteamRecord/
├── src-tauri/              # Rust desktop shell
│   ├── src/
│   │   ├── main.rs         # Entry point
│   │   ├── lib.rs          # Tauri builder + commands (thin forwarding layer)
│   │   └── sidecar.rs      # Node process lifecycle + stdio JSON-RPC
│   ├── Cargo.toml
│   ├── tauri.conf.json     # Window config (frameless), bundle (nsis+msi)
│   └── capabilities/default.json
├── src-node/               # Node sidecar backend
│   ├── index.ts            # stdio JSON-RPC server entry
│   ├── ipc/
│   │   ├── protocol.ts     # Request/Response/Event types + domain types
│   │   └── handlers.ts    # Method routing (currently only "ping")
│   └── (more modules to be created in phase 2)
├── src/                    # React frontend
│   ├── main.tsx
│   ├── App.tsx             # Demo: invoke ping + listen sidecar events
│   ├── lib/i18n.ts         # i18next config
│   ├── styles/globals.css  # Tailwind + 5 theme CSS variables
│   └── vite-env.d.ts
├── locales/                # i18next translations
│   ├── zh-CN.json
│   └── en-US.json
├── .github/workflows/ci.yml  # Windows-latest, lint+typecheck+test
└── (config files: tsconfig, vite, vitest, eslint, tailwind, postcss)
```

## Commands

```bash
npm run dev          # Vite dev server (frontend only, port 1420)
npm run tauri:dev    # Full app dev (Tauri + frontend)
npm run tauri:build  # Production build (Windows installer)
npm run node:dev     # Node sidecar standalone (debug via tsx watch)
npm run lint         # ESLint
npm run typecheck    # tsc -b --noEmit (both frontend + node)
npm run test         # Vitest
```

## Git Configuration

- **Author**: CATMIAOZHI <109326062+CATMIAOZHI@users.noreply.github.com>
- **Signing**: SSH (ed25519), key at `C:\Users\CAT\.ssh\id_ed25519_sign.pub`
- **commit.gpgsign**: true (global, all commits signed)
- **gpg.ssh.program**: `C:\Program Files\Git\usr\bin\ssh-keygen.exe`
- All commits show "Verified" on GitHub

## Development Environment

- **OS**: Windows (win32)
- **Shell**: PowerShell 5.1
- **Working dir**: `C:\Users\CAT\Documents\workspace\steamclip\RainySteamRecord`
- **Rust cargo path**: `C:\Users\CAT\.cargo\bin`
- **gh CLI**: v2.96.0, authenticated as CATMIAOZHI

### Known Issue: MSVC Build Tools NOT installed

Rust/Tauri compilation requires MSVC Build Tools (C++ compiler). Currently `cargo check` fails with:
```
error: could not compile `quote` (build script)
note: VS Code is a different product, and is not sufficient
```

**Fix**: Install MSVC Build Tools:
```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --passive --norestart"
```

Frontend-only dev works fine (`npm run dev`), but `npm run tauri:dev` and `npm run tauri:build` will fail until MSVC is installed.

## Migration Source: SteamClip (Python)

Original project: `C:\Users\CAT\Documents\workspace\steamclip\SteamClip\steamclip.py` (2280 lines, GPL-3.0)

### Key logic to migrate (phase 2):

1. **Binary VDF parser** (steamclip.py:484-553)
   - Type bytes: 0x00=map, 0x01=string, 0x02=uint32, 0x03=float, 0x07=uint64, 0x08=end
   - Strings: null-terminated, UTF-8 with replace
   - Recursive map parsing
   - **No npm package exists** — must hand-write in TypeScript using Buffer

2. **Non-Steam game appid CRC32** (steamclip.py:604-617)
   - `crc32(exe + appname) | 0x80000000`
   - Must calculate BOTH with-quotes and without-quotes versions of exe path
   - **Must use BigInt** — clip_id is 64-bit: `(app_id_32 << 32n) | 0x02000000n`
   - npm: `crc-32` package

3. **FFmpeg m4s concatenation** (steamclip.py:136-331, ConversionThread)
   - Binary concat: init-stream0.m4s + sorted chunk-stream0-*.m4s → temp mp4
   - Same for audio (stream1)
   - FFmpeg concat demuxer for multi-session: `ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4`
   - Final merge: `ffmpeg -i video.mp4 -i audio.mp4 -c copy output.mp4`
   - Stream copy only, no re-encoding
   - **Bug to fix**: `sorted()` in Python is string sort — chunk-stream0-10.m4s sorts before chunk-stream0-9.m4s. Use natural sort in TypeScript.

4. **Steam installation discovery** (steamclip.py:457-482)
   - Windows only now: `C:\Program Files (x86)\Steam`, `C:\Program Files\Steam`
   - Verify `userdata` subdirectory exists

5. **Thumbnail extraction** (steamclip.py:1214-1260)
   - Concat init-stream0.m4s + FIRST chunk only (optimization: don't concat all)
   - FFmpeg: `ffmpeg -y -ss 00:00:00.000 -i temp.mp4 -vframes 1 -q:v 2 output.jpg`
   - Fallback: placeholder image (use `sharp` npm package instead of PIL)

6. **Clip duration** (steamclip.py:1279-1308)
   - Parse session.mpd XML, extract `mediaPresentationDuration`
   - ISO 8601 duration parsing (Python hand-written has bugs)
   - npm: `iso8601-duration` package

7. **Steam API** (steamclip.py:862-873)
   - `GET https://store.steampowered.com/api/appdetails?appids={id}&filters=basic`
   - Cache in GameIDs.json: `{ "730": "Counter-Strike 2", ... }`

8. **Config** (steamclip.py:642-685)
   - Original: custom INI format (`key=value` lines)
   - New: JSON format (cleaner)
   - Path: `%LOCALAPPDATA%\RainySteamRecord\`

### Migration strategy: Hybrid (GPL-3.0 compliant)

- Simple logic (m4s concat, file scanning): clean-room implementation
- Complex algorithms (VDF parser, CRC32 appid): reference original Python source
- All derivative work covered by GPL-3.0 (same license = compliant)

## Themes (CSS variables)

5 themes implemented so far (of 13 planned):

| Theme | data-theme attr | Status |
|-------|-----------------|--------|
| Steam Dark | (default, no attr) | ✅ |
| Steam Light | `steam-light` | ✅ |
| Nord | `nord` | ✅ |
| Dracula | `dracula` | ✅ |
| Modern Dark | `modern-dark` | ✅ |
| Cyberpunk | | TODO |
| Neon Blue | | TODO |
| Gruvbox | | TODO |
| Catppuccin Mocha | | TODO |
| Pip-Boy | | TODO |
| CRT Amber | | TODO |
| High Contrast Light | | TODO |
| Follow System | | TODO (detect `prefers-color-scheme`) |

Original QSS definitions: steamclip.py:1811-2191

## Implementation Phases

### Phase 1: Scaffold ✅ DONE
- [x] Tauri 2 + React 19 + TS + Vite
- [x] Tailwind CSS + 5 themes
- [x] Node sidecar + IPC protocol (ping handler)
- [x] i18next bilingual
- [x] Vitest + ESLint + tsc
- [x] GPL-3.0 LICENSE + README
- [x] GitHub Actions CI (windows-latest)
- [x] Git SSH signing (global)
- [x] First commit pushed

### Phase 2: Backend Port (NOT STARTED)
- [ ] Steam discovery (Windows paths)
- [ ] Binary VDF parser (hand-written, with tests)
- [ ] Non-Steam games (CRC32 appid, BigInt)
- [ ] Clip scanner (userdata traversal, folder structure)
- [ ] FFmpeg converter (m4s → mp4, natural sort fix)
- [ ] Thumbnail generator (first frame + sharp placeholder)
- [ ] Duration parser (session.mpd XML + iso8601-duration)
- [ ] Steam API client (appdetails + cache)
- [ ] Config store (JSON)
- [ ] GitHub update check

### Phase 3: Frontend UI (NOT STARTED)
- [ ] FilterBar (SteamID / Game / Media type)
- [ ] ClipGrid (virtual scrolling with @tanstack/react-virtual)
- [ ] ClipCard (hover animations, selection state)
- [ ] ProgressOverlay (conversion progress + cancel)
- [ ] SettingsDialog
- [ ] UpdateDialog
- [ ] SteamVersionPicker (first-run)
- [ ] Remaining 8 themes
- [ ] Framer Motion transitions
- [ ] Frameless window controls (drag area, minimize/close buttons)

### Phase 4: Polish (NOT STARTED)
- [ ] Crash logging (Tauri panic hook + frontend error reporting)
- [ ] Release workflow (GitHub Actions, build Windows installer on tag)
- [ ] Packaging test (nsis + msi)
- [ ] Final i18n review

## Conventions

- **No comments in code** unless explicitly requested by user
- **No emojis** in code or commits unless explicitly requested
- **Commit messages**: concise, present tense, descriptive
- **File headers**: GPL-3.0 copyright notice on files that reference SteamClip logic
  ```
  // RainySteamRecord — [module description]
  // Copyright (C) 2026 CATMIAOZHI
  // Licensed under GPL-3.0. Portions based on SteamClip by Nastas95 (GPL-3.0).
  ```
- **Do not commit** unless user explicitly asks
- **Run lint + typecheck** before considering a task complete

## User Preferences

- Prefers concise responses (CLI environment)
- Prefers recommended options (will choose first/recommended option in questions)
- GitHub account: CATMIAOZHI
- Naming convention: `Rainy` prefix for projects
- Wants modern + smooth UI (animations, virtual scrolling, GPU-accelerated transitions)