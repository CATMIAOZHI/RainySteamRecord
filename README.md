# 雨晴录像 RainySteamRecord

> *"Steam 录像，雨晴来整理~"* 🐱

[![Release](https://github.com/CATMIAOZHI/RainySteamRecord/actions/workflows/release.yml/badge.svg)](https://github.com/CATMIAOZHI/RainySteamRecord/releases)
[![Version](https://img.shields.io/github/v/release/CATMIAOZHI/RainySteamRecord?color=ff85a2)](https://github.com/CATMIAOZHI/RainySteamRecord/releases/latest)
[![License](https://img.shields.io/badge/License-GPL--3.0-blue?color=ff85a2)](LICENSE)

一个现代化的 Windows 桌面工具，用于浏览、管理和导出 Steam 游戏录像（DASH `.m4s` → `.mp4`）。樱花色系 UI，双击即时预览，FFmpeg 无损转换，内置 14 套主题。

雨晴录像 RainySteamRecord — the Rainy Family tools.

---

## 🌸 功能一览

| 功能 | 说明 |
|------|------|
| 🎬 **即时预览** | 双击片段卡片直接播放，优先使用 MSE 流式播放；HEVC 等不兼容格式可按提示打开内置 mpv，剪辑窗口保持打开且不进行代理转码 |
| ✂️ **起止点裁剪** | 在内置预览中拖动范围、手动输入时间或按 I / O 设置入点和出点；支持切点准确的 H.264/AAC 重编码和受关键帧限制的无损快速导出 |
| 🖼️ **虚拟化录像库** | 自动提取首帧缩略图，以行虚拟化的自适应网格流畅浏览大量录像 |
| 🔎 **搜索、排序与筛选** | 搜索游戏名、App ID 或文件夹；按时间、时长、游戏、大小排序，并按 Steam ID、游戏、录像类型和日期范围筛选 |
| 📊 **元数据与健康检查** | 展示录像总大小、分辨率、编码、帧率、会话数等详情，并标记缺失、空文件或流结构异常 |
| 🗂️ **片段管理** | 支持 Shift 连选、筛选结果全选、批量重建缩略图/移入回收站，以及右键预览、改名、打开目录和复制路径 |
| 🎮 **自动识别游戏名** | 自动识别每个片段对应的游戏，包括非 Steam 游戏（模拟器、Epic 等），通过 Steam API + CRC32 appid |
| 📦 **可信导出** | 导出前检查源录像、目录权限、FFmpeg 和磁盘空间；任务中心显示复制/合并/封装阶段与字节进度，支持取消及仅重试失败项 |
| ⌨️ **快捷操作与通知** | Toast 汇总操作结果；支持全局快捷键以及用键盘选择卡片、打开预览和操作菜单 |
| 🎨 **14 套内置主题** | 雨晴（默认）、Steam Dark、赛博朋克、霓虹蓝、Dracula、Nord、Gruvbox、Catppuccin 等 |
| 🌐 **中英双语** | 基于 i18next 的国际化，默认中文，可切换英文 |
| 🔄 **更新检测** | 可在设置中检查 GitHub Release 最新版本 |
| 🔒 **隐私与安全** | 不收集任何数据；危险文件操作仅允许作用于当前扫描发现的录像，所有内容本地存储 |
| 🪟 **窗口体验** | 记忆窗口位置、大小和最大化状态，支持完整 Windows 标题栏操作与减少动画偏好 |

---

## 📥 下载

前往 [Releases](https://github.com/CATMIAOZHI/RainySteamRecord/releases) 下载最新安装包。

| 格式 | 说明 |
|------|------|
| 📌 **NSIS 安装包** (.exe) | 推荐安装方式 |
| 📦 **MSI 安装包** (.msi) | 企业部署备用 |

> 内置 FFmpeg 和 mpv，无需单独安装，开箱即用~

---

## 🏗️ 技术架构

```
┌──────────────────────────────────────────────────┐
│                  React 19 + TypeScript            │
│          (Tailwind CSS + 14 主题 + Zustand)       │
│                        │                          │
│        typed invoke ───┤── conversion-event       │
│                        ▼                          │
│             Tauri 2 IPC 通道                       │
│                        │                          │
│   ┌─────────┬──────┴─────┬──────────┬─────────┐    │
│   ▼         ▼            ▼          ▼         ▼    │
│ config.rs steam.rs clip.rs ffmpeg.rs streaming.rs  │
│ 配置管理  Steam发现  扫描/缓存 任务导出  MSE流式预览 │
└──────────────────────────────────────────────────┘
```

### 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2 (Rust) |
| 后端 | 纯 Rust（无 Node sidecar） |
| 媒体工具 | 内置 FFmpeg 与 mpv（打包为 Tauri resources） |
| 前端 | React 19 + TypeScript + Vite |
| 样式 | Tailwind CSS + CSS 变量主题 |
| 状态管理 | Zustand |
| 国际化 | i18next |

### 视频预览技术方案

| 路径 | 方式 | 首帧延迟 |
|------|------|----------|
| **MSE 流式**（主） | 读取 m4s 分段 → MediaSource SourceBuffer → `<video>` 渐进式播放，支持随机跳转 | ~100ms |
| **mpv 原生播放**（后备） | 不兼容时按提示打开 mpv 直接读取 `session.mpd`，原剪辑窗口保留以便手动输入时间点 | 无需预合并或转码 |

主程序使用 Windows Job Object 托管 FFmpeg 和 mpv；主程序退出时不会遗留媒体子进程。

完整导出和裁剪导出均采用原子文件提交和唯一文件名预留；开始前检查目标目录、源录像、FFmpeg、目标磁盘及系统临时磁盘空间。导出期间关闭应用会先请求取消任务，已完成文件不会被删除。

裁剪时间可输入秒数（`90.5`）、分秒（`01:30.50`）或时分秒（`01:02:03.25`）；按 Enter 或移开焦点后应用。

录像扫描支持把元数据、大小和健康检查结果写入版本化的 `clips_cache.json`，通过目录指纹只重扫新增或变化的录像，并可显式绕过缓存执行完整扫描。

---

## 📁 项目结构

```
RainySteamRecord/
├── src-tauri/
│   └── src/
│       ├── lib.rs          # Tauri 命令注册
│       ├── config.rs       # 配置 + GameIDs 管理
│       ├── steam.rs        # Steam 发现, VDF 解析, 非 Steam 游戏
│       ├── ffmpeg.rs       # m4s concat → mp4, 缩略图提取, 预览后备
│       ├── mpv.rs          # 内置 mpv 原生播放
│       ├── process_job.rs  # Windows Job Object 子进程托管
│       ├── streaming.rs     # MSE 流式预览 (session.mpd 解析, 分段读取)
│       ├── clip.rs          # 扫描, 元数据/大小/健康检查, 版本化增量缓存
│       └── update.rs       # GitHub Release 更新检测
├── src/
│   ├── components/
│   │   ├── VideoPreviewDialog.tsx  # MSE 播放器 + mpv/FFmpeg 后备
│   │   ├── ClipCard.tsx            # 缩略图卡片与右键管理菜单
│   │   ├── ClipGrid.tsx            # 自适应虚拟化网格
│   │   ├── ClipDetailsDialog.tsx   # 元数据与健康详情
│   │   ├── ExportJobCenter.tsx     # 导出任务与失败重试
│   │   ├── FilterBar.tsx           # 搜索/排序/组合筛选
│   │   ├── BottomBar.tsx           # 统计与批量操作
│   │   ├── ToastViewport.tsx       # 全局操作通知
│   │   ├── SettingsDialog.tsx      # 主题/语言/路径设置
│   │   ├── TitleBar.tsx            # 无边框窗口控制
│   │   └── SteamVersionPicker.tsx  # 首次运行 Steam 定位
│   ├── lib/
│   │   ├── tauri-bridge.ts  # 类型化 invoke 封装
│   │   ├── theme.ts         # 14 主题管理
│   │   ├── i18n.ts          # i18next 配置
│   │   ├── clip-library.ts  # 查询、排序、筛选逻辑
│   │   ├── thumbnail-cache.ts # 内存缩略图缓存
│   │   └── overlay.ts       # 弹窗注册与 Esc 关闭
│   └── stores/
│       ├── app.ts           # Zustand 全局状态（初始化、录像库、选择）
│       ├── export-jobs.ts   # 导出任务状态与事件归约
│       └── toast.ts         # Toast 通知状态
├── locales/
│   ├── zh-CN.json
│   └── en-US.json
└── .github/workflows/
    └── release.yml          # CI: 固定并校验媒体工具 → Tauri build → 发布
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
| `npm test` | 运行 Vitest 单元测试 |
| `npm run check:version` | 检查 npm、Cargo、Tauri 与发布 tag 版本一致性 |

### 媒体二进制

FFmpeg 和 mpv 二进制不提交到 git。开发时将 `ffmpeg.exe`、`mpv.exe` 和 `d3dcompiler_43.dll` 放到 `src-tauri/binaries/`；CI 使用固定版本 URL 下载 FFmpeg/mpv，校验归档 SHA-256 后再随安装包分发。FFmpeg 路径解析顺序：exe 目录 → `CARGO_MANIFEST_DIR/binaries` → `%LOCALAPPDATA%\RainySteamRecord` → 系统 PATH。

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
