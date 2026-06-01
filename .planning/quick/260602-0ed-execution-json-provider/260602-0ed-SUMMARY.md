---
phase: 260602-0ed-execution-json-provider
plan: 01
subsystem: workflow-history
tags: [electron, sqlite, better-sqlite3, zustand, react, workflow, history, export]

# Dependency graph
requires:
  - phase: phase-04-workflows
    provides: workflow_executions / workflow_node_runs schema and runWorkflow engine
provides:
  - config_snapshot / events_snapshot columns on workflow_executions
  - buildConfigSnapshot freezes agents / mcp / skills at run start with secret redaction
  - workflow:listExecutions / deleteExecution / exportExecution IPC trio
  - log-exporter.ts: buildExportPayload, exportExecutionToFile, listExecutionsByWorkflow, deleteExecution
  - ExecutionHistoryDrawer.tsx with two-step delete confirmation
affects: [workflow-execution, workflow-run-debug, audit-export]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Idempotent ALTER TABLE on startup for new columns (matches existing 450-line pattern)
    - Snapshot-at-start: freeze referenced config at runWorkflow start so post-run edits do not pollute exports
    - Defense-in-depth secret redaction at both snapshot time and export time
    - Two-step inline delete confirmation (3s auto-cancel) avoids AlertDialog dependency

key-files:
  created:
    - src/main/workflow/log-exporter.ts
    - src/renderer/src/components/WorkflowEditor/ExecutionHistoryDrawer.tsx
  modified:
    - src/main/database.ts
    - src/main/workflow/workflow-runtime.ts
    - src/preload/index.ts
    - src/shared/types.ts
    - src/renderer/src/stores/workflowStore.ts
    - src/renderer/src/components/WorkflowEditor/WorkflowToolbar.tsx
    - src/renderer/src/components/WorkflowEditor/WorkflowEditor.tsx

key-decisions:
  - "Snapshot config at runWorkflow start (not at export time) so historical exports remain stable when agents / mcp configs are edited later"
  - "Strip provider_id / config from agents at snapshot time; MCP env secret regex applied at snapshot AND re-applied at export (defense in depth)"
  - "Schema version 1.0 + exported_at timestamp in payload for forward-compatible consumers"
  - "Two-step inline delete (re-click within 3s) keeps the panel dependency-free"
  - "Export uses dialog.showSaveDialog from main process — renderer never supplies a path (mitigates T-260602-02)"

patterns-established:
  - "Idempotent ALTER migrations guarded by try/catch (continue existing pattern from line 450)"
  - "Main-process owns file I/O; renderer only invokes IPC and gets a saved/canceled/error result"

requirements-completed: []

# Metrics
duration: 7min
completed: 2026-06-01
---

# Quick 260602-0ed: Execution History + JSON Export + Delete

**Workflow execution history drawer with config-snapshot-backed JSON export (agents stripped of provider_id, MCP env secrets redacted) and per-row delete**

## Performance

- **Duration:** 7 min
- **Started:** 2026-06-01T16:38:42Z
- **Completed:** 2026-06-01T16:46:03Z
- **Tasks:** 3 / 3
- **Files modified:** 9 (2 created, 7 modified)

## Accomplishments

- `workflow_executions` 表新增 `config_snapshot` 和 `events_snapshot` 两列(幂等 ALTER,沿用 450 行既有 try/catch 模式)
- `runWorkflow` 启动时一次性查询所有被引用的 agents / agent_mcp_servers / agent_skills / mcp_servers,固化配置快照 — agents 数组不含 `provider_id` / `config`,MCP env 中匹配密钥正则的字段值替换为 `"***"`
- 工作流结束(成功/失败两条路径)时把 `eventBuffers` 内容写入 `events_snapshot` 列,导出可重放完整事件流
- 新增 `src/main/workflow/log-exporter.ts`,导出 `buildExportPayload` / `exportExecutionToFile` / `listExecutionsByWorkflow` / `deleteExecution` 四个 API,`buildExportPayload` 优先用 `config_snapshot`,并二次校验 MCP env 脱敏(防御性)
- 注册 `workflow:listExecutions` / `workflow:deleteExecution` / `workflow:exportExecution` 三个新 IPC,通过 preload 暴露到 renderer
- `ExecutionHistoryDrawer.tsx` 右侧 380px 抽屉,二次确认删除(3 秒自动取消),调用系统保存对话框导出 JSON
- Toolbar 顶栏新增"历史"按钮(History 图标),WorkflowEditor 维护 `historyDrawerOpen` state,抽屉与 ExecutionPanel 同侧但互不冲突

