# Phase 3: Agent Integration - Context

**Gathered:** 2026-05-22
**Status:** Ready for planning

<domain>
## Phase Boundary

开发者可定义 Agent 角色，配置其 LLM/MCP/Skills 资源，管理 Skills 脚本和 MCP 服务器。底层使用 deepagents.js SDK（LangChain 出品）在 Electron 主进程中创建和管理 deepagent 实例。

Phase 3 聚焦**资产定义和配置**。Agent 在工作流中被实际调用的逻辑是 Phase 4 的范围。

</domain>

<decisions>
## Implementation Decisions

### 1. 底层引擎变更：deepagents.js
- **D-01:** 使用 `npm install deepagents`（v1.10.2+）替代原有手写 LLM 调用
- **D-02:** 在 Electron 主进程创建 `createDeepAgent()` 实例，通过 IPC 暴露给渲染进程
- **D-03:** deepagents.js 将替换 `src/main/llm.ts` 中的手写 SSE 流式逻辑，改用 deepagents 内置的 streaming 能力
- **D-04:** `src/main/security.ts`（safeStorage）保持不变 — 加密/解密与 deepagents 无关
- **D-05:** `src/main/database.ts` 的 `llm_providers` 表保持不变 — deepagents 通过我们传入的 LangChain chat model 使用这些配置

### 2. 导航与视图架构 (Navigation)
- **D-06:** 采用与 `ModelSettings` 相同的视图切换模式（扩展 `App.tsx` 的 `activeView` 类型）
- **D-07:** 新增 `'agents'`、`'skills'`、`'mcp'` 三个视图
- **D-08:** 在 Sidebar 中利用已有的"插件"按钮区域，新增 Agent 资产库入口
- **D-09:** Agent 资产库视图作为顶层管理入口，Skills 和 MCP 管理通过标签页/嵌套视图访问

### 3. Agent 资产库 UI (Agent Library UI)
- **D-10:** Agent 列表采用卡片式布局，每张卡片展示：Agent 名称、绑定 LLM 提供者、Skills 数量、MCP 数量、状态
- **D-11:** 创建/编辑 Agent 使用模态对话框（Shadcn Dialog），表单包含：名称、描述、LLM 提供者选择（复用 `llmStore`）、MCP 多选、Skills 多选、System Prompt
- **D-12:** Agent 创建后，在后台通过 `createDeepAgent()` 注册到 deepagents 运行时

### 4. 数据架构与 SQLite 表设计
- **D-13:** 新建 `agents` 表：`id`, `name`, `description`, `provider_id` (FK), `system_prompt`, `config` (JSON — deepagents 配置选项), `created_at`, `updated_at`
- **D-14:** 新建 `agent_mcp_servers` 关联表：`agent_id`, `mcp_server_id`
- **D-15:** 新建 `agent_skills` 关联表：`agent_id`, `skill_id`
- **D-16:** 新建 `skills` 表：`id`, `name`, `description`, `script_content`, `script_type`, `created_at`, `updated_at`
- **D-17:** 新建 `skill_versions` 表：`id`, `skill_id`, `version_number`, `script_content`, `created_at`
- **D-18:** 新建 `mcp_servers` 表：`id`, `name`, `server_type`, `config` (JSON), `is_connected`, `last_health_check`, `created_at`, `updated_at`

### 5. Skills 管理 (对接 deepagents Skills)
- **D-19:** Skills 编辑器使用简单文本输入框（textarea），等宽字体
- **D-20:** Skills 创建后存储到 SQLite，同时通过 deepagents 的 Skills middleware 注册到 Agent 运行时
- **D-21:** 脚本类型可选 Bash / Python / JavaScript，v1 不提供语法高亮
- **D-22:** 每次保存自动创建版本快照

### 6. MCP 服务器管理 (对接 deepagents MCP)
- **D-23:** MCP 服务器以卡片列表展示：名称、类型、地址、端口、连接状态
- **D-24:** 健康检查：通过 deepagents MCP 能力（或 HTTP 探测）验证连通性
- **D-25:** 连接/断开：切换 `is_connected` 标志，持久化到数据库
- **D-26:** v1 配置管理 + 健康检查；实际 MCP 协议调用通过 deepagents 内置 MCP 工具转发

