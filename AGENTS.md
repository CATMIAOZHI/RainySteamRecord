# AGENTS.md — RainySteamRecord Project Context

> This file is for AI agents (opencode) to understand the project context across conversations.

## Project Overview

**RainySteamRecord** — A modern Windows GUI tool to browse and export Steam game recordings (DASH `.m4s` → `.mp4`).

- **Repo**: https://github.com/CATMIAOZHI/RainySteamRecord
- **License**: GPL-3.0 (portions based on SteamClip by Nastas95, also GPL-3.0)
- **Platform**: Windows only
- **Language**: UI bilingual (zh-CN default / en-US) via i18next; code comments/logs in English
- **Release**: https://github.com/CATMIAOZHI/RainySteamRecord/releases/tag/v0.2.0

## Architecture

```
React UI ── typed invoke / conversion-event ── Rust (Tauri 2) ── filesystem / managed media processes
```

All backend logic is in Rust (no Node sidecar). Zustand owns library, selection, Toast, and export-job UI state; the backend owns scanning, metadata/health analysis, cache persistence, media I/O, and the single active conversion process.

| Layer | Tech | Location |
|-------|------|----------|
| Desktop shell + backend | Tauri 2 (Rust) | `src-tauri/src/` |
| Frontend | React 19 + TypeScript + Vite | `src/` |
| Styling | Tailwind CSS + CSS variables (14 themes) | `src/styles/` |
| State | Zustand | `src/stores/app.ts`, `src/stores/export-jobs.ts`, `src/stores/toast.ts` |
| i18n | i18next + react-i18next | `locales/`, `src/lib/i18n.ts` |

## Rust Backend Modules

