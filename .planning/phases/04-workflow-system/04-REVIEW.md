---
phase: 04-workflow-system
reviewed: 2026-05-27T16:00:00Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - src/shared/types.ts
  - src/main/database.ts
  - src/main/ipc-handlers.ts
  - src/preload/index.ts
  - src/renderer/src/stores/workflowStore.ts
  - src/main/workflow/state-schema.ts
  - src/main/workflow/graph-builder.ts
  - src/main/workflow/node-executor.ts
  - src/main/workflow/workflow-runtime.ts
  - src/main/workflow/tools.ts
  - src/renderer/src/components/WorkflowEditor/WorkflowList.tsx
  - src/renderer/src/components/WorkflowEditor/WorkflowEditor.tsx
  - src/renderer/src/components/WorkflowEditor/AgentNode.tsx
  - src/renderer/src/components/WorkflowEditor/StartNode.tsx
  - src/renderer/src/components/WorkflowEditor/EndNode.tsx
  - src/renderer/src/components/WorkflowEditor/NodeConfigDrawer.tsx
  - src/renderer/src/components/WorkflowEditor/ExecutionPanel.tsx
  - src/renderer/src/components/Sidebar/Sidebar.tsx
  - src/renderer/src/stores/projectStore.ts
  - src/renderer/src/App.tsx
  - src/main/deepagent/runtime.ts
  - package.json
findings:
  critical: 8
  warning: 14
  info: 5
  total: 27
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-05-27T16:00:00Z
**Depth:** standard
**Files Reviewed:** 22
**Status:** issues_found

## Summary

对工作流系统（Phase 4）的全部 22 个源文件进行了标准深度审查。重点检查了 IPC 安全、类型安全、错误处理、并发安全和集成一致性。

发现 **8 个关键缺陷**、**14 个警告**、**5 个建议**。关键缺陷集中在工作流运行时的核心执行逻辑：循环保护失效、节点间数据流断裂、边数据丢失、主键冲突、时间戳错误等问题。这些问题意味着工作流系统在当前状态下无法正确执行，必须在上线前修复。

---

## Critical Issues

### CR-01: 循环保护完全失效 — 无限循环风险

**File:** `src/main/workflow/graph-builder.ts:31-37`

**Issue:** `createConditionalRouter` 读取 `routing[loopKey]` 检查循环计数，但没有任何代码递增该计数器。`routing` 使用 merge reducer（state-schema.ts:36-42），但没有任何节点执行器或图构建器写入 `{ [loopKey]: count + 1 }`。这意味着 `maxIterations` 参数永远不生效，条件循环可以无限执行。

**Fix:**
```typescript
// graph-builder.ts: createConditionalRouter 中，在检查后递增计数器
export function createConditionalRouter(
  condition: string,
  maxIterations?: number,
): (state: Record<string, unknown>) => string {
  return (state: Record<string, unknown>): string => {
    const routing = (state.routing as Record<string, unknown>) ?? {};

    if (maxIterations !== undefined) {
      const loopKey = `__loop_${condition}`;
      const count = (routing[loopKey] as number) ?? 0;
      if (count >= maxIterations) {
        return '__max_iterations_exceeded__';
      }
      // 必须递增计数器 — 通过返回值更新 routing state
      // 注意：router 不能直接写 state，需要在 graph builder 的
      // conditional edge 中通过 state update 机制实现
    }
    // ...
  };
}

// 方案：在 buildWorkflowGraph 中，为每个条件边添加一个计数器更新节点
// 或者在 addConditionalEdges 的 routeMap 中映射到一个递增计数器的 wrapper
```

更可靠的方案是让条件边的每个分支在返回前写入 routing state 的计数器增量。LangGraph 的 `addConditionalEdges` 只返回目标节点名，不支持 state 更新。建议在每个条件路由的目标节点前插入一个"计数器递增"虚拟节点，或改用 `addNode` + `addEdge` 模式替代纯条件边。

---

### CR-02: 节点间上游输出永远为空 — 数据流断裂

**File:** `src/main/workflow/node-executor.ts:153`

**Issue:** `createNodeStateExtractor(node.id, [])` 传入空数组 `[]` 作为 `upstreamNodeIds`。虽然 `graph-builder.ts:73-75` 正确计算了每个节点的上游节点列表，但该信息从未传递给 `createAgentNodeExecutor`。`extractState` 返回的 `upstreamOutputs` 永远是 `{}`，导致下游 Agent 节点永远无法读取上游节点的输出，工作流节点间数据传递完全失效。

