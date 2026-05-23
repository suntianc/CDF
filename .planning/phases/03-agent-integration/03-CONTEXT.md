# Phase 3: Agent Integration - Context

**Gathered:** 2026-05-23（更新）
**Status:** Ready for planning

<domain>
## Phase Boundary

开发者可定义 Agent 角色，配置其 LLM/MCP/Skills 资源，管理 Skills 脚本和 MCP 服务器。底层使用 deepagents.js SDK（LangChain 出品）在 Electron 主进程中创建和管理 deepagent 实例。

Phase 3 聚焦**资产定义和配置**。Agent 在工作流中被实际调用的逻辑是 Phase 4 的范围。

</domain>

<decisions>
## Implementation Decisions

### 1. 底层引擎：deepagents.js
- **D-01:** 使用 `npm install deepagents`（v1.10.2+）替代原有手写 LLM 调用
- **D-02:** 在 Electron 主进程创建 `createDeepAgent()` 实例，通过 IPC 暴露给渲染进程
- **D-03:** deepagents.js 将替换 `src/main/llm.ts` 中的手写 SSE 流式逻辑，改用 deepagents 内置的 streaming 能力
- **D-04:** `src/main/security.ts`（safeStorage）保持不变 — 加密/解密与 deepagents 无关
- **D-05:** `src/main/database.ts` 的 `llm_providers` 表保持不变 — deepagents 通过我们传入的 LangChain chat model 使用这些配置

### 2. 导航与视图架构 (Navigation)
- **D-06:** 扩展 `App.tsx` 的 `activeView` 类型，新增 `'agents'`（Agent 管理）视图
- **D-07:** Agent 管理作为独立入口 — 在 Sidebar 中新增"Agent"按钮，点击切换到 agents 视图
- **D-08:** Skills 和 MCP 管理从"插件"按钮进入 — 点击现有"插件"按钮，右侧显示统一面板，内部通过标签页（Tabs）在 Skills 和 MCP 之间切换
- **D-09:** Agent 管理视图作为顶层入口，Skills/MCP 为次级管理面板

### 3. Agent 资产库 UI (Agent Library UI)
- **D-10:** Agent 列表采用卡片式布局，每张卡片展示：Agent 名称 + 绑定 LLM 名称 + Skills 数量 + MCP 数量 + 编辑/删除操作
- **D-11:** 创建/编辑 Agent 使用模态对话框（Shadcn Dialog），**双栏分屏布局**：
  - **左侧（40%）：核心配置** — 名称、描述、LLM 提供者选择（复用 `llmStore`）
  - **右侧（60%）：能力与高级配置** — MCP 绑定、Skills 绑定、System Prompt（textarea）
- **D-12:** Agent 创建后，在后台通过 `createDeepAgent()` 注册到 deepagents 运行时

### 4. 数据架构与 SQLite 表设计
- **D-13:** 新建 `agents` 表：`id`, `name`, `description`, `provider_id` (FK), `system_prompt`, `config` (JSON), `created_at`, `updated_at`
- **D-14:** 新建 `agent_mcp_servers` 关联表：`agent_id` (FK), `mcp_server_id` (FK)
- **D-15:** 新建 `agent_skills` 关联表：`agent_id` (FK), `skill_id` (FK)
- **D-16:** 新建 `skills` 表：`id`, `name`, `description`, `script_content`, `script_type`, `created_at`, `updated_at`
- **D-17:** 新建 `skill_versions` 表：`id`, `skill_id`, `version_number`, `script_content`, `created_at`
- **D-18:** 新建 `mcp_servers` 表：`id`, `name`, `server_type`, `config` (JSON), `is_connected`, `last_health_check`, `created_at`, `updated_at`

### 5. Skills 管理
- **D-19:** Skills 编辑器使用 **textarea + 行号 + 基础语法着色**（通过 CSS / 轻量方案实现，不引入 Monaco/Codemirror 等重量级依赖）
- **D-20:** Skills 创建后存储到 SQLite，同时通过 deepagents 的 Skills middleware 注册到 Agent 运行时
- **D-21:** 脚本类型可选 Bash / Python / JavaScript（v1 不做语法高亮引擎）
- **D-22:** 每次保存自动创建版本快照（只读版本历史，v1 不支持版本回滚）