| Module | File | Description |
|--------|------|-------------|
| config | `config.rs` | JSON config + GameIDs.json in `%LOCALAPPDATA%\RainySteamRecord\` |
| steam | `steam.rs` | Steam discovery, binary VDF parser, non-Steam CRC32 appid, Steam API |
| ffmpeg | `ffmpeg.rs` | m4s concat → mp4, thumbnail extraction, cancellable exports, FFmpeg fallback preview |
| mpv | `mpv.rs` | Launch bundled mpv for native HEVC/DASH playback |
| process_job | `process_job.rs` | Windows Job Object ownership for FFmpeg/mpv child processes |
| streaming | `streaming.rs` | MSE streaming preview: session.mpd parsing, codec/duration extraction, segment byte reading |
| clip | `clip.rs` | Clip scanning, MPD metadata/size/health analysis, thumbnail generation (Semaphore-limited), versioned fingerprint cache (`clips_cache.json`) |
| update | `update.rs` | GitHub release check |

### Key Rust Functions

| Function | Module | Purpose |
|----------|--------|---------|
| `find_session_mpd_paths` | `streaming.rs` | Recursive walk (depth-limited at 16) to find all `session.mpd` files — shared by `ffmpeg.rs` and `streaming.rs` |
| `get_clip_stream_info` | `streaming.rs` | Parse MPD XML → codec strings, durations, chunk file paths per session |
| `read_segment_bytes` | `streaming.rs` | Read a size-limited m4s segment as raw bytes — validates file name (`chunk-stream*` / `init-stream*`, `.m4s`) |
| `merge_clip_to_file` | `ffmpeg.rs` | Shared by `convert_single_clip` (export) and `prepare_preview` (FFmpeg fallback) |
| `reserve_unique_filename` | `ffmpeg.rs` | Token-based output file reservation — writes UUID token to placeholder file |
| `commit_output` | `ffmpeg.rs` | Atomically replace reserved file via `MoveFileExW`; verifies token before replacing |
| `prepare_preview` | `ffmpeg.rs` | Sync fn, wrapped in `spawn_blocking` at command layer |
| `convert_single_clip` | `ffmpeg.rs` | Async, uses `spawn_blocking` for blocking FFmpeg I/O |
| `replace_file` | `config.rs`, `clip.rs`, `ffmpeg.rs` | Windows atomic file replacement via `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING` |

## Frontend Components

| Component | File | Description |
|-----------|------|-------------|
| TitleBar | `components/TitleBar.tsx` | Frameless window controls (minimize/close) |
| FilterBar | `components/FilterBar.tsx` | Steam ID, game, media type, and date-range filters |
| ClipGrid | `components/ClipGrid.tsx` | Responsive row-virtualized grid and preview/details state |
| ClipCard | `components/ClipCard.tsx` | Selection/Shift-range selection, health, preview, thumbnail, and management menu |
| ClipDetailsDialog | `components/ClipDetailsDialog.tsx` | Metadata, size, stream/session details, and health issues |
| VideoPreviewDialog | `components/VideoPreviewDialog.tsx` | MSE player with native mpv and FFmpeg fallbacks |
| BottomBar | `components/BottomBar.tsx` | Result/size summary and selection batch actions |
| ExportJobCenter | `components/ExportJobCenter.tsx` | Per-item export status, cancellation, and failed-item retry |
| ToastViewport | `components/ToastViewport.tsx` | Global transient operation feedback |
| SettingsDialog | `components/SettingsDialog.tsx` | Theme/language/export path/game IDs/updates |
| SteamVersionPicker | `components/SteamVersionPicker.tsx` | First-run Steam location selection |

## Video Preview Pipeline

### MSE Streaming (Primary Path)
1. `getClipStreamInfo(clipFolder)` → Rust parses `session.mpd` XML → returns codec strings, durations, chunk file paths per session
2. Create `MediaSource`, set `ms.duration` to total clip duration, `addSourceBuffer` for video + audio
3. Append init segments (`init-stream0.m4s` / `init-stream1.m4s`)
4. Append first batch of chunks → playback starts (~100ms)
5. `timeupdate` listener: when playback head <30s from buffer end, load next batch (5 chunks)
6. Seek to unbuffered position: `seeking` event → dispose MSE, rebuild from target chunk with `timestampOffset` aligned to real timeline
7. Multi-session: append next session's init segment + reset `timestampOffset`
8. Cleanup: `endOfStream()`, `revokeObjectURL()`, reset state

### Preview Fallbacks
- MSE failure first launches bundled mpv against `session.mpd`, providing native HEVC playback without pre-merging the recording.
- If mpv cannot launch, `preparePreview(clipFolder)` uses FFmpeg concat+mux to create a temporary MP4 for `<video>`.
- `cleanupPreview(path)` deletes temporary FFmpeg previews when the dialog closes.

### Backend Contract

- `list_clips` returns complete clip metadata, aggregate byte size, health status/issues, and uses the versioned per-library fingerprint cache unless a forced refresh disables it.
- Clip management supports single and batch thumbnail regeneration and recycle-bin deletion; batch commands return per-item successes and failures.
- `convert_clips(job_id, ...)` emits tagged `conversion-event` lifecycle events (`job-started`, per-item started/succeeded/failed, `job-finished`); cancellation is job-ID scoped and only one backend conversion job may run at once. The active job slot is cleared **before** `job-finished` is emitted so a new job can start immediately.
- Export output uses token-based file reservation: `reserve_unique_filename` creates a placeholder with a random UUID token; `commit_output` verifies the token before atomically replacing via `MoveFileExW`; failed commits clean up both the temp file and the reservation.
- Cancellation is checked right before the final `commit_output` rename, so a cancelled job never produces output.
- `cleanup_preview` only deletes files matching `rainy_preview_*.mp4` inside `%TEMP%`.
- Preview commands expose MSE stream metadata/segments, native mpv launch, and FFmpeg temporary-file fallback.

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
- `find_session_mpd_paths()` in `streaming.rs` does recursive walk (depth limit 16) to find all `session.mpd` files (shared by ffmpeg.rs and mpv.rs)
- Multi-session clips (multiple `session.mpd`) are rare but supported; mpv launches all MPDs as a playlist

## Themes (14 total, Rainy is default)

Default theme is "雨晴" (Rainy) — pink/sakura color scheme per user's design system.

## Commands

```bash
npm run dev          # Vite dev server (frontend only, port 1420)
npm run tauri:dev    # Full app dev (Tauri + frontend)
npm run tauri:build  # Production build (Windows installer: nsis + msi)
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # Vitest unit tests
```

## CI/CD

- **Release workflow**: `.github/workflows/release.yml`
- Downloads pinned FFmpeg/mpv archives and verifies their SHA-256 checksums; media binaries are not committed
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
- **MSVC Build Tools**: Installed (VS 2022 Build Tools, MSVC 14.44, Windows SDK) — `cargo build`, `cargo test`, `tauri:dev`, `tauri:build` all work locally
- **npm**: requires `--legacy-peer-deps` (eslint peer dependency conflict)
- **Tauri `protocol-asset` feature**: enabled in `Cargo.toml` (required by `assetProtocol` scope in `tauri.conf.json`)
- **NSIS/WiX language**: Chinese (`SimpChinese` / `zh-CN`) configured in `tauri.conf.json`

## Conventions

- **No comments in code** unless explicitly requested
- **No emojis** in code or commits unless requested
- **Rainy style**: pink/sakura color scheme is default theme
- **Commit messages**: concise, descriptive
- **All `std::process::Command`** on Windows must use `CREATE_NO_WINDOW` (`0x08000000`) via `creation_flags()` to avoid flashing console windows
- **All long-lived FFmpeg/mpv children** must be assigned to `ProcessJob`; failure to assign must terminate the child immediately
- **Windows atomic file replacement** must use `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING` (via the `replace_file` helper) — `std::fs::rename` does NOT overwrite existing files on Windows
- **AppState locks**: `config_save_lock` and `game_ids_save_lock` are separate `tokio::sync::Mutex<()>` that serialize write-to-disk operations; the sync `config` and `game_ids` `std::sync::Mutex` fields protect in-memory data. `get_config` uses `blocking_lock()` on `config_save_lock` (safe only because Tauri commands run on a thread-pool, not the async runtime's main thread)
- **Run lint + typecheck** before considering a task complete
- **README style**: Rainy family format with 🐱, 🌸 emojis, feature tables, architecture diagrams

## User Preferences

- Chinese-first (zh-CN default, primary README)
- English README at `README_EN.md`
- Prefers concise responses (CLI environment)
- GitHub account: CATMIAOZHI
- Naming convention: `Rainy` prefix for projects
- Wants modern + smooth UI