**Fix:**
```typescript
// graph-builder.ts: 修改 nodeExecutor 工厂签名，传入 upstreamNodeIds
export function buildWorkflowGraph(
  workflowDef: WorkflowDefinition,
  nodeExecutor: (node: WorkflowNode, upstreamNodeIds: string[]) => (state: Record<string, unknown>) => Promise<Record<string, unknown>>,
) {
  // ...
  for (const node of workflowDef.nodes) {
    if (node.type === 'start' || node.type === 'end') continue;
    const upstreamNodeIds = workflowDef.edges
      .filter((e) => e.target === node.id && e.source !== 'start')
      .map((e) => e.source);
    const executor = nodeExecutor(node, upstreamNodeIds);  // 传入上游节点 IDs
    // ...
  }
}

// workflow-runtime.ts: 修改调用处
const builder = buildWorkflowGraph(graphData, (node, upstreamNodeIds) =>
  createAgentNodeExecutor(node, upstreamNodeIds)
);

// node-executor.ts: 接收 upstreamNodeIds 参数
export function createAgentNodeExecutor(
  node: { id: string; type: string; data: { agentId?: string; label?: string; retryCount?: number } },
  upstreamNodeIds: string[] = [],  // 新增参数
) {
  // ...
  const extractState = createNodeStateExtractor(node.id, upstreamNodeIds);
  // ...
}
```

---

### CR-03: 节点失败时 nodeRunId 主键冲突 — 数据库写入崩溃

**File:** `src/main/workflow/workflow-runtime.ts:149-180`

**Issue:** `nodeRunId` 在每次 chunk 迭代中只生成一次（line 149）。当节点失败时，`graph-builder.ts:96-105` 返回的状态同时包含 `nodeOutputs`（含错误信息）和 `errors`。代码先用 `nodeRunId` INSERT 一条 `completed` 记录（line 157-160），再用同一个 `nodeRunId` INSERT 一条 `failed` 记录（line 177-180）。第二次 INSERT 会触发 PRIMARY KEY UNIQUE 约束冲突，better-sqlite3 会抛出异常，中断整个流处理循环。

**Fix:**
```typescript
// workflow-runtime.ts: 为 success 和 error 分别生成 ID，且互斥处理
for (const [nodeId, stateUpdate] of Object.entries(chunk)) {
  const nodeOutputs = update.nodeOutputs as Record<string, unknown> | undefined;
  const errors = update.errors as Array<{ nodeId: string; error: string; timestamp: number }> | undefined;

  if (errors && errors.length > 0) {
    // 错误路径：只记录失败
    allErrors.push(...errors);
    for (const err of errors) {
      const errorRunId = crypto.randomUUID();
      db.prepare(`INSERT INTO workflow_node_runs ...`).run(
        errorRunId, executionId, err.nodeId, err.nodeId, 'failed', err.error, 'node_error', err.timestamp, Date.now()
      );
      // ... push error event
    }
  } else if (nodeOutputs?.[nodeId]) {
    // 成功路径：只记录成功
    const successRunId = crypto.randomUUID();
    db.prepare(`INSERT INTO workflow_node_runs ...`).run(
      successRunId, executionId, nodeId, nodeId, 'completed', JSON.stringify(nodeOutputs[nodeId]), Date.now(), Date.now()
    );
    // ... push end event
  }
}
```

---

### CR-04: 保存工作流丢失边的路由配置 — 条件分支数据静默丢失

**File:** `src/renderer/src/components/WorkflowEditor/WorkflowEditor.tsx:162-168`

**Issue:** `handleSave` 函数将 edges 映射为仅包含 `{ id, source, target, sourceHandle, targetHandle }` 的对象，完全丢弃了 `metadata` 字段（包含 `condition`、`maxIterations`、`targets`）。任何已配置的条件路由在保存后将静默丢失，再次加载时变为普通边。

**Fix:**
```typescript
// WorkflowEditor.tsx: handleSave 中保留 edge metadata
edges: flow.edges.map((e) => ({
  id: e.id,
  source: e.source,
  target: e.target,
  sourceHandle: e.sourceHandle,
  targetHandle: e.targetHandle,
  metadata: (e as any).metadata,  // 保留条件路由配置
})) as WorkflowDefinition['edges'],
```

