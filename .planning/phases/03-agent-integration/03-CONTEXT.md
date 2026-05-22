# Phase 3: Agent Integration - Context

**Gathered:** 2026-05-22
**Status:** Ready for planning

<domain>
## Phase Boundary

开发者可定义 Agent 角色，配置其 LLM/MCP/Skills 资源，管理 Skills 脚本和 MCP 服务器。包括三个核心子域：

1. **Agent 资产库** — 创建/编辑/删除 Agent 角色，绑定 LLM 提供者、MCP 资源和 Skills
2. **Skills 管理** — 创建/编辑/删除 Skills 脚本，版本管理，执行日志
3. **MCP 服务器管理** — MCP 服务器配置（地址、端口），健康检查，连接/断开

注意：Agent 在执行工作流中实际被调用的逻辑是 Phase 4 的范围。Phase 3 聚焦资产定义和配置。

</domain>

<decisions>
## Implementation Decisions

### 1. 导航与视图架构 (Navigation & View Architecture)
- **D-01:** 采用与 `ModelSettings` 相同的视图切换模式（扩展 `App.tsx` 的 `activeView` 类型）
- **D-02:** 新增 `'agents'`、`'skills'`、`'mcp'` 三个视图
- **D-03:** 在 Sidebar 中利用已有的"插件"按钮区域，新增 Agent 资产库入口，替代原有的占位按钮
- **D-04:** Agent 资产库视图作为顶层管理入口，Skills 和 MCP 管理作为其子配置页面（通过标签页或嵌套路由），参考 `ModelSettings.tsx` 的布局模式

### 2. Agent 资产库 UI (Agent Library UI)
- **D-05:** Agent 列表采用卡片式布局，每张卡片展示：Agent 名称、绑定 LLM 提供者名称、绑定 Skills 数量、绑定 MCP 数量、状态指示器
- **D-06:** 创建/编辑 Agent 使用模态对话框（复用 Shadcn Dialog 组件），表单包含：
  - 名称（必填）
  - 描述（可选）
  - LLM 提供者选择（下拉框，复用 `llmStore` 数据）
  - MCP 服务器多选（标签选择器）
  - Skills 多选（标签选择器）
  - 系统提示词（system prompt，可选）
- **D-07:** 删除 Agent 需二次确认（`confirm()` 对话框）

### 3. 数据架构与 SQLite 表设计 (Data Architecture)
- **D-08:** 新增 `agents` 表：`id`, `name`, `description`, `provider_id` (FK → llm_providers), `system_prompt`, `created_at`, `updated_at`
- **D-09:** 新增 `agent_mcp_servers` 关联表：`agent_id`, `mcp_server_id`（多对多）
- **D-10:** 新增 `agent_skills` 关联表：`agent_id`, `skill_id`（多对多）
- **D-11:** 新增 `skills` 表：`id`, `name`, `description`, `script_content`, `script_type` (bash/python/javascript), `created_at`, `updated_at`
- **D-12:** 新增 `skill_versions` 表：`id`, `skill_id` (FK), `version_number`, `script_content`, `created_at`（每次保存自动记录快照）
- **D-13:** 新增 `mcp_servers` 表：`id`, `name`, `server_type`, `host`, `port`, `is_connected`, `last_health_check`, `created_at`, `updated_at`
- **D-14:** 全部使用 UUID 主键，遵循现有 `llm_providers` 表的模式

### 4. Skills 编辑器 (Skills Editor)
- **D-15:** Skills 编辑器使用简单文本输入框（`<textarea>`），支持等宽字体显示
- **D-16:** 脚本类型可选 Bash / Python / JavaScript，仅在元数据中标记类型，v1 不提供语法高亮或代码补全
- **D-17:** Skills 创建表单包含：名称、描述、脚本类型选择器、脚本内容编辑区
- **D-18:** Skills 列表以表格形式展示（名称、类型、版本数、最后更新时间）

### 5. Skills 版本管理 (Skills Versioning)
- **D-19:** 每次保存 Skills 自动创建版本快照（记录时间戳和内容快照）
- **D-20:** 版本列表在 Skills 详情面板中以只读表格展示（版本号、时间、内容预览）
- **D-21:** v1 不实现版本回滚 — 仅做浏览和审计用途

### 6. MCP 服务器管理 (MCP Server Management)
- **D-22:** MCP 服务器以卡片列表展示，每张卡片显示：名称、类型、地址、端口、连接状态、最后健康检查时间
- **D-23:** 健康检查：按钮触发，发送 HTTP GET 到 `{host}:{port}/health` 或等价端点，返回状态码 200 标记为健康
- **D-24:** 连接/断开：切换 `is_connected` 布尔标志，持久化到数据库
- **D-25:** v1 仅做配置管理和健康检查 — 实际 MCP 协议集成（Agent 调用 MCP）是 Phase 4 范围

