# Phase 4: Workflow System - Context

**Gathered:** 2026-05-27
**Status:** Ready for planning

<domain>
## Phase Boundary

用户可通过 ReactFlow 可视化编排工作流，执行并监控节点状态。利用 langgraph.js 的图运行时作为工作流执行引擎，所有可执行节点均为 Agent 节点（引用 Agent 资产库），通过 LangGraph StateGraph 实现编排控制流（分支、循环、并行、停止）。

核心设计理念转变：工作流不是"脚本编排"，而是"Agent 编排"。重点在于 Agent 之间的控制流设计，而非代码执行。

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

### 3. 控制流机制
- **D-09:** 条件分支采用**混合模式**：简单分支由 Agent 输出决定（返回 `{next: "A"}` 或 `{next: "B"}`），关键分支由 Master Agent 介入，编排时可自主选择
- **D-10:** 支持**内置循环节点**，循环条件由 Agent 输出或 Master Agent 判断
- **D-11:** 节点级失败策略：每个节点可配置「失败时」行为——重试/跳过/停止并汇报 Master Agent
- **D-12:** Master Agent 可决定继续/终止/修改参数重试

### 4. 执行引擎与数据流
- **D-13:** 执行引擎采用 **LangGraph.js 驱动**，ReactFlow 图转换为 LangGraph StateGraph 执行
- **D-14:** 节点间数据传递采用**共享 State 模式**，LangGraph 的 State 对象在节点间传递，每个节点读取 state 并写入自己的输出
- **D-15:** 并行执行采用 **LangGraph fan-out/fan-in 模式**，用户在编辑器中通过连接线定义并行关系
- **D-16:** 工作流触发采用**双入口**：编辑器内直接运行 + Chat 中通过 Master Agent 触发

### 5. 状态推送与持久化
- **D-17:** 执行状态推送采用 **IPC 事件流**模式（复用现有 `llm:chunk-{requestId}` 模式），LangGraph 执行事件通过 IPC channel 推送到渲染进程
- **D-18:** 工作流持久化采用 **SQLite 存储**，新建 `workflows` 表：`id`, `name`, `graph_data` (JSON), `created_at`, `updated_at`。graph_data 包含 ReactFlow 的 nodes/edges/viewport
- **D-19:** 支持**导入/导出**功能，导出为 JSON 文件 + 从 JSON 文件导入
- **D-20:** 保留**完整执行历史**，每次执行记录：开始时间、结束时间、每个节点的输入输出、成功/失败状态

### Claude's Discretion
- ReactFlow 自定义节点的视觉设计（颜色、图标、状态指示器）由实现阶段决定
- LangGraph State 的具体 schema 结构由 researcher 调研后由 planner 设计
- 循环节点的最大迭代次数限制由实现阶段决定
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
- `src/main/deepagent/runtime.ts` — createDeepAgentRuntime 核心实现
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
- **Master Agent** — 通过 Chat 触发工作流执行的入口

### 关键技术依赖
- `@xyflow/react` (ReactFlow v12+) — 可视化编辑器
- `@langchain/langgraph` — LangGraph.js 执行引擎
- `vaul` — Shadcn Drawer 组件依赖

</code_context>

<specifics>
## Specific Ideas

- 用户明确要求：工作流的核心是"Agent 编排"而非"脚本编排"，所有可执行节点都是 Agent 节点
- 条件分支支持混合模式：Agent 自主判断 + Master Agent 介入，编排时可选择
- 循环是必要的能力，通过内置循环节点实现
- 工作流可从两个入口触发：编辑器直接运行 + Chat 中 Master Agent 触发
- 执行历史需要完整保留，支持事后回看

</specifics>

<deferred>
## Deferred Ideas

- 工作流版本管理（v2 需求，REQUIREMENTS.md 中 WFLO-08）
- 工作流执行回滚（v2 需求，REQUIREMENTS.md 中 WFLO-09）
- 工作流模板/市场功能 — 未来阶段
- 节点执行超时配置 UI — v1 可硬编码默认值
- 工作流执行并发限制 — 未来阶段

</deferred>

---

*Phase: 04-Workflow System*
*Context gathered: 2026-05-27*