更好的方案是定义一个 `EdgeData` 接口来避免 `as any`：
```typescript
interface FlowEdgeData extends Edge {
  metadata?: WorkflowEdge['metadata'];
}
```

---

### CR-05: 新建工作流保存失败 — PRIMARY KEY 为 NULL

**File:** `src/renderer/src/components/WorkflowEditor/WorkflowEditor.tsx:173` + `src/renderer/src/App.tsx:82`

**Issue:** `App.tsx:82` 创建新工作流时 `id: ''`。`WorkflowEditor.tsx:173` 执行 `id: workflow.id || undefined`，空字符串被转为 `undefined`。在 `ipc-handlers.ts:670`，`db.prepare('SELECT id FROM workflows WHERE id = ?').get(undefined)` 查不到记录，进入 INSERT 分支。SQLite 将 `undefined` 参数转为 NULL，违反 PRIMARY KEY NOT NULL 约束，导致保存失败。

**Fix:**
```typescript
// WorkflowEditor.tsx: handleSave 中，新建时生成 ID
import crypto from 'crypto'; // 或使用 uuid 库

await saveWorkflow({
  id: workflow.id || crypto.randomUUID(),  // 新建时生成 UUID
  project_id: currentProjectId,
  name: workflowName,
  description: workflow.description || '',
  graph_data: graphData,
  status: workflow.status || 'draft',
});
```

---

### CR-06: 所有节点运行记录使用相同的时间戳 — 执行历史数据错误

**File:** `src/main/workflow/workflow-runtime.ts:83, 160, 179`

**Issue:** `const now = Date.now()` 在工作流启动时捕获一次（line 83），然后所有节点的 `started_at` 都使用这个值（line 160, 179）。这意味着数据库中所有 `workflow_node_runs` 记录的 `started_at` 都是工作流启动时间，而非节点实际开始时间。`duration_ms`（line 165）使用 `Date.now() - now`，反映的是工作流总耗时而非单个节点耗时。

**Fix:**
```typescript
// workflow-runtime.ts: 在每个节点处理块中使用独立的时间戳
for (const [nodeId, stateUpdate] of Object.entries(chunk)) {
  const nodeStartTime = Date.now();  // 每个节点独立计时
  // ...

  // INSERT 时使用 nodeStartTime
  db.prepare(`INSERT INTO workflow_node_runs (... started_at, ended_at) VALUES (..., ?, ?)`)
    .run(nodeRunId, executionId, nodeId, nodeId, ..., nodeStartTime, Date.now());

  // duration_ms 使用节点级别的时间差
  const nodeEndEvent: WorkflowStreamEvent = {
    type: 'node_end',
    duration_ms: Date.now() - nodeStartTime,
    // ...
  };
}
```

注意：由于 `streamMode: 'updates'` 下 chunk 在节点完成后才到达，`nodeStartTime` 实际上仍接近节点结束时间。要获得准确的节点开始时间，需要改用 `streamMode: 'events'` 或在图执行前插入钩子。

---

### CR-07: subscribeToExecution 中 currentExecution 可能为 null 导致不完整对象

**File:** `src/renderer/src/stores/workflowStore.ts:131`

**Issue:** 当收到 `workflow_end` 事件时，代码执行：
```typescript
set({ currentExecution: { ...get().currentExecution, status: data.status, ended_at: Date.now() } as WorkflowExecution });
```
如果 `currentExecution` 是 `null`（初始状态），`...null` 展开为空对象，结果为 `{ status: ..., ended_at: ... }`，缺少 `id`、`workflow_id`、`project_id`、`trigger_source`、`started_at`、`input` 等必需字段。`as WorkflowExecution` 类型断言掩盖了此问题。

**Fix:**
```typescript
// workflowStore.ts: 先检查 currentExecution 是否存在
if (data.type === 'workflow_end') {
  const current = get().currentExecution;
  if (current) {
    set({ currentExecution: { ...current, status: data.status, ended_at: Date.now() } });
  }
  // 或者构建完整的 execution 对象：
  // set({ currentExecution: {
  //   id: executionId,
  //   workflow_id: data.workflowId,
  //   status: data.status,
  //   ended_at: Date.now(),
  //   ...
  // } as WorkflowExecution });
}
```

---

### CR-08: node_start 事件在节点执行完成后才发送 — 进度追踪语义错误

**File:** `src/main/workflow/workflow-runtime.ts:128-170`