## Task Commits

1. **Task 1: 后端持久化补全 + 配置快照固化** - `b07b72e` (feat)
2. **Task 2: 主进程导出/列表/删除 IPC + log-exporter 模块** - `e90a1f1` (feat)
3. **Task 3: 前端 ExecutionHistoryDrawer 抽屉 + Toolbar 入口 + Store 接入** - `591629a` (feat)

## Files Created/Modified

- `src/main/database.ts` — 新增 `config_snapshot` / `events_snapshot` 两列的幂等 ALTER
- `src/main/workflow/workflow-runtime.ts` — 新增 `buildConfigSnapshot` helper;INSERT 时写入快照;workflow_end(成功+失败)UPDATE 写 events_snapshot;注册三个新 IPC
- `src/main/workflow/log-exporter.ts`(新建)— 导出/列表/删除主进程逻辑
- `src/preload/index.ts` — `electronAPI.workflow` 暴露 `listExecutions` / `deleteExecution` / `exportExecution`
- `src/shared/types.ts` — `ElectronAPI.workflow` 三个新方法的类型签名
- `src/renderer/src/stores/workflowStore.ts` — `historyExecutions` 数组 + 三个 action
- `src/renderer/src/components/WorkflowEditor/ExecutionHistoryDrawer.tsx`(新建)— 抽屉 UI + 二次确认
- `src/renderer/src/components/WorkflowEditor/WorkflowToolbar.tsx` — History 按钮 + `onHistoryToggle` prop
- `src/renderer/src/components/WorkflowEditor/WorkflowEditor.tsx` — `historyDrawerOpen` state + 抽屉挂载

## Decisions Made

- **启动时固化快照**:`config_snapshot` 在 `runWorkflow` 启动时一次性查清,而不是导出时即时拼装 — 保证用户后续编辑 agent / mcp 配置时,历史导出仍反映执行时的真实引用
- **snapshot 阶段就脱敏**:`buildConfigSnapshot` 中直接剔除 `provider_id` / `config` 并替换 MCP env 密钥字段为 `"***"`,导出逻辑只需纯读
- **二次防御**:`buildExportPayload` 即使读到旧的 `config_snapshot`,也会再次过一遍 `sanitizeMcpEnv` — 防止未来快照格式变更时遗漏
- **不依赖 AlertDialog**:删除用内联二次确认(re-click within 3s),不引入 Radix Dialog 等额外依赖
- **文件路径不允许 renderer 传入**:导出强制走 `dialog.showSaveDialog` 在主进程内弹窗,renderer 只传 executionId — 缓解路径篡改威胁(T-260602-02)
- **LIMIT 50**:`listExecutionsByWorkflow` 单次返回 50 行,符合 YAGNI(分页留给后续需求)

## Deviations from Plan

None — plan executed exactly as written. Pre-existing TypeScript errors in unrelated files (arxiv-tool, bash-tool, llm-adapter, skill-manager.test, ipc-handlers.test, electron.vite.config, agentEditDialog, ChatArea, ProjectTree, etc.) were not touched. The line-161 error in `workflowStore.ts` (pre-existing in `stopWorkflow` function) is unchanged.

## Issues Encountered

- Skills are stored on the filesystem (per database.ts migration code), not in a DB table. The `configSnapshot.skills` therefore only includes `{ name, description: '' }` — only `name` is reliable; description is empty. This is consistent with the project's design and was not flagged as a deviation.

## Next Phase Readiness

- 工作流系统现在支持"打开历史 → 下载/删除"闭环,审计和调试更顺
- 后续如需:分页、分工作流类型筛选、批量删除、定时清理 — 都不在本次范围,留作未来 quick task
- 数据库 schema 可继续用相同 idempotent ALTER 模式增量扩展(任何业务字段新增都建议用此模式)

---
*Phase: 260602-0ed-execution-json-provider*
*Completed: 2026-06-01*
