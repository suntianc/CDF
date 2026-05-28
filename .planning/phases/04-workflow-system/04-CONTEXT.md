# Phase 4: Workflow System - Context

**Gathered:** 2026-05-27
**Status:** Ready for planning

<domain>
## Phase Boundary

用户可通过 ReactFlow 可视化编排工作流，执行并监控节点状态。利用 LangGraph.js 的图运行时作为工作流执行引擎，所有可执行节点均为 Agent 节点（引用 Agent 资产库），通过 LangGraph StateGraph 实现编排控制流（分支、循环、并行、停止）。

核心设计理念转变：工作流不是"脚本编排"，而是"Agent 编排"。重点在于 Agent 之间的控制流设计，而非代码执行。

Phase 4 必须建立**独立工作流运行时**，不能直接把 Chat runtime 当作工作流 runtime 使用。现有 `createDeepAgentRuntime(projectId, sessionId, currentMessage, ...)` 面向聊天会话、消息输入和 session checkpoint；工作流执行需要独立的 `workflowExecutionId` / `nodeRunId` / workflow state / workflow event stream，以避免污染聊天上下文或丢失图级运行历史。

Workflow 是可独立执行的产品能力，不只是 Chat/Master Agent 的附属入口。v1 支持编辑器内手动执行和 Chat 中通过 Master Agent 触发；后续可增加定时任务/后台调度入口，专门按计划运行 workflow。所有触发来源都必须汇入同一套 workflow runtime 与执行历史模型。

</domain>

<decisions>
## Implementation Decisions

### 1. 编辑器布局与交互
- **D-01:** 工作流编辑器为**独立全屏视图**，Sidebar 新增「工作流」入口
- **D-02:** 节点创建采用**拖拽面板**（左侧节点类型面板，拖拽到画布创建），ReactFlow 原生支持
- **D-03:** 编辑器内部布局为**全画布 + 抽屉配置**，节点配置通过点击节点弹出侧边抽屉（Drawer）编辑
- **D-04:** 工作流管理采用**列表 → 编辑器**模式，进入工作流视图先显示工作流列表（卡片），点击进入编辑器

### 2. 节点类型设计（核心架构决策）
- **D-05:** **所有可执行节点都是 Agent 节点**，不存在「普通节点/脚本节点」概念
- **D-06:** 辅助节点仅限**开始节点**和**结束节点**
- **D-07:** 条件判断由 Agent 或 Master Agent 介入承担，不引入独立的条件判断节点
- **D-08:** Agent 节点**直接引用资产库**，不允许覆盖配置。节点配置时从 Agent 资产库下拉选择，自动继承该 Agent 的 LLM/MCP/Skills
- **D-08a:** v1 节点类型固定为 `start` / `agent` / `end`。条件、循环、并行均属于**边和路由策略 metadata**，不新增 `condition` / `loop` 等可执行节点类型

### 3. 控制流机制
- **D-09:** 条件分支采用**混合模式**：简单分支由上游 Agent 输出决定（返回 `{next: "A"}` 或 `{next: "B"}`），关键分支由 Master Agent 介入，编排时可自主选择
- **D-10:** 支持**循环路由**，循环条件由 Agent 输出或 Master Agent 判断；循环通过边 metadata 表达，并必须有最大迭代次数保护
- **D-11:** 节点级失败策略：每个节点可配置「失败时」行为——重试/跳过/停止并汇报 Master Agent
- **D-12:** Master Agent 可决定继续/终止/修改参数重试
- **D-12a:** Agent 节点默认以**单 Agent 执行**为准，不自动暴露项目内所有 Agent 作为 subagents。若某节点允许 Master Agent 委派子 Agent，必须显式配置 `subagentIds` 白名单，且 `Agent.slug` 仍为 `task(name)` 稳定键