### 7. IPC 与 Preload 桥接
- **D-27:** 新增 IPC 处理器：Agent CRUD、Skills CRUD、MCP CRUD（遵循 Phase 2 模式）
- **D-28:** 新增 IPC 处理器：`deepagents:createAgent`, `deepagents:invoke` — 管理 deepagents 运行时实例
- **D-29:** 新增 Zustand Store：`agentStore`, `skillStore`, `mcpServerStore`

</decisions>

<canonical_refs>
## Canonical References

### deepagents.js SDK 文档
- `https://docs.langchain.com/oss/javascript/deepagents/overview` — deepagents.js 概念概述
- `https://docs.langchain.com/oss/javascript/deepagents/quickstart` — 快速开始（`createDeepAgent`）
- `https://docs.langchain.com/oss/javascript/deepagents/skills` — Skills 系统文档
- `https://docs.langchain.com/oss/javascript/deepagents/models` — 支持的模型和配置
- `https://docs.langchain.com/oss/javascript/langchain/mcp` — MCP 集成文档
- `https://docs.langchain.com/oss/javascript/deepagents/streaming` — 流式输出文档

### 项目架构参考
- `src/main/llm.ts` — 将被简化，替换为 deepagents 调用
- `src/main/ipc-handlers.ts` — IPC 处理器注册模式
- `src/preload/index.ts` — Preload 桥接模式
- `src/renderer/src/stores/llmStore.ts` — Zustand Store 模板
- `src/renderer/src/components/Settings/ModelSettings.tsx` — UI 配置面板模板
- `src/renderer/src/App.tsx` — 视图路由模式
- `.planning/phases/02-chat-engine/02-CONTEXT.md` — Phase 2 上下文

</canonical_refs>

<code_context>
## 现有代码分析

### 受 deepagents 影响的文件
- **`src/main/llm.ts`** — 将被替换。原来手写 OpenAI/Anthropic/Ollama SSE 流式，改为使用 deepagents `createDeepAgent()` 内置 streaming
- **`src/main/ipc-handlers.ts`** — 扩展：新增 deepagents 实例管理 IPC、Agent/Skills/MCP CRUD
- **`src/preload/index.ts`** — 扩展：暴露新的 IPC 方法
- **`src/shared/types.ts`** — 追加 Agent、Skill、MCPServer 类型
- **`src/main/database.ts`** — 追加新表

### 保持不变的文件
- **`src/main/security.ts`** — safeStorage 加密与 deepagents 无关
- **`src/renderer/src/stores/sessionStore.ts`** — 前端会话管理逻辑不变
- **`src/renderer/src/components/ChatArea/ChatArea.tsx`** — 前端 UI 逻辑不变，但底层 LLM 调用改为走 deepagents
- **`src/renderer/src/stores/llmStore.ts`** — LLM 提供者配置逻辑不变
- **所有 UI 组件** — 前端 UI 不受影响

### 可复用 UI 资产
- ModelSettings.tsx — 配置面板模式蓝本
- Shadcn Dialog/Sheet/Badge/Button — 组件
- Zustand Store 模式 — llmStore 作为模板

</code_context>

<specifics>
## 具体想法

- Agent 资产库面板设计参考 ModelSettings.tsx 的卡片列表 + 模态框编辑模式
- 每个 Agent 在后台注册为 `createDeepAgent({model, tools, systemPrompt})` 实例
- deepagents 的 Skills middleware 自动处理 Skills 的加载和注入
- deepagents 的内置工具（文件系统、Shell）通过配置启用/禁用
- v1 聚焦配置管理，Agent 运行时调用在 Chat 中延迟到 Phase 4

</specifics>

<deferred>
## 延后事项

- Skills 语法高亮编辑器（Monaco/CodeMirror）— post-v1
- Skills 版本回滚功能 — post-v1
- Agent 运行时在工作流中的执行 — Phase 4
- deepagents 子Agent 委托的 UI 管理 — Phase 4
- LangGraph 图可视化和编辑 — Phase 4
- Skills 市场/共享 — v2

</deferred>

---

*Phase: 03-agent-integration*
*Context gathered: 2026-05-22*