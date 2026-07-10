# RainySteamRecord

[![License](https://img.shields.io/badge/License-GPL--3.0-blue?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows-blue?style=for-the-badge)](#)
[![Tech](https://img.shields.io/badge/Tauri-2.x-orange?style=for-the-badge)](https://tauri.app)

[English](README_EN.md) | 中文

> 一个现代化的 Windows 桌面工具，用于浏览和导出 Steam 游戏录像（DASH `.m4s` → `.mp4`）。

Steam 将录像存储为分段的 `.m4s` 文件（DASH 格式）。Steam 自带的导出功能虽然能用，但经常出现画面模糊和卡顿。RainySteamRecord 使用 FFmpeg 将这些录像转换为清晰流畅的 `.mp4` 文件，无画面瑕疵、无时长限制。

---

## 功能特性

- **片段浏览器** — 缩略图网格展示，虚拟滚动、流畅动画、分页控制
- **自动识别游戏名称** — 自动识别每个片段对应的游戏，包括非 Steam 游戏（模拟器、Epic 等）
- **内置 FFmpeg** — 无需单独安装，开箱即用
- **13 套内置主题** — Steam Dark、赛博朋克、霓虹蓝、Dracula、Nord、Gruvbox、Catppuccin 等
- **中英双语界面** — 基于 i18next 的国际化支持
- **隐私保护** — 不收集任何数据，所有内容本地存储

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2 (Rust) |
| 后端核心 | Node.js sidecar（stdio JSON-RPC） |
| FFmpeg | `ffmpeg-static`（内置二进制） |
| 前端 | React 19 + TypeScript + Vite |
| 样式 | Tailwind CSS + CSS 变量主题 |
| 状态管理 | Zustand |
| 国际化 | i18next |

---

## 开发

### 前置要求

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/)（stable 通道）
- [Tauri 2 前置依赖](https://v2.tauri.app/start/prerequisites/)

### 安装与运行

```bash
git clone https://github.com/CATMIAOZHI/RainySteamRecord
cd RainySteamRecord
npm install
npm run tauri:dev
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Vite 开发服务器（仅前端） |
| `npm run tauri:dev` | 启动 Tauri + 前端开发模式 |
| `npm run tauri:build` | 构建生产应用（Windows 安装包） |
| `npm run node:dev` | 单独启动 Node sidecar（调试用） |
| `npm run lint` | 运行 ESLint |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run test` | 运行 Vitest 测试 |

---

## 许可证

GPL-3.0，详见 [LICENSE](LICENSE)。

部分 Steam 数据发现逻辑（二进制 VDF 解析、非 Steam 游戏 appid CRC32 计算）
基于 [SteamClip](https://github.com/Nastas95/SteamClip)（作者 Nastas95，GPL-3.0 许可）。

---

*为 PC 游戏社区开发。*