### 4. 执行引擎与数据流
- **D-13:** 执行引擎采用 **LangGraph.js 驱动**，ReactFlow 图转换为 LangGraph StateGraph 执行
- **D-14:** 节点间数据传递采用**共享 State 模式**，LangGraph 的 State 对象在节点间传递，每个节点读取 state 并写入自己的输出
- **D-15:** 并行执行采用 **LangGraph fan-out/fan-in 模式**，用户在编辑器中通过连接线定义并行关系
- **D-16:** 工作流触发采用**多入口统一运行时**：v1 支持编辑器内直接运行 + Chat 中通过 Master Agent 触发；未来支持定时任务/后台调度专门运行 workflow
- **D-16a:** 新增 `src/main/workflow-runtime.ts`（或同等模块）承载工作流执行：负责 ReactFlow → StateGraph 转换、节点执行、路由决策、事件推送、执行历史落库。该模块可以复用 Agent/LLM/MCP/Skills 的构建 helper，但不得复用聊天 session 作为 workflow checkpoint namespace
- **D-16b:** Workflow State v1 至少包含：`inputs`, `nodeOutputs`, `routing`, `artifacts`, `errors`, `messages`。每个 Agent 节点只写入自己的 `nodeOutputs[nodeId]`，图级路由从 `routing` 读取
- **D-16c:** Chat 触发必须通过 Master Agent 可见的工具暴露，而不是仅新增 IPC。v1 至少提供 `list_workflows`、`run_workflow`、`get_workflow_status` 三个 workflow tools，并在 DeepAgent runtime 的工具注册路径中接入
- **D-16d:** Workflow runtime API 必须与触发来源解耦，例如 `runWorkflow({ workflowId, projectId, triggerSource, input })`。`triggerSource` 至少区分 `editor` / `chat` / `schedule`，便于后续定时任务复用同一执行通道

### 5. 状态推送与持久化
- **D-17:** 执行状态推送采用 **IPC 事件流**模式（复用现有 `llm:chunk-{requestId}` 的 channel-per-request 思路），新增 workflow 专用 channel（如 `workflow:event-{executionId}`），LangGraph 执行事件通过 IPC channel 推送到渲染进程
- **D-18:** 工作流持久化采用 **SQLite 存储**，新建 `workflows` 表，至少包含：`id`, `project_id`, `name`, `description`, `graph_data` (JSON), `status`, `created_at`, `updated_at`。`graph_data` 包含 ReactFlow 的 nodes/edges/viewport 和路由 metadata
- **D-20:** 保留**完整执行历史**，新增 `workflow_executions` 与 `workflow_node_runs` 表。每次执行记录：触发来源（editor/chat/schedule）、开始时间、结束时间、graph snapshot、输入、最终输出、成功/失败状态；每个节点记录输入输出、开始/结束时间、重试次数、错误、状态
- **D-21:** `agent_runs` / `agent_tool_calls` 可作为 Agent 层细节记录参考，但不能替代 workflow 图级执行历史

### Claude's Discretion
- ReactFlow 自定义节点的视觉设计（颜色、图标、状态指示器）由实现阶段决定
- LangGraph State 的扩展字段由 planner 在不破坏 v1 最低 schema 的前提下设计
- 循环路由的默认最大迭代次数由实现阶段决定，但必须存在硬限制
- 执行历史的保留策略（最多保留多少次）由实现阶段决定

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### deepagents.js SDK 文档
- `https://docs.langchain.com/oss/javascript/deepagents/overview` — deepagents.js 概念概述
- `https://docs.langchain.com/oss/javascript/deepagents/quickstart` — createDeepAgent 快速开始
- `https://docs.langchain.com/oss/javascript/deepagents/subagents` — 子Agent 委托机制（task tool）

### LangGraph.js 文档
- `https://langchain-ai.github.io/langgraphjs/` — LangGraph.js 概述
- `https://langchain-ai.github.io/langgraphjs/how-tos/branching/` — 分支模式
- `https://langchain-ai.github.io/langgraphjs/how-tos/map-reduce/` — fan-out/fan-in 并行模式

### ReactFlow 文档
- `https://reactflow.dev/` — ReactFlow 概述和 API

