# Phase 02: ai-chat-engine - Context

**Gathered:** 2026-05-21
**Status:** Ready for planning

<domain>
## Phase Boundary

核心对话体验——用户可以通过 GUI 与 AI agent 进行对话交互，包括消息发送、流式显示、Markdown 渲染、对话历史管理和新建/清空对话功能。

**覆盖需求：** CHAT-01~05
**移除需求：** GSD-01（/gsd-* 命令集成已从 Phase 2 移除，不在本项目范围内）

</domain>

<decisions>
## Implementation Decisions

### 消息状态管理
- **D-01:** 使用 **Zustand** 作为状态管理方案
  - 理由：轻量（~1KB）、简单无需 Provider wrapper、TypeScript 友好、支持 middleware（未来持久化/日志扩展）
  - 替代 Context API（重渲染问题）和 Redux（模板代码过多）

### 流式更新 IPC 机制
- **D-02:** 采用 **Channel 事件模式** 实现流式更新
  - 每个 stream 建立时返回唯一 ID（如 `stream-{id}`）
  - 主进程通过 IPC channel 事件推送 token
  - Renderer 用 `window.api.on('stream-{id}', handler)` 订阅
  - Stream 结束时自动清理 channel
- **D-03:** 流式显示为 **逐字显示**（一个字一个字输出，用户体验最流畅）

### 对话历史持久化
- **D-04:** 使用 **electron-store** 存储聊天历史
  - 每个 conversation 独立的 JSON 文件（避免单一文件过大）
  - SessionManager 管理 agent 运行状态（职责分离）
- **D-05:** 采用 **分页加载**策略
  - 默认加载最近 50 条消息
  - 用户上滑时懒加载更多历史消息
  - 解决大数据量下 JSON 文件性能问题

### 项目范围调整
- **D-06:** **GSD-01 已移除** — /gsd-* 命令集成不在 Phase 2 实现
  - GSD 是开发工具（蕾姆和您构建应用用的），不集成到应用本身
  - pi-workbench 应用不运行 GSD 工作流
  - Phase 2 聊天 UI 与 pi SDK 交互，不涉及 GSD

### Claude's Discretion
- 加载动画/骨架屏的具体设计
- Markdown 渲染的具体样式和代码高亮方案
- 输入框的具体 UI 设计（placeholder 文案、自动补全等）

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level context
- `.planning/PROJECT.md` — 项目愿景、核心技术决策（Electron, shadcn/ui, pi SDK）
- `.planning/REQUIREMENTS.md` — 完整需求详情：CHAT-01~05
- `.planning/ROADMAP.md` — Phase 2 目标、成功标准、边界定义
- `.planning/STATE.md` — 当前项目进度和已做决策
- `.planning/phases/01-foundation-workspace/01-CONTEXT.md` — Phase 1 架构决策（assistant-ui、ContextBridge、electron-store）

### No external specs yet
当前项目无外部 ADR 或规格文档。所有需求已在 REQUIREMENTS.md 和本 CONTEXT.md 中完整捕获。

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **assistant-ui** — Phase 1 决策：由 assistant-ui 负责 thread/message/composer/reasoning/tool-call
- **ContextBridge + typed IPC** — Phase 1 建立的安全通信模式
- **electron-store** — Phase 1 建立的数据持久化方案

### Established Patterns
- **Channel 事件模式** — 新增 streaming 事件通道，与现有 request/response IPC 共存
- **Zustand store** — Phase 2 新引入，作为消息状态管理方案

### Integration Points
- **主进程** — pi SDK streaming 输出，通过 IPC 推送 token
- **渲染进程** — Zustand store 管理消息状态，React 组件订阅状态渲染 UI
- **IPC 桥梁** — streaming token 传输（Channel 事件）、历史消息读写（invoke 调用）

</code_context>

<specifics>
## Specific Ideas

- 流式更新逐字显示，用户体验最流畅
- 每个 conversation 独立 JSON 文件，避免单文件过大
- 默认只加载最近 50 条，对话多了之后上滑懒加载

</specifics>

<deferred>
## Deferred Ideas

### GSD-01 用户命令集成
- **原始需求：** 用户可在聊天框输入 `/gsd-*` 执行 GSD 工作流
- **状态：** 已从 Phase 2 移除，不在本项目范围内
- **后续：** 如未来需要，重新评估是否作为独立 phase 或在 Phase 5 Workflow Builder 中考虑

### UI 设计契约
- **状态：** 暂未生成 UI-SPEC.md
- **后续：** 可通过 `/gsd-ui-phase 02` 生成 Phase 2 的 UI 设计契约

</deferred>

---

*Phase: 02-ai-chat-engine*
*Context gathered: 2026-05-21*