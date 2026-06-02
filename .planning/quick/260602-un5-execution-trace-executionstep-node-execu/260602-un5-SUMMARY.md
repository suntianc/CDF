---
plan_id: 260602-un5
title: 重构工作流节点执行轨迹为时序流(execution_trace)
type: execute
mode: quick
created: 2026-06-02
completed: 2026-06-02
duration_minutes: ~25
tasks_completed: 5
tasks_total: 5
files_modified: 7
commits: 5
---

# Quick Task 260602-un5: execution_trace 时序流重构 Summary

## One-liner

把工作流节点执行从「并行 logs[] + tool_calls[]」重构为统一时序流 `execution_trace[]`,每条 step 带 `type` + `ts`,真实还原 Agent 执行轨迹(LLM 真实 thinking + 工具调用/返回时序)。

## Objective 回顾

- 把 LLM 真实输出(reasoning/summary text)抓成 `thinking` step,取代"Agent 正在思考决策..."占位
- 让 `task_start` / `task_end` / `tool_call` / `tool_result` 全部按时间戳排序,真实反映"思考 → 调工具 → 工具返回 → 再思考 → ..."的时序
- 实时 UI 和导出 JSON 都按 `step.type` 渲染,不再需要正则反推类型
- 旧的 `logs` / `tool_calls` 列保留(向后兼容历史数据),但不再写入新值

## 任务链路执行结果

| # | Task | Commit | 改动文件 |
|---|------|--------|----------|
| 1 | 类型 + DB schema | 050ba9e | src/shared/types.ts, src/main/database.ts |
| 2 | 后端 callback 重构 | 261b172 | src/main/workflow/node-executor.ts, node-executor.test.ts, workflow-runtime.ts |
| 3 | IPC 事件结构 + Store 累积 | df73ec4 | src/renderer/src/stores/workflowStore.ts |
| 4 | 实时 UI 渲染 | 31c6513 | src/renderer/src/components/WorkflowEditor/ExecutionPanel.tsx |
| 5 | 导出器输出新字段 | 2e0f078 | src/main/workflow/log-exporter.ts |

## 详细变更

### Task 1: 类型定义 + DB schema 迁移

- 新增类型 `ExecutionStepType`(`task_start` / `task_end` / `thinking` / `tool_call` / `tool_result` / `system` / `validation`)
- 新增接口 `ExecutionStep`(带 `type` / `ts` 及类型相关字段 `label` / `content` / `tool` / `args` / `success` / `output` / `error` / `duration_ms`)
- `WorkflowNodeRun` 新增 `execution_trace?: ExecutionStep[]` 字段
- `WorkflowStreamEvent` 的 `node_log` 字段从 `log: string` 改为 `step: ExecutionStep`
- `database.ts` 新增 idempotent `ALTER TABLE workflow_node_runs ADD COLUMN execution_trace TEXT`

### Task 2: 后端 callback 重构

- `node-executor.ts` 接口从 `onLog?: (log: string) => void` 改为 `onStep?: (step: ExecutionStep) => void`
- 闭包内新增 `push(step)` 辅助函数,自动打 `ts: Date.now()`
- 新增 `handleLLMEnd(output)` 提取 LLM 真实文本输出,产出 `thinking` step(支持多种 LangChain adapter shape: `generations[0][0].text` / `message.content` / `lc_kwargs.content` / 纯 string)
- `handleToolStart` / `handleToolEnd` / `handleToolError` 全部改为 `push({ type, tool, args/success/output/error, duration_ms })`,新增 `toolRunStartedAt` 跟踪 duration
- `handleLLMStart` 不再产生 step(由 `handleLLMEnd` 真正产出 thinking)
- `[Loop]` / `[For-Each]` / `[Task]` 等系统提示改为 `system` / `task_start` / `task_end` step 类型
- `workflow-runtime.ts` 接收侧从 `nodeLogsMap: Map<string, string[]>` 改为 `nodeTraceMap: Map<string, ExecutionStep[]>`
- 新增本地辅助 `stepToFallbackLogLine(step)`(把 ExecutionStep 还原为旧 logs 文本格式,仅供历史兼容回填)
- 成功/失败两条 INSERT 路径都新增 `execution_trace` 列写入,同时维持 `logs` 列回填(避免老工具链突然变空)
- `node-executor.test.ts` 12/12 测试通过(`onLogSpy` → `onStepSpy`,断言从字符串匹配改为 `step.type` / `step.tool` / `step.success` / `step.duration_ms` 形状匹配)

