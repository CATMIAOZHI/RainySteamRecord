# 雨晴录像 RainySteamRecord

> *"Steam 录像，雨晴来整理~"* 🐱

[![Release](https://github.com/CATMIAOZHI/RainySteamRecord/actions/workflows/release.yml/badge.svg)](https://github.com/CATMIAOZHI/RainySteamRecord/releases)
[![Version](https://img.shields.io/github/v/release/CATMIAOZHI/RainySteamRecord?color=ff85a2)](https://github.com/CATMIAOZHI/RainySteamRecord/releases/latest)
[![License](https://img.shields.io/badge/License-GPL--3.0-blue?color=ff85a2)](LICENSE)

一个现代化的 Windows 桌面工具，用于浏览和导出 Steam 游戏录像（DASH `.m4s` → `.mp4`）。樱花色系 UI，双击即时预览，FFmpeg 无损转换，内置 14 套主题。

雨晴录像 RainySteamRecord — the Rainy Family tools.

---

## 🌸 功能一览

| 功能 | 说明 |
|------|------|
| 🎬 **即时预览** | 双击片段卡片直接播放，基于 MSE 流式喂入 fMP4 分段，首帧 ~100ms，无需等待转换 |
| 🖼️ **缩略图网格** | 自动提取首帧缩略图，3 列卡片网格，分页浏览，流畅动画 |
| 🎮 **自动识别游戏名** | 自动识别每个片段对应的游戏，包括非 Steam 游戏（模拟器、Epic 等），通过 Steam API + CRC32 appid |
| 📦 **批量导出** | 选中多个片段一键导出为 `.mp4`，FFmpeg `-c copy` 无损转换，自动重命名（游戏名_日期时间.mp4） |
| 🎨 **14 套内置主题** | 雨晴（默认）、Steam Dark、赛博朋克、霓虹蓝、Dracula、Nord、Gruvbox、Catppuccin 等 |
| 🌐 **中英双语** | 基于 i18next 的国际化，默认中文，可切换英文 |
| 🔄 **自动更新检测** | 启动时检查 GitHub Release 最新版本 |
| 🔒 **隐私保护** | 不收集任何数据，所有内容本地存储 |

---

## 📥 下载

前往 [Releases](https://github.com/CATMIAOZHI/RainySteamRecord/releases) 下载最新安装包。

| 格式 | 说明 |
|------|------|
| 📌 **NSIS 安装包** (.exe) | 推荐安装方式 |
| 📦 **MSI 安装包** (.msi) | 企业部署备用 |

> 内置 FFmpeg，无需单独安装，开箱即用~

---

## 🏗️ 技术架构

```
┌──────────────────────────────────────────────────┐
│                  React 19 + TypeScript            │
│          (Tailwind CSS + 14 主题 + Zustand)       │
│                        │                          │
│           invoke ──────┤──── listen (event)       │
│                        ▼                          │
│             Tauri 2 IPC 通道                       │
│                        │                          │
│     ┌──────────┬───────┴──┬──────────┐            │
│     ▼          ▼          ▼          ▼            │
│  config.rs  steam.rs   ffmpeg.rs  streaming.rs    │
│  配置管理   Steam发现   转换导出    MSE流式预览     │
│     │          │          │          │            │
│     ▼          ▼          ▼          ▼            │
│  JSON配置   VDF解析    FFmpeg子进程  fMP4分段读取   │
│  GameIDs    CRC32      concat+mux   tauri::Response│
└──────────────────────────────────────────────────┘
```

### 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2 (Rust) |
| 后端 | 纯 Rust（无 Node sidecar） |
| FFmpeg | 内置二进制（CI 下载，打包为 Tauri resources） |
| 前端 | React 19 + TypeScript + Vite |
| 样式 | Tailwind CSS + CSS 变量主题 |
| 状态管理 | Zustand |
| 国际化 | i18next |

### 视频预览技术方案

| 路径 | 方式 | 首帧延迟 |
|------|------|----------|
| **MSE 流式**（主） | 读取 m4s 分段 → MediaSource SourceBuffer → `<video>` 渐进式播放 | ~100ms |
| **FFmpeg 转换**（后备） | 拼接 m4s → 临时 mp4 → `convertFileSrc` 播放 | 数秒 |

MSE 不支持时（如 HEVC 编解码器在某些系统）自动回退到 FFmpeg 后备方案。

---

## 📁 项目结构

```
RainySteamRecord/
├── src-tauri/
│   └── src/
│       ├── lib.rs          # Tauri 命令注册 (20+ commands)
│       ├── config.rs       # 配置 + GameIDs 管理
│       ├── steam.rs        # Steam 发现, VDF 解析, 非 Steam 游戏
│       ├── ffmpeg.rs       # m4s concat → mp4, 缩略图提取, 预览后备
│       ├── streaming.rs     # MSE 流式预览 (session.mpd 解析, 分段读取)
│       ├── clip.rs          # 片段扫描, 时长解析, 缩略图生成
│       └── update.rs       # GitHub Release 更新检测
├── src/
│   ├── components/
│   │   ├── VideoPreviewDialog.tsx  # MSE 播放器 + FFmpeg 后备
│   │   ├── ClipCard.tsx            # 缩略图卡片 (单击选中/双击预览)
│   │   ├── ClipGrid.tsx            # 3 列网格 + 分页
│   │   ├── FilterBar.tsx           # SteamID/游戏/类型筛选
│   │   ├── BottomBar.tsx           # 导出/进度条
│   │   ├── SettingsDialog.tsx      # 主题/语言/路径设置
│   │   ├── TitleBar.tsx            # 无边框窗口控制
│   │   └── SteamVersionPicker.tsx  # 首次运行 Steam 定位
│   ├── lib/
│   │   ├── tauri-bridge.ts  # 类型化 invoke 封装
│   │   ├── theme.ts         # 14 主题管理
│   │   └── i18n.ts          # i18next 配置
│   └── stores/
│       └── app.ts           # Zustand 全局状态
├── locales/
│   ├── zh-CN.json
│   └── en-US.json
└── .github/workflows/
    └── release.yml          # CI: 下载 FFmpeg → Tauri build → 发布
```

---

## 🚀 开发

### 前置要求

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (stable 通道)
- [Tauri 2 前置依赖](https://v2.tauri.app/start/prerequisites/)
- MSVC Build Tools（Windows）

### 安装与运行

```bash
git clone https://github.com/CATMIAOZHI/RainySteamRecord
cd RainySteamRecord
npm install --legacy-peer-deps
npm run tauri:dev
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Vite 开发服务器（仅前端） |
| `npm run tauri:dev` | 启动 Tauri + 前端开发模式 |
| `npm run tauri:build` | 构建生产应用（NSIS + MSI） |
| `npm run lint` | 运行 ESLint |
| `npm run typecheck` | TypeScript 类型检查 |

### FFmpeg 二进制

FFmpeg 不提交到 git（138MB）。开发时手动放置到 `src-tauri/binaries/ffmpeg.exe`，CI 自动下载。路径解析顺序：exe 目录 → `CARGO_MANIFEST_DIR/binaries` → `%LOCALAPPDATA%\RainySteamRecord` → 系统 PATH。

---

## 🐱 关于雨晴

雨晴（Rainy）是一个以樱花粉色系为特色的工具系列，追求现代、简洁、流畅的用户体验。

- **作者**：CATMIAOZHI
- **仓库**：https://github.com/CATMIAOZHI/RainySteamRecord

---

## 📄 许可证

GPL-3.0，详见 [LICENSE](LICENSE)。

部分 Steam 数据发现逻辑（二进制 VDF 解析、非 Steam 游戏 appid CRC32 计算）
基于 [SteamClip](https://github.com/Nastas95/SteamClip)（作者 Nastas95，GPL-3.0 许可）。

---

*Made with 🐾 paws by Rainy*