**Issue:** 使用 `streamMode: 'updates'` 时，LangGraph.js 在节点完成执行后才发出 chunk。代码在 chunk 处理循环中发送 `node_start` 事件（line 139-146），随后在同一循环迭代中立即发送 `node_end` 事件（line 162-170）。客户端会近乎同时收到 `node_start` 和 `node_end`，使得进度追踪完全失效——用户无法区分"正在执行"和"已完成"。

**Fix:**
有两个方案：

方案 A：移除 `node_start` 事件，只发送 `node_end`，让客户端根据 `workflow_start` 后收到的第一个 `node_end` 推断节点执行。

方案 B：改用 `streamMode: 'events'` 或 LangGraph 的 `streamEvents` API，在节点开始执行前获取事件。这需要更大的重构但能提供准确的生命周期事件：
```typescript
const stream = await graph.streamEvents(
  { inputs: input, messages: [] },
  { configurable: { thread_id: threadId } }
);

for await (const event of stream) {
  if (event.event === 'on_chain_start') {
    pushWorkflowEvent(executionId, { type: 'node_start', ... });
  } else if (event.event === 'on_chain_end') {
    pushWorkflowEvent(executionId, { type: 'node_end', ... });
  }
}
```

---

## Warnings

### WR-01: 超时定时器未清理 — 资源泄漏和未处理的 Promise rejection

**File:** `src/main/workflow/node-executor.ts:209-211`

**Issue:** `Promise.race` 中的 `setTimeout` 创建了一个 5 分钟定时器。当 Agent 在超时前完成时，定时器未被 `clearTimeout` 清除。定时器最终触发时会 reject 一个已被 race 忽略的 Promise，产生未处理的 rejection 警告。

**Fix:**
```typescript
// node-executor.ts: 使用 AbortController 或手动清理定时器
let timeoutId: NodeJS.Timeout;
const timeoutPromise = new Promise<never>((_, reject) => {
  timeoutId = setTimeout(
    () => reject(new AgentTimeoutError(agentId, DEFAULT_TIMEOUT_MS)),
    DEFAULT_TIMEOUT_MS
  );
});

try {
  const result = await Promise.race([agent.invoke({...}), timeoutPromise]);
  clearTimeout(timeoutId);
  return { result: ... };
} catch (err) {
  clearTimeout(timeoutId);
  throw err;
}
```

---

### WR-02: JSON.parse 无 schema 验证 — 恶意或损坏数据可导致运行时崩溃

**File:** `src/main/workflow/workflow-runtime.ts:87`

**Issue:** `JSON.parse(workflowRow.graph_data)` 的结果直接传递给 `buildWorkflowGraph`，没有任何 schema 验证。如果 `graph_data` 被手动修改或数据库损坏，解析出的对象可能缺少 `nodes`/`edges` 字段或包含非法值，导致不可预测的运行时错误。

**Fix:**
```typescript
// workflow-runtime.ts: 使用 Zod schema 验证
import { z } from 'zod';

const WorkflowDefinitionSchema = z.object({
  nodes: z.array(z.object({
    id: z.string(),
    type: z.enum(['start', 'agent', 'end']),
    position: z.object({ x: z.number(), y: z.number() }),
    data: z.object({ label: z.string() }).passthrough(),
  })),
  edges: z.array(z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
  }).passthrough()),
});

const graphData = WorkflowDefinitionSchema.parse(JSON.parse(workflowRow.graph_data));
```

---

### WR-03: IPC handler 缺少输入验证 — 任意数据可写入数据库

**File:** `src/main/ipc-handlers.ts` (多处)

**Issue:** 多个 IPC handler 接受 `any` 类型参数，未验证必填字段：
- `db:saveMessage`（line 186）：未检查 `id`、`session_id`、`role`、`content` 是否存在
- `db:saveWorkflow`（line 665）：未检查 `name`、`project_id` 是否存在
- `db:saveMcpServer`（line 532）：未检查 `name`、`server_type`
- `workflow:run`（line 259）：未验证 `workflowId`、`projectId` 格式

**Fix:** 至少对必填字段做存在性检查：
```typescript
ipcMain.handle('db:saveMessage', (_, message: any) => {
  if (!message?.id || !message?.session_id || !message?.role || !message?.content) {
    throw new Error('Missing required fields: id, session_id, role, content');
  }
  // ...
});
```

---

### WR-04: pushWorkflowEvent 只发送到第一个窗口

**File:** `src/main/workflow/workflow-runtime.ts:34-38`