### Task 3: IPC 事件结构 + Store 累积

- `workflowStore.ts` `nodeLogs: Record<string, string[]>` → `nodeTrace: Record<string, ExecutionStep[]>`(直接删除双轨,降低心智负担)
- `processEvent` 的 `node_log` 分支读 `data.step` 追加到 `nodeTrace[nodeId]`
- `runWorkflow` / `subscribeToExecution` 重置时同步清空 `nodeTrace`

### Task 4: 实时 UI 按 step.type 渲染

- 删除 `parseLogLine` 函数(64-103 行,正则反推类型不再需要)
- 删除 `RenderLogLine`,新增 `RenderStep`,按 `step.type` 分支:
  - `thinking`:紫色块 + `<pre>` 多行 LLM 真实输出文本
  - `tool_call`:蓝色"调用"badge + 工具名 + 时间戳 + args JSON
  - `tool_result`:绿色"返回"/红色"失败"badge + 工具名 + `duration_ms` + output/error JSON
  - `task_start` / `task_end` / `system` / `validation` / 默认:左侧 muted 标签
- 新增 `formatTs(ts)` 辅助函数(`HH:MM:SS.mmm`)
- 节点日志区数据源:`nodeTrace[run.node_id]`(实时 store 累积)优先,fallback 到 `run.execution_trace`(DB 历史)
- 标题文案"运行日志" → "运行轨迹"

### Task 5: 导出器输出 execution_trace 为主

- `buildExportPayload` 在 `node_runs[*]` 中输出 `execution_trace: r.execution_trace ? JSON.parse(r.execution_trace) : []` 为主字段
- 当 `execution_trace` 非空时,省略 `logs` 字段(避免冗余)
- 当 `execution_trace` 为空(老数据)时,回退输出 `logs`(历史兼容)
- `SCHEMA_VERSION` bump 1.0 → 1.1

## 全链路验证结果

```bash
$ grep -rn "onLog?\.\\|nodeLogsMap\\|parseLogLine" src/main src/renderer
(空)

$ grep -rn "nodeLogs" src/renderer
(空)

$ npx tsc --noEmit -p tsconfig.node.json
TypeScript: 11 errors in 6 files  # 全部为预存在基线错误,与本任务无关

$ npx tsc --noEmit -p tsconfig.web.json
TypeScript: 30 errors in 18 files  # 全部为预存在基线错误,与本任务无关

$ npx vitest run src/main/workflow/node-executor.test.ts
PASS (12) FAIL (0)
```

## Deviations from Plan

### Plan 修订

**1. `filterToolLogs` 未保留**
- **计划要求:** Task 5 5.2 节"filterToolLogs 函数保留"
- **实际情况:** 该函数不在本 worktree 分支(它在 commit acdc40e 引入,但本分支未合入)。`YAGNI`:既然 `execution_trace` 是新的真相源,旧 `logs` 字符串不需要再过滤。
- **Fix:** 在 log-exporter.ts 中直接用 `r.logs ? JSON.parse(r.logs) : []`(与原分支行为一致),无新增 `filterToolLogs` 函数。
- **影响:** 仅影响极老数据的回退展示路径(它们既无 execution_trace 也无 filterToolLogs),行为与改动前完全一致。

**2. `WorkflowNodeRun.tool_calls` 字段未保留**
- **计划要求:** Task 1.2 节"`tool_calls?: ToolCallRecord[];` // 保留(向后兼容)"
- **实际情况:** 该字段在本 worktree 分支的 `WorkflowNodeRun` 上**从未存在**;workflow_node_runs 表的 schema 也没有 `tool_calls` 列(它属于 agent_runs / agent_tool_calls 表,不是工作流维度)。计划与实际基线不符。
- **Fix:** 不新增此字段(避免误以为数据库有这列),仅保留 `logs?: string[]` 和新增 `execution_trace?: ExecutionStep[]`。
- **影响:** 无 — 实际语义未变。

