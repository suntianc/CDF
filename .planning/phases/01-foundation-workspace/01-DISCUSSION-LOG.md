# Phase 1: Foundation & Workspace - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 01-foundation-workspace
**Areas discussed:** UI Component Library, Data Persistence, App Startup Flow, Layout & Navigation, Model Provider Config UX, Theme Implementation

---

## UI Component Library

| Option | Description | Selected |
|--------|-------------|----------|
| shadcn/ui + Radix ✅ | 基于 Radix 无头组件 + Tailwind CSS，完全可定制，生态强大 | ✓ |
| Ant Design | 全功能组件库，体积大但开箱即用 | |
| Custom (Radix only) | 仅 Radix + 自定义样式，最轻量但工作量大 | |

**User's choice:** shadcn/ui + Radix
**Notes:** 用户偏好现代化、可定制的方案，与 Electron 项目常用选型一致

---

## Data Persistence

| Option | Description | Selected |
|--------|-------------|----------|
| electron-store ✅ | 专为 Electron 设计，v11 活跃维护，33.5k 项目使用 | ✓ |
| Custom JSON file | 零依赖但需自行处理原子写入 | |
| SQLite (better-sqlite3) | 功能强但 Phase 1 过度设计 | |

**User's choice:** electron-store
**Notes:** 用户要求先调研。调研发现 electron-store 仍在活跃维护（2025-10 v11.0.2，2026-03 最后提交），最适合配置/工作区列表/窗口状态场景。API Key 可用 encryptionKey 加密存储。

---

## App Startup Flow

| Option | Description | Selected |
|--------|-------------|----------|
| 首次选工作区，后续自动恢复 | 首次启动弹出选择，后续自动恢复 | |
| 每次都显示工作区选择器 | 每次启动都选工作区 | |
| 固定工作区（无选择） | 无工作区概念 | |
| 用户自定义描述 ✅ | 有默认工作区，可添加/切换，任务不中断 | ✓ |

**User's choice:** 自由描述：存在默认工作区，用户可以添加新的工作区，支持切换工作区，各工作区任务不干扰、不终止
**Notes:**
- 默认工作区 = 启动目录
- 用户可从设置/侧边栏添加新工作区
- 切换工作区时旧 agent session 不销毁

---

## Layout & Navigation

| Option | Description | Selected |
|--------|-------------|----------|
| 固定侧边栏 + Tab 导航 | Claude Code 风格，底部 Tab | |
| 窄图标栏 + 展开面板 | Jan 风格，极简图标栏 | |
| 可折叠侧边栏 | 展开/图标双模式 | |
| Codex 风格 ✅ | Codex Desktop 侧边栏参考 | ✓ |

**User's choice:** Codex Desktop 风格侧边栏布局
**Notes:**
- 调研了 Claude Code（固定侧边栏 + Tab 导航）、Jan（窄图标栏 + 展开面板）、Codex Desktop（项目/对话管理侧边栏）
- 用户偏好 Codex 方案：侧边栏从上到下 = 新对话按钮 → 导航项(Skills/MCP/Settings) → 工作区列表 → 对话列表
- 主内容区默认显示居中欢迎对话框「我们该做什么？」
- 无对话时显示居中输入框
- 侧边栏工作区标题 hover 显示「+」按钮（同 Codex 设计）

---

## Model Provider Config UX

| Option | Description | Selected |
|--------|-------------|----------|
| 预设模板 + API Key 表单 ✅ | 预设 Anthropic/OpenAI/Google，填 Key 即可 | ✓ |
| 完全手动配置 | 名称、URL、Key、模型名全手动 | |
| 启动向导引导配置 | 首次启动弹出配置向导 | |

**User's choice:** 预设模板 + API Key 表单
**Notes:**
- 配置入口为设置页面（全页，非对话框）
- 额外支持「自定义 OpenAI 兼容」入口

---

## Theme Implementation

| Option | Description | Selected |
|--------|-------------|----------|
| 跟随系统 + 手动覆盖（三档）✅ | 跟随系统 / 亮色 / 暗色 | ✓ |
| 纯手动切换（两档） | 亮 / 暗 手动选择 | |
| 仅跟随系统 | 无手动选项 | |

**User's choice:** 跟随系统 + 手动覆盖（三档）
**Notes:**
- 入口仅在设置页面（无快捷图标）

---

## the agent's Discretion

- 加载动画/骨架屏的具体设计
- 欢迎对话框的具体样式和文案
- 空状态、错误状态的具体 UI 处理
- 工作区列表的排序和展示细节
- 主题切换的具体 CSS 变量命名方案
- 文件选择对话框的初始目录策略

## Deferred Ideas

None — 讨论保持在 Phase 1 范围内。

---

*Phase: 01-foundation-workspace*
*Discussion recorded: 2026-05-19*