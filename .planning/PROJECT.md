# pi-workbench

> 名字待定——一个基于 pi-coding-agent + GSD 的桌面 agent 工作台

## What This Is

一个面向开发者的桌面 agent 工作台，基于 pi-coding-agent SDK 构建。它提供图形界面来管理 AI 对话、配置模型提供商、安装和执行 skills、接入 MCP 服务器，以及管理工作区。V1 定位为轻量工作台，以人工调用 skills 驱动编码工作流。

## Core Value

用户可以通过 GUI 方便地管理和调用 AI agent 及 GSD 编码工作流，而不必局限于命令行。

## Requirements

### Validated

- [x] **WS-01**: 用户可以选择本地文件夹作为工作区 *(Validated in Phase 1)*
- [x] **WS-02**: 应用基于工作区加载对应的 skills 和 GSD 工作流 *(Validated in Phase 1)*
- [x] **PROV-01**: 用户可以配置 AI 模型提供商（API Key、Model 选择） *(Validated in Phase 1)*
- [x] **PROV-02**: 模型配置持久化到本地存储 *(Validated in Phase 1)*

### Active

- [ ] **MCP-01**: 用户可以添加 MCP server 配置（名称、命令、参数）
- [ ] **MCP-02**: 已连接的 MCP server 工具自动注入到 agent 的可用工具集
- [ ] **MCP-03**: 用户可以管理 MCP server 的连接状态（连接/断开）
- [ ] **SKILL-01**: 用户可以从本地导入 skill（`.md` 文件或目录）
- [ ] **SKILL-02**: 用户可以从 GitHub 仓库下载安装 skills
- [ ] **SKILL-03**: 用户可以在 UI 中查看已安装的 skills 列表
- [ ] **SKILL-04**: 用户可以在 UI 中点击执行某个 skill
- [ ] **GSD-02**: GSD 的子 agent（executor、planner、debugger 等）可通过 skills 驱动自动生成

### Validated in Phase 2

- [x] **CHAT-01**: 用户可以与 AI agent 进行对话交互 *(Validated in Phase 2)*
- [x] **CHAT-02**: 对话消息实时流式显示（streaming） *(Validated in Phase 2)*
- [x] **CHAT-03**: 对话历史可以持久化和恢复 *(Validated in Phase 2)*
- [x] **CHAT-04**: 对话历史持久化到 pi SDK SessionManager *(Validated in Phase 2)*
- [x] **CHAT-05**: 新建/清空对话 *(Validated in Phase 2)*
- [x] **GSD-01**: 应用集成 pi-gsd 工作流，支持 `discuss → plan → execute → verify` 循环 *(Validated in Phase 2)*

### Out of Scope

- **可视化流程编排**（V2）— V1 不做拖拽式工作流编辑器，以人工调用 skills 为主
- **作为 MCP server 暴露**（V2）— V1 只作为 MCP 客户端调用他人 server
- **移动端**（V2+）— Desktop only
- **多用户/团队协作**（V2+）— V1 为个人工具
- **Agent 市场/商店**（V2+）— V1 skills 只支持本地导入和 GitHub 下载
- **自定义 Agent 创建 UI**（V2+）— V1 agent 由 GSD skill 定义驱动

## Context

- pi-coding-agent 是一个高度灵活的 AI 编码 agent 框架，提供了 SDK（`@earendil-works/pi-coding-agent`）和丰富的扩展机制
- pi-gsd（v2.1.4）是 GSD 工作流的 pi 移植版，包含 18+ 子 agent（executor、planner、debugger 等）和完整的 discuss→plan→execute→verify 流程
- pi 通过 `@modelcontextprotocol/sdk` 以 extensions 方式接入 MCP（如 firecrawl、exa）
- GSD 本身已具备子 agent 生成机制（`Task()` 原语+agents/ 目录定义），多 agent 协作由 skills 驱动
- 该工具本质上是 pi 的 GUI 前端 + 增强版工作台

## Constraints

- **技术栈**: Electron + React + TypeScript — 前端生态优先
- **核心依赖**: 基于 pi SDK，需跟随其版本演进
- **跨平台**: 优先 macOS，后续 Windows/Linux
- **性能**: agent 对话和 skill 执行在 Electron 主进程中进行，需注意长任务不阻塞 UI

## Key Decisions

| Decision | Rationale | Outcome |
| -------- | --------- | ------- |
| Electron（非 Tauri） | 前端生态丰富，与 pi SDK 同为 Node.js/TS 原生兼容 | ✓ Implemented |
| pi SDK 主进程直接集成 | 无需子进程桥接，IPC 仅传输事件到渲染层 | ✓ Implemented |
| V1 轻量工作台 | 降低首次交付门槛，先验证核心价值 | ✓ Phase 1 complete |
| Skills 驱动多 agent | GSD 已有完整的子 agent 机制，复用而非重建 | - Pending (Phase 3) |
| SessionManager for conversation persistence | pi SDK SessionManager handles JSONL session format | ✓ Implemented (Phase 2) |
| Streaming via IPC chunks | Real-time AI response streaming via IPC event forwarding | ✓ Implemented (Phase 2) |
| shiki for markdown code highlighting | Syntax highlighting with github-light/dark themes | ✓ Implemented (Phase 2) |
| GSD commands via child_process | /gsd-* commands executed via cmdk palette + child_process | ✓ Implemented (Phase 2) |
| Message queuing during AI reply | Queue messages when typing during AI generation | ✓ Implemented (Phase 2) |
| Image upload via paste | Paste/drag images, send as base64 data URLs | ✓ Implemented (Phase 2) |

---
*Last updated: 2026-05-20 after Phase 2 completion*