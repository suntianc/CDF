# Phase 02: ai-chat-engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-21
**Phase:** 02-ai-chat-engine
**Areas discussed:** 消息状态管理, 流式更新 IPC 机制, 对话历史持久化策略, GSD-01 范围确认

---

## 消息状态管理

| Option | Description | Selected |
|--------|-------------|----------|
| Zustand（推荐） | 轻量、简单、TypeScript 友好、支持 middleware | ✓ |
| Context API | React 内置，不需要额外依赖，但可能有重渲染问题 | |
| Redux Toolkit | 功能最强大，但模板代码多，适合大型应用 | |
| 您决定 | 让蕾姆根据场景自己选 | |

**User's choice:** Zustand（推荐）
**Notes:** 用户确认 Zustand 作为消息状态管理方案

---

## 流式更新 IPC 机制

### 问题 1：流式体验形式

| Option | Description | Selected |
|--------|-------------|----------|
| 逐字显示（推荐） | AI 输出一个字，界面立即显示一个字，用户体验最流畅 | ✓ |
| 逐块显示 | AI 输出几个字后，界面批量刷新一次，实现稍简单 | |
| 您决定 | 让蕾姆根据 assistant-ui 的特性自己选 | |

**User's choice:** 逐字显示（推荐）
**Notes:** 确认逐字显示方案

### 问题 2：IPC 传输机制

| Option | Description | Selected |
|--------|-------------|----------|
| Channel 事件模式（推荐） | 每个 stream 有唯一 ID，token 通过 channel 事件推送，支持多 listener | ✓ |
| Callback 订阅模式 | subscribeStream(callback) 简单直接，但多个 stream 时 callback 管理复杂 | |
| 您决定 | 让蕾姆自己选 | |

**User's choice:** Channel 事件模式（推荐）
**Notes:** 用户询问了对多 agent 场景的影响后，确认 Channel 事件模式方案

---

## 对话历史持久化策略

### 问题 1：存储方案

| Option | Description | Selected |
|--------|-------------|----------|
| pi SDK SessionManager（推荐） | 用 pi SDK 原生的 SessionManager 处理历史，简化应用层逻辑 | |
| electron-store | 继续用 electron-store，与 Phase 1 保持一致，数据自己掌控 | |
| SQLite | 用本地数据库，高效但需要额外依赖 native 模块 | |
| 您决定 | 让蕾姆自己选 | |

**User's choice:** 混合方案（electron-store + SessionManager）
**Notes:** 用户询问多 agent 影响后，提出混合方案——electron-store 存聊天历史，SessionManager 管 agent 状态

### 问题 2：数据量大的解决方案

确认方案：
- electron-store 存聊天历史（按 conversation 分文件）
- 默认加载最近 50 条消息
- 用户上滑时懒加载更多

**User's choice:** 确认
**Notes:** 用户确认分页加载方案

---

## GSD-01 范围确认

| Option | Description | Selected |
|--------|-------------|----------|
| 从 Phase 2 移除 | GSD 命令集成不在 Phase 2 实现，后续 phase 再考虑 | ✓ |
| 降低优先级 | 保留需求但不作为 Phase 2 核心目标，实现方式简化处理 | |
| 维持原目标 | 继续按原计划实现 /gsd-* 命令的检测和路由 | |

**User's choice:** 从 Phase 2 移除
**Notes:** 用户明确 GSD 是开发工具（蕾姆和您构建应用用的），不集成到应用本身。pi-workbench 应用不运行 GSD 工作流。

---

## Claude's Discretion

以下领域用户让蕾姆自行决定：
- 加载动画/骨架屏的具体设计
- Markdown 渲染的具体样式和代码高亮方案
- 输入框的具体 UI 设计（placeholder 文案、自动补全等）

## Deferred Ideas

1. **GSD-01 用户命令集成** — 已从 Phase 2 移除，未来如需要可重新评估
2. **UI 设计契约** — 暂未生成 UI-SPEC.md，可通过 `/gsd-ui-phase 02` 生成