**Issue:** `BrowserWindow.getAllWindows()[0]` 只向第一个窗口发送事件。如果存在多个窗口（如开发者工具窗口、多窗口模式），事件可能发送到错误的窗口。

**Fix:**
```typescript
function pushWorkflowEvent(executionId: string, event: WorkflowStreamEvent) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send(`workflow:event-${executionId}`, event);
    }
  }
}
```

---

### WR-05: 大量使用 `any` 类型 — 类型安全失效

**File:** 多个文件

**Issue:** 类型安全被大量 `any` 破坏：
- `ipc-handlers.ts:116` — `getProviderWithKey` 返回 `provider as any`
- `ipc-handlers.ts:186,230,405,532,578,665` — handler 参数为 `any`
- `preload/index.ts:19,22,28,32,40,47,52` — save 方法参数为 `any`
- `workflowStore.ts:15,55` — saveWorkflow 参数为 `any`
- `node-executor.ts:165` — `providerType as any` 强制类型断言
- `workflowStore.ts:40,50` — `catch (err: any)` 模式

**Fix:** 定义具体的输入类型接口，使用 `unknown` 替代 `any`，用类型守卫做运行时检查。

---

### WR-06: ElectronAPI 接口缺少 renameProject 声明

**File:** `src/shared/types.ts:302-346`

**Issue:** preload（`preload/index.ts:13`）暴露了 `db.renameProject`，但 `ElectronAPI` 接口未声明该方法。渲染进程代码无法在 TypeScript 类型检查下使用该方法。

**Fix:**
```typescript
// types.ts: ElectronAPI.db 中添加
renameProject: (id: string, name: string) => Promise<{ id: string; name: string; updated_at: number }>;
```

---

### WR-07: React useEffect 依赖不完整

**File:** `src/renderer/src/components/WorkflowEditor/WorkflowEditor.tsx:63-85`

**Issue:** `useEffect` 依赖数组为 `[workflow.id]`，但 effect 体中读取了 `workflow.graph_data` 和 `workflow.name`。如果 workflow 对象在 ID 不变的情况下被更新（如外部保存后刷新），effect 不会重新运行，导致编辑器显示过时数据。

**Fix:** 将依赖改为 `[workflow]` 或 `[workflow.id, workflow.graph_data, workflow.name]`，或在 effect 中使用 ref 跟踪变化。

---

### WR-08: agentInstances Map 无界增长 — 内存泄漏

**File:** `src/main/ipc-handlers.ts:638`

**Issue:** `const agentInstances = new Map<string, any>()` 在 `deepagents:createAgent` 中添加条目，但从不移除。随着用户创建 Agent 实例，Map 持续增长。

**Fix:** 添加清理逻辑或使用带 TTL 的 Map。如果 Agent 实例不需要跨请求保持，考虑在创建后立即丢弃或设置过期清理。

---

### WR-09: 运行工作流前未确认保存成功

**File:** `src/renderer/src/components/WorkflowEditor/WorkflowEditor.tsx:187-198`

**Issue:** `handleRun` 先调用 `await handleSave()`，但 `handleSave` 内部 catch 了错误并仅 `console.error`，不向外抛出。因此即使保存失败，`handleRun` 仍继续执行 `runWorkflow`，可能基于过时或无效的图定义执行。

**Fix:**
```typescript
const handleSave = useCallback(async () => {
  // ...
  try {
    // ...
    await saveWorkflow({...});
  } catch (err) {
    console.error('Failed to save workflow:', err);
    throw err;  // 向调用方传播错误
  } finally {
    setIsSaving(false);
  }
}, [...]);
```

---

### WR-10: 运算符优先级歧义 — 条件表达式可读性差

**File:** `src/main/ipc-handlers.ts:305-307, 334-336`

**Issue:**
```typescript
const useAnthropicUrl = provider.provider_type === 'anthropic' ||
  (provider.provider_type === 'deepseek' || provider.provider_type === 'minimax' || provider.provider_type === 'minimax-overseas') &&
  isAnthropicCompatibleApiUrl(provider.api_url);
```
由于 `&&` 优先级高于 `||`，实际求值为 `A || ((B || C || D) && E)`，恰好是预期行为。但括号仅包裹了 OR 条件组，容易被误读为 `(A || B || C || D) && E`。