### 6. MCP 服务器管理
- **D-23:** MCP 服务器以卡片列表展示：名称、传输类型、关键连接信息、连接状态（`is_connected`）
- **D-24:** 支持两种传输类型，根据类型动态切换配置字段：
  - **stdio** — 字段：command（启动命令）、args（参数数组）
  - **Streamable HTTP** — 字段：url（MCP endpoint URL，如 `http://localhost:8080/mcp`）
- **D-25:** 健康检查：通过 Streamable HTTP 的 HTTP GET 探测连通性（默认 5s 超时）。stdio 类型服务器暂不做健康检查（子进程管理属于 Phase 4）
- **D-26:** 连接/断开：切换 `is_connected` 标志，持久化到数据库
- **D-27:** v1 聚焦配置管理 + 健康检查；实际 MCP 协议调用通过 deepagents 内置 MCP 工具在 Phase 4 转发

### 7. 绑定交互（MCP/Skills 多选）
- **D-28:** Agent 编辑对话框右侧栏中，MCP 和 Skills 绑定采用 **Command palette 风格搜索选择器（Shadcn Command）**，支持搜索过滤已创建的 MCP/Skills 列表

### 8. IPC 与 Preload 桥接
- **D-29:** 新增 IPC 处理器：Agent CRUD、Skills CRUD（含版本历史）、MCP CRUD（遵循 Phase 2 模式）
- **D-30:** 新增 IPC 处理器：`deepagents:createAgent` — 管理 deepagents 运行时实例
- **D-31:** 新增 Zustand Store：`agentStore`, `skillStore`, `mcpServerStore`

### 后端实现状态
Phase 3 后端代码已完成（以下无需再做）：
- ✅ 数据库表建表语句（`src/main/database.ts`）
- ✅ 所有 IPC 处理器（`src/main/ipc-handlers.ts`）
- ✅ Preload 桥接方法（`src/preload/index.ts`）
- ✅ TypeScript 类型定义（`src/shared/types.ts`）
- ✅ deepagents.createAgent 处理器
- ✅ 必要的依赖已安装（deepagents, @langchain/core 等）

### 前端待构建
以下 UI 部分仍待实现（基于以上决策）：
- ❌ `src/renderer/src/stores/agentStore.ts` — Agent CRUD 状态管理
- ❌ `src/renderer/src/stores/skillStore.ts` — Skills CRUD + 版本历史状态管理
- ❌ `src/renderer/src/stores/mcpServerStore.ts` — MCP CRUD + 连接状态管理
- ❌ `src/renderer/src/components/AgentLibrary/` — Agent 卡片列表 + 编辑对话框
- ❌ `src/renderer/src/components/Skills/` — Skills 列表 + 编辑器 + 版本历史
- ❌ `src/renderer/src/components/McpServers/` — MCP 卡片列表 + 配置对话框 + 健康检查
- ❌ `src/renderer/src/App.tsx` — 扩展 activeView + Sidebar 新增 Agent 入口
- ❌ `src/renderer/src/components/Sidebar/Sidebar.tsx` — 新增 Agent 按钮 + 插件面板标签页

</decisions>

<canonical_refs>
## Canonical References

**下游 agents 在规划或实现前必须阅读以下引用文档。**

### deepagents.js SDK 文档（在线资源 — 离线不可用，需预先缓存）
- `https://docs.langchain.com/oss/javascript/deepagents/overview` — deepagents.js 概念概述
- `https://docs.langchain.com/oss/javascript/deepagents/quickstart` — 快速开始（`createDeepAgent`）
- `https://docs.langchain.com/oss/javascript/deepagents/skills` — Skills 系统文档
- `https://docs.langchain.com/oss/javascript/deepagents/models` — 支持的模型和配置
- `https://docs.langchain.com/oss/javascript/langchain/mcp` — MCP 集成文档
- `https://docs.langchain.com/oss/javascript/deepagents/streaming` — 流式输出文档

### MCP 协议规范
- `https://modelcontextprotocol.io/specification/2025-03-26/basic/transports` — stdio + Streamable HTTP 传输层定义
- `https://modelcontextprotocol.io/specification/2025-03-26/architecture` — MCP client-host-server 架构

