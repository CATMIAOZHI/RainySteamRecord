# AGENTS.md — RainySteamRecord Project Context

> This file is for AI agents (opencode) to understand the project context across conversations.

## Project Overview

**RainySteamRecord** — A modern Windows GUI tool to browse and export Steam game recordings (DASH `.m4s` → `.mp4`).

- **Repo**: https://github.com/CATMIAOZHI/RainySteamRecord
- **License**: GPL-3.0 (portions based on SteamClip by Nastas95, also GPL-3.0)
- **Platform**: Windows only
- **Language**: UI bilingual (zh-CN default / en-US) via i18next; code comments/logs in English
- **Release**: https://github.com/CATMIAOZHI/RainySteamRecord/releases/tag/v0.1.0

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
| ffmpeg | `ffmpeg.rs` | m4s concat → mp4, natural sort, thumbnail extraction, FFmpeg fallback preview |
| streaming | `streaming.rs` | MSE streaming preview: session.mpd parsing, codec extraction, segment byte reading |
| clip | `clip.rs` | Clip scanning, duration parsing (ISO 8601), thumbnail generation |
| update | `update.rs` | GitHub release check |

### Key Rust Functions

| Function | Module | Purpose |
|----------|--------|---------|
| `find_session_mpd_paths` | `streaming.rs` | Recursive walk to find all `session.mpd` files — shared by `ffmpeg.rs` and `streaming.rs` |
| `get_clip_stream_info` | `streaming.rs` | Parse MPD XML → codec strings + chunk file paths per session |
| `read_segment_bytes` | `streaming.rs` | Read m4s file → `tauri::ipc::Response` (raw bytes, no JSON serialization) |
| `merge_clip_to_file` | `ffmpeg.rs` | Shared by `convert_single_clip` (export) and `prepare_preview` (FFmpeg fallback) |
| `prepare_preview` | `ffmpeg.rs` | Sync fn, wrapped in `spawn_blocking` at command layer |
| `convert_single_clip` | `ffmpeg.rs` | Async, uses `spawn_blocking` for blocking FFmpeg I/O |

## Frontend Components

| Component | File | Description |
|-----------|------|-------------|
| TitleBar | `components/TitleBar.tsx` | Frameless window controls (minimize/close) |
| FilterBar | `components/FilterBar.tsx` | SteamID / Game / Media type selects |
| ClipGrid | `components/ClipGrid.tsx` | 3-column grid, pagination, manages preview state |
| ClipCard | `components/ClipCard.tsx` | Thumbnail card, single-click select (250ms timer), double-click preview |
| VideoPreviewDialog | `components/VideoPreviewDialog.tsx` | MSE player + FFmpeg fallback, ESC to close, progressive chunk loading |
| BottomBar | `components/BottomBar.tsx` | Pagination + Convert/ExportAll/Clear buttons + progress bar |
| SettingsDialog | `components/SettingsDialog.tsx` | Theme/language/export path/game IDs/updates |
| SteamVersionPicker | `components/SteamVersionPicker.tsx` | First-run Steam location selection |

## Video Preview Pipeline

### MSE Streaming (Primary Path)
1. `getClipStreamInfo(clipFolder)` → Rust parses `session.mpd` XML → returns codec strings + chunk file paths
2. Create `MediaSource`, `addSourceBuffer` for video + audio with codec MIME types
3. Append init segments (`init-stream0.m4s` / `init-stream1.m4s`)
4. Append first batch of chunks → playback starts (~100ms)
5. `timeupdate` listener: when playback head <10s from buffer end, load next batch (3 chunks)
6. Multi-session: append next session's init segment + reset `timestampOffset`
7. Cleanup: `endOfStream()`, `revokeObjectURL()`, reset state

### FFmpeg Fallback (Secondary Path)
- Triggered when: MSE unsupported, codec not supported (e.g. HEVC on some systems), or any MSE error
- `preparePreview(clipFolder)` → FFmpeg concat+mux → temp mp4 → `convertFileSrc()` → `<video src>`
- `cleanupPreview(path)` called on dialog close to delete temp file

### Tauri Commands (20 total)

| Command | Type | Purpose |
|---------|------|---------|
| `get_config` / `save_config` | sync | App configuration |
| `find_steam_userdata` / `validate_userdata` / `list_steam_ids` | sync | Steam discovery |
| `list_clips` | sync | Scan clip folders |
| `get_clip_duration` | sync | Parse ISO 8601 duration from MPD |
| `generate_thumbnail` | async | Extract first frame via FFmpeg |
| `get_clip_stream_info` | sync | Parse MPD for MSE streaming |
| `read_segment_bytes` | sync | Read m4s file as raw bytes |
| `prepare_preview` | async (spawn_blocking) | FFmpeg concat → temp mp4 (fallback) |
| `cleanup_preview` | sync | Delete temp preview file |
| `get_game_ids` / `save_game_ids` | sync | Game name mapping |
| `fetch_game_name` | async | Steam API lookup |
| `merge_non_steam_games` | async | Import non-Steam game names |
| `convert_clips` | async | Batch export with progress events |
| `cancel_conversion` | sync | Cancel ongoing export |
| `check_for_updates` | async | GitHub release check |
| `open_folder` / `get_config_dir` | sync | Utilities |

## Steam Recording File Structure

```
clip_folder/
  session.mpd              ← XML manifest (codecs, duration, segment timeline)
  init-stream0.m4s         ← Video init segment (codec config)
  init-stream1.m4s         ← Audio init segment
  chunk-stream0-00001.m4s  ← Video media fragment 1
  chunk-stream0-00002.m4s  ← Video media fragment 2
  chunk-stream1-00001.m4s  ← Audio media fragment 1
  ...
```

- Files are **directly in the clip folder root** (not subdirectories)
- `session.mpd` contains codec strings: H.264 (`avc1.*`) or HEVC (`hev1.*`) for video, `mp4a.40.2` for audio
- `find_session_mpd_paths()` in `streaming.rs` does recursive walk to find all `session.mpd` files (shared by ffmpeg.rs)
- Multi-session clips (multiple `session.mpd`) are rare but supported

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

## CI/CD

- **Release workflow**: `.github/workflows/release.yml`
- Downloads FFmpeg during CI (not committed to git, 138MB)
- `tauri-action` builds NSIS + MSI installers
- Triggered by pushing a tag (e.g. `v0.1.0`)
- Release is created as draft, then published via `gh release edit --draft=false`

## FFmpeg Path Resolution

In `ffmpeg_path()`:
1. exe directory (`ffmpeg.exe` next to app binary)
2. `CARGO_MANIFEST_DIR/binaries/ffmpeg.exe` (dev)
3. `%LOCALAPPDATA%\RainySteamRecord\ffmpeg.exe`
4. System PATH (`where ffmpeg`)

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
- **npm**: requires `--legacy-peer-deps` (eslint peer dependency conflict)

## Conventions

- **No comments in code** unless explicitly requested
- **No emojis** in code or commits unless requested
- **Rainy style**: pink/sakura color scheme is default theme
- **Commit messages**: concise, descriptive
- **Run lint + typecheck** before considering a task complete
- **README style**: Rainy family format with 🐱, 🌸 emojis, feature tables, architecture diagrams

## User Preferences

- Chinese-first (zh-CN default, primary README)
- English README at `README_EN.md`
- Prefers concise responses (CLI environment)
- GitHub account: CATMIAOZHI
- Naming convention: `Rainy` prefix for projects
- Wants modern + smooth UI