**Fix:**
```typescript
const isAnthropicType = ['deepseek', 'minimax', 'minimax-overseas'].includes(provider.provider_type);
const useAnthropicUrl = provider.provider_type === 'anthropic' ||
  (isAnthropicType && isAnthropicCompatibleApiUrl(provider.api_url));
```

---

### WR-11: stopWorkflow 不等待实际中止完成

**File:** `src/main/workflow/workflow-runtime.ts:242-251`

**Issue:** `stopWorkflow` 设置 `aborted = true` 并立即更新数据库状态为 `stopped`。但实际的流处理循环只在两次 chunk 之间检查 `aborted` 标志。如果当前正在执行一个 Agent 节点（最长 5 分钟超时），`stopWorkflow` 返回后数据库显示 `stopped`，但实际执行仍在继续。调用方收到成功响应后可能认为已停止。

**Fix:**
```typescript
export async function stopWorkflow(executionId: string): Promise<void> {
  const execution = activeExecutions.get(executionId);
  if (execution) {
    execution.aborted = true;
  }
  // 不在此处更新 DB，让 runWorkflow 的 finally 块统一处理状态更新
  // 或者返回 Promise，等待实际中止完成
}
```

---

### WR-12: 节点拖拽生成的 ID 可能碰撞

**File:** `src/renderer/src/components/WorkflowEditor/WorkflowEditor.tsx:130`

**Issue:** `const id = \`${type}-${Date.now()}\`` 使用毫秒时间戳生成节点 ID。如果用户快速连续拖拽两个同类型节点（同一毫秒内），会产生相同的 ID，导致节点覆盖。

**Fix:**
```typescript
const id = `${type}-${crypto.randomUUID()}`;
```

---

### WR-13: getSkillVersions handler 忽略参数

**File:** `src/main/ipc-handlers.ts:499-502`

**Issue:** `db:getSkillVersions` handler 声明接受 `skillId` 参数但完全忽略它，始终返回空数组。这是死参数，如果未来有调用方依赖按 skillId 过滤，会产生困惑。

**Fix:** 移除参数或添加 TODO 注释说明原因。

---

### WR-14: 重复的 helper 函数 — 维护负担

**File:** `src/main/workflow/node-executor.ts:57-99` + `src/main/deepagent/runtime.ts:100-179`

**Issue:** `getAgent`、`getProvider`、`getAgentMcpServers`、`getAgentSkillNames` 在两个文件中重复实现。逻辑相同但微妙差异（如 `getProvider` 的错误消息不同），修改一处容易遗漏另一处。

**Fix:** 提取到共享模块 `src/main/db-helpers.ts`。

---

## Info

### IN-01: 生产代码中遗留 console.log 调试语句

**File:** `src/main/deepagent/runtime.ts:497, 502, 504, 508, 510, 541`

**Issue:** 多处 `console.log('[runtime] ...')` 调试语句，包含 subagent IDs 等内部信息。应移除或改为 `electron-log` 的 debug 级别。

**Fix:** 删除或替换为 `log.debug(...)`。

---

### IN-02: 数据库迁移注释重复

**File:** `src/main/database.ts:118-120`

**Issue:** 连续两行相同的注释 `// Phase 3 & Phase 4: Agent Library, Skills, MCP Servers tables`。

**Fix:** 删除重复注释。

---

### IN-03: selectedNode 状态初始化冗余类型断言

**File:** `src/renderer/src/components/WorkflowEditor/WorkflowEditor.tsx:57`

**Issue:** `useState<Node | null>(null as Node | null)` — `null` 已可赋值给 `Node | null`，`as` 断言多余。

**Fix:** `useState<Node | null>(null)`

---

### IN-04: workflow-runtime.ts 底部导入 ipcMain

**File:** `src/main/workflow/workflow-runtime.ts:281`

**Issue:** `import { ipcMain } from 'electron'` 放在文件末尾。ES 模块导入会被提升（hoisted），运行时无影响，但代码可读性差，依赖关系不明显。

**Fix:** 将导入移到文件顶部与其他导入一起。

---

### IN-05: NodeConfigDrawer 未显示当前配置的 Agent Provider 信息

**File:** `src/renderer/src/components/WorkflowEditor/NodeConfigDrawer.tsx:124-145`

**Issue:** Agent 信息摘要只显示 MCP 和 Skills 数量，不显示 Provider/Model 信息。用户无法确认节点将使用哪个 LLM 模型执行。

**Fix:** 在摘要区域添加 provider 和 model 信息。