### 项目架构参考
- `src/main/database.ts` — 数据库初始化，含所有 Phase 3 建表语句
- `src/main/ipc-handlers.ts` — IPC 处理器注册模式，含所有 Phase 3 处理器
- `src/preload/index.ts` — Preload 桥接模式
- `src/shared/types.ts` — Agent/Skill/SkillVersion/MCPServer 类型定义
- `src/renderer/src/stores/llmStore.ts` — Zustand Store 模板（Phase 2 模式）
- `src/renderer/src/components/Settings/ModelSettings.tsx` — UI 配置面板模板（卡片列表 + Dialog）
- `src/renderer/src/App.tsx` — 视图路由模式（activeView）
- `.planning/phases/02-chat-engine/02-CONTEXT.md` — Phase 2 上下文（IPC 模式、安全加密）
- `.planning/phases/03-agent-integration/03-AI-SPEC.md` — AI 设计合约（评估策略、测试框架）

</canonical_refs>

<code_context>
## 现有代码分析

### 已完成的后端代码
- **`src/main/database.ts`** — 已包含 agents, skills, skill_versions, mcp_servers, agent_mcp_servers, agent_skills 建表语句
- **`src/main/ipc-handlers.ts`** — 已实现完整的 CRUD 处理器 + health check + toggleConnection + deepagents:createAgent
- **`src/preload/index.ts`** — 已暴露所有 Phase 3 IPC 方法
- **`src/shared/types.ts`** — 已定义 Agent, Skill, SkillVersion, MCPServer 接口 + ElectronAPI 方法签名
- **依赖** — deepagents, @langchain/core, @langchain/openai, @langchain/anthropic, @langchain/ollama 已安装

### 待构建的前端代码
- **Zustand Stores** — 需创建 `agentStore.ts`, `skillStore.ts`, `mcpServerStore.ts`（参考 `llmStore.ts` 模式）
- **AgentLibrary 组件** — 卡片列表 + 双栏 Dialog（参考 `ModelSettings.tsx` 模式）
- **Skills 组件** — 列表 + textarea 编辑器（行号 + 基础着色）+ 版本历史面板
- **McpServers 组件** — 卡片列表 + 配置 Dialog（根据传输类型动态切换字段）+ 健康检查按钮
- **Sidebar** — 新增 Agent 按钮 + 扩展"插件"按钮为标签页面板
- **App.tsx** — 扩展 activeView 为 `'chat' | 'settings' | 'agents'`

### 可复用 UI 资产
- Shadcn Dialog / Badge / Button / ScrollArea — 已有
- Shadcn Command（需要引入 `cmdk` 包）— 用于 Command palette 搜索选择器
- ModelSettings.tsx — 配置面板模式蓝本
- Zustand Store 模式 — llmStore 作为模板

### Established Patterns
- IPC 通信模式：`ipcMain.handle` + `contextBridge.exposeInMainWorld` + `ipcRenderer.invoke`
- 视图切换：`activeView` 状态 + 条件渲染
- 加密存储：`safeStorage` 在主进程加解密

</code_context>

<specifics>
## 具体想法

- Agent 资产库面板设计参考 ModelSettings.tsx 的卡片列表 + 模态框编辑模式
- 每个 Agent 在后台注册为 `createDeepAgent({model, tools, systemPrompt})` 实例
- deepagents 的 Skills middleware 自动处理 Skills 的加载和注入
- deepagents 的内置工具（文件系统、Shell）通过配置启用/禁用
- v1 聚焦配置管理，Agent 运行时调用在 Chat 中延迟到 Phase 4
- MCP 的 stdio 类型服务器实际运行管理在 Phase 4 实现（子进程启动/停止）

</specifics>

<deferred>
## 延后事项

- Skills 语法高亮编辑器（Monaco/CodeMirror）— post-v1 优化
- Skills 版本回滚功能 — post-v1 优化
- Agent 运行时在工作流中的执行 — Phase 4
- deepagents 子Agent 委托的 UI 管理 — Phase 4
- LangGraph 图可视化和编辑 — Phase 4
- MCP stdio 子进程管理（启动/停止/重启）— Phase 4
- Skills 市场/共享 — v2
- MCP 资源状态可视化 — v2

</deferred>

---

*Phase: 03-agent-integration*
*Context gathered: 2026-05-23（更新）*