### 项目架构参考
- `src/main/deepagent/runtime.ts` — Agent/LLM/MCP/Skills 构建逻辑参考；不得把 `createDeepAgentRuntime` 这个 chat session runtime 直接当作 workflow runtime
- `src/main/llm.ts` — LLM 流式调用、IPC 事件流模式
- `src/main/ipc-handlers.ts` — IPC 处理器注册模式
- `src/main/database.ts` — SQLite 表结构和建表模式
- `src/preload/index.ts` — Preload 桥接模式
- `src/shared/types.ts` — TypeScript 类型定义
- `src/renderer/src/App.tsx` — 视图路由模式（activeView）
- `src/renderer/src/stores/sessionStore.ts` — Zustand Store 模式（含流式状态管理）
- `.planning/phases/03-agent-integration/03-CONTEXT.md` — Phase 3 上下文（Agent 资产库、数据库表）
- `.planning/phases/03.1-agent/03.1-CONTEXT.md` — Phase 3.1 子Agent 委托上下文
- `.planning/phases/03.2-deepagents/03.2-CONTEXT.md` — Phase 3.2 deepagents 复核上下文

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **ReactFlow** — 已在 CLAUDE.md 推荐栈中，需安装 `@xyflow/react`
- **Zustand Store 模式** — `sessionStore.ts`, `llmStore.ts` 可作为 `workflowStore.ts` 模板
- **IPC 事件流模式** — `llm:chunk-{requestId}` 模式可复用于工作流执行状态推送
- **SQLite 表模式** — `database.ts` 中的建表模式可复用于 workflows 表
- **Shadcn Drawer** — 需引入 `vaul` 包，用于节点配置侧边抽屉
- **App.tsx 视图路由** — `activeView` 状态 + 条件渲染，新增 `'workflows'` 视图
- **DeepAgent runtime helper** — 可抽取/复用模型、Agent、MCP、Skills、内置工具构造逻辑，但 workflow runtime 必须有独立执行 ID、state 和历史表

### Established Patterns
- IPC 通信：`ipcMain.handle` + `contextBridge` + `ipcRenderer.invoke`
- 流式状态：`isStreaming` + `streamingMessageId` + IPC channel 推送
- Zustand Store：`create<StateInterface>((set, get) => ({...}))`
- SQLite CRUD：`db.prepare().get/all/run` 模式

### Integration Points
- **Sidebar** — 新增「工作流」按钮，切换 activeView
- **App.tsx** — 扩展 activeView 类型为 `'chat' | 'settings' | 'agents' | 'plugins' | 'tools' | 'workflows'`
- **ipc-handlers.ts** — 新增 workflows CRUD + 执行控制处理器
- **preload/index.ts** — 暴露 workflows IPC 方法
- **shared/types.ts** — 新增 Workflow, WorkflowNode, WorkflowEdge, WorkflowExecution 类型
- **Master Agent** — 通过 workflow tools 触发工作流执行的入口
- **Future scheduler** — 后续定时任务只新增调度入口，不新增第二套 workflow 执行引擎

### 关键技术依赖
- `@xyflow/react` (ReactFlow v12+) — 可视化编辑器；当前 `package.json` 尚未安装
- `@langchain/langgraph` — LangGraph.js 执行引擎；当前仅有 `@langchain/langgraph-checkpoint-sqlite`，需显式安装运行时包
- `vaul` — Shadcn Drawer 组件依赖；当前 `package.json` 尚未安装

</code_context>

<specifics>
## Specific Ideas

- 用户明确要求：工作流的核心是"Agent 编排"而非"脚本编排"，所有可执行节点都是 Agent 节点
- 条件分支支持混合模式：Agent 自主判断 + Master Agent 介入，编排时可选择
- 循环是必要的能力，通过边路由 metadata 实现，不引入循环节点
- 工作流可独立执行，不依赖 Chat 会话；v1 从编辑器直接运行，也可由 Chat 中 Master Agent 触发
- 后续定时任务/后台调度应复用 workflow runtime，专门按计划运行 workflow
- 执行历史需要完整保留，支持事后回看
- Chat 触发入口必须注册为 Agent 工具，确保 Master Agent 能列出、启动、查询工作流

</specifics>

<deferred>
## Deferred Ideas

- 工作流版本管理（v2 需求，REQUIREMENTS.md 中 WFLO-08）
- 工作流执行回滚（v2 需求，REQUIREMENTS.md 中 WFLO-09）
- 工作流导入/导出功能（原 D-19：导出为 JSON 文件 + 从 JSON 文件导入）— v2 需求
- 工作流模板/市场功能 — 未来阶段
- 节点执行超时配置 UI — v1 可硬编码默认值
- 工作流执行并发限制 — 未来阶段

</deferred>

---

*Phase: 04-Workflow System*
*Context gathered: 2026-05-27*