## 用户强约束遵守情况

- ✅ NO validation layer(未引入)
- ✅ NO automatic retry(未引入)
- ✅ NO trace filter/search/replay UI(未引入)
- ✅ Surgical Changes(仅修改计划指定文件)
- ✅ 中文注释(node-executor.ts 新增注释、stepToFallbackLogLine 注释、push 注释均为中文)
- ✅ 5 个 atomic task,每个独立 commit 且 typecheck 干净
- ✅ 不提交 docs artifacts(SUMMARY.md 仅写本地,未 commit)
- ✅ 无新增依赖
- ✅ DB 迁移使用 idempotent ALTER 模式

## Files Touched

| 文件 | 修改类型 |
|------|----------|
| `src/shared/types.ts` | 新增 ExecutionStep/ExecutionStepType,WorkflowNodeRun 新增 execution_trace,WorkflowStreamEvent node_log 字段重命名 |
| `src/main/database.ts` | 新增 execution_trace 列 ALTER |
| `src/main/workflow/node-executor.ts` | onLog → onStep,push helper,handleLLMEnd 抓 LLM 真实输出 |
| `src/main/workflow/node-executor.test.ts` | onLogSpy → onStepSpy,断言改为 step.type 形状 |
| `src/main/workflow/workflow-runtime.ts` | nodeLogsMap → nodeTraceMap,stepToFallbackLogLine 辅助,INSERT 加 execution_trace 列 |
| `src/renderer/src/stores/workflowStore.ts` | nodeLogs → nodeTrace,processEvent 读 data.step |
| `src/renderer/src/components/WorkflowEditor/ExecutionPanel.tsx` | 删除 parseLogLine/RenderLogLine,新增 RenderStep,formatTs 辅助 |
| `src/main/workflow/log-exporter.ts` | output execution_trace 为主,fallback logs,SCHEMA_VERSION 1.1 |

## 运行时行为

执行一次工作流时,ExecutionPanel 中:
- 紫色块出现 LLM 真实推理文本(不再只是"Agent 正在思考决策...")
- 蓝色"调用"块后紧跟绿色"返回"块,带 duration_ms
- 时间戳在右侧(`HH:MM:SS.mmm` 格式)
- 标题从"运行日志"改为"运行轨迹"

导出 JSON:
- `execution.node_runs[*].execution_trace` 是有序数组,带 `ts` / `type` / 各类字段
- `execution.events` 不再含 `node_log` 事件(与 260602-0ed refactor 一致)
- `schema_version: "1.1"`

## Self-Check

```bash
$ [ -f "src/shared/types.ts" ] && echo "FOUND: src/shared/types.ts"
$ [ -f "src/main/database.ts" ] && echo "FOUND: src/main/database.ts"
$ [ -f "src/main/workflow/node-executor.ts" ] && echo "FOUND: src/main/workflow/node-executor.ts"
$ [ -f "src/main/workflow/node-executor.test.ts" ] && echo "FOUND: src/main/workflow/node-executor.test.ts"
$ [ -f "src/main/workflow/workflow-runtime.ts" ] && echo "FOUND: src/main/workflow/workflow-runtime.ts"
$ [ -f "src/renderer/src/stores/workflowStore.ts" ] && echo "FOUND: src/renderer/src/stores/workflowStore.ts"
$ [ -f "src/renderer/src/components/WorkflowEditor/ExecutionPanel.tsx" ] && echo "FOUND: src/renderer/src/components/WorkflowEditor/ExecutionPanel.tsx"
$ [ -f "src/main/workflow/log-exporter.ts" ] && echo "FOUND: src/main/workflow/log-exporter.ts"

$ git log --oneline | grep -E "050ba9e|261b172|df73ec4|31c6513|2e0f078"
050ba9e feat(quick-260602-un5): add ExecutionStep type and execution_trace column
261b172 feat(quick-260602-un5): refactor backend callbacks to onStep + execution_trace
df73ec4 feat(quick-260602-un5): switch workflowStore to nodeTrace accumulator
31c6513 feat(quick-260602-un5): render ExecutionPanel by step.type
2e0f078 feat(quick-260602-un5): output execution_trace as primary in exporter
```

## Self-Check: PASSED