### 7. IPC 与 Preload 桥接 (IPC & Bridge)
- **D-26:** 遵循 Phase 2 建立的模式：主进程 IPC 处理器 + Preload 桥接 + Zustand Store
- **D-27:** 新增 IPC 处理器：`db:getAgents`, `db:saveAgent`, `db:deleteAgent`, `db:getSkills`, `db:saveSkill`, `db:deleteSkill`, `db:getSkillVersions`, `db:getMcpServers`, `db:saveMcpServer`, `db:deleteMcpServer`, `db:checkMcpHealth`, `db:toggleMcpConnection`
- **D-28:** 新增 Zustand Store：`agentStore`, `skillStore`, `mcpServerStore`，遵循 `llmStore.ts` 模式

</decisions>

<canonical_refs>
## Canonical References

**下游 Agent（研究者、规划者）在执行前必须阅读以下内容。**

### 项目架构与模式
- `src/main/database.ts` — 数据库初始化模式，新表追加在此文件
- `src/main/ipc-handlers.ts` — IPC 处理器注册模式
- `src/preload/index.ts` — Preload 桥接模式
- `src/renderer/src/stores/llmStore.ts` — Zustand Store 模式（作为 agentStore/skillStore/mcpServerStore 的模板）
- `src/renderer/src/components/Settings/ModelSettings.tsx` — UI 面板模式（作为 Agent Library / Skills / MCP 管理 UI 的模板）
- `src/renderer/src/App.tsx` — 视图路由与 `activeView` 切换模式
- `src/shared/types.ts` — TypeScript 类型定义模式
- `.planning/phases/02-chat-engine/02-CONTEXT.md` — Phase 2 上下文，含 LLM 提供者绑定逻辑

### 需求文档
- `.planning/REQUIREMENTS.md` §Agent 资产管理 — AGNT-01 到 AGNT-05 需求详情
- `.planning/REQUIREMENTS.md` §Skills 管理 — SKIL-01 到 SKIL-03 需求详情
- `.planning/REQUIREMENTS.md` §MCP 管理 — MCP-01 到 MCP-04 需求详情
- `.planning/ROADMAP.md` §Phase 3 — Phase 目标与成功标准

</canonical_refs>

<code_context>
## 现有代码分析

### 可复用资产
- **ModelSettings.tsx** — 完整的 CRUD 配置面板模式，可作为 Agent 管理、Skills 管理、MCP 管理 UI 的蓝本
- **Dialog 组件** — `src/renderer/src/components/ui/dialog.tsx`（Shadcn Dialog），用于 Agent 创建/编辑模态框
- **Sheet 组件** — `src/renderer/src/components/ui/sheet.tsx`，可用于 Skills 详情侧边栏
- **Badge 组件** — `src/renderer/src/components/ui/badge.tsx`，可用于显示 Skills/MCP 标签
- **Button 组件** — `src/renderer/src/components/ui/button.tsx`
- **ScrollArea 组件** — `src/renderer/src/components/ui/scroll-area.tsx`
- **Tooltip 组件** — `src/renderer/src/components/ui/tooltip.tsx`
- **llmStore.ts** — Zustand Store 模板，IPC 调用 + 状态管理模式
- **ipc-handlers.ts** — IPC 处理器注册模式，含 safeStorage 加密等

### 成熟模式
- **状态管理**：Zustand Store + IPC invoke 模式（主进程处理数据，渲染进程调用 invoke）
- **数据持久化**：better-sqlite3 主进程直连，通过 IPC 暴露给渲染进程
- **UI 布局**：左 Sidebar + 中主内容区 + 右下 TaskPanel
- **视图切换**：`App.tsx` 中 `activeView` 状态驱动视图渲染
- **样式系统**：CSS 变量 + Tailwind 类名混合

### 集成点
- **`App.tsx`**：扩展 `activeView` 类型，新增 Agent/Skills/MCP 视图路由
- **`Sidebar.tsx`**：替换占位按钮为真正导航入口
- **`src/main/database.ts`**：追加新表（agents, skills, skill_versions, mcp_servers, agent_mcp_servers, agent_skills）
- **`src/main/ipc-handlers.ts`**：注册 Agent/Skills/MCP 相关的 IPC 处理器
- **`src/preload/index.ts`**：暴露新的 IPC 方法
- **`src/shared/types.ts`**：追加 Agent、Skill、SkillVersion、MCPServer 类型定义

</code_context>

<specifics>
## 具体想法

- Agent 资产库面板的设计参考 `ModelSettings.tsx` 的卡片列表 + 模态框编辑模式
- Skills 脚本编辑器 v1 保持简单（textarea），专注于功能完整性而不是编辑体验
- MCP 服务器管理专注于配置和健康检查，实际协议调用延迟到 Phase 4
- Sidebar 中原有"插件"按钮重定向到 Agent 资产库入口
- 所有数据操作遵循已建立的 IPC → SQLite 模式

</specifics>

<deferred>
## 延后事项

- Skills 语法高亮编辑器（Monaco/CodeMirror）— post-v1 优化
- Skills 版本回滚功能 — post-v1 优化
- 实际 MCP 协议调用 — Phase 4 工作流执行引擎范围
- Agent 在工作流执行中的运行时行为 — Phase 4
- Skills 市场/共享功能 — v2 范围
- MCP 资源状态可视化 — v2 范围
- MCP 响应缓存 — v2 范围

</deferred>

---

*Phase: 03-agent-integration*
*Context gathered: 2026-05-22*