# Phase 12 SDK 能力探针：技术验证报告

**日期：** 2026-06-19
**版本：** 1.0
**执行人：** GSD Phase 12 Executor

---

## 1. 环境信息

| 组件 | 版本 | 路径 |
|------|------|------|
| `deepagents` SDK | **1.10.2** | `node_modules/deepagents/dist/index.d.ts` |
| `@langchain/langgraph` | **1.3.6** | `node_modules/@langchain/langgraph/dist/index.d.ts` |
| `langchain` | 依赖 deepagents `^1.4.0` | `node_modules/langchain/dist/agents/middleware/hitl.d.ts` |
| `@langchain/langgraph-sdk` | 依赖 deepagents `^1.9.1` | — |

deepagents SDK 在 `package.json` 中声明依赖 `"@langchain/langgraph": "^1.3.0"`，CDF 实际安装版本 1.3.6，满足约束。

---

## 2. 验证线 1 — T1：Send API 并行 fan-out

### 2.1 结论

**T1 假设：部分成立。** LangGraph Send API 在 CDF 当前安装版本中完全可用，但 deepagents SDK 自身不重新导出 `Send` 类。正确路径是：在 `graph-builder.ts`（Workflow 路径）中直接从 `@langchain/langgraph` 导入 `Send`，这与现有代码风格完全一致。

### 2.2 代码级证据

**LangGraph 导出 Send 类** [VERIFIED: `@langchain/langgraph/dist/index.d.ts:45`]

```typescript
// node_modules/@langchain/langgraph/dist/index.d.ts 第 2 行和第 45 行
import { COMMAND_SYMBOL, Command, CommandInstance, CommandParams, END, INTERRUPT, 
  Interrupt, Overwrite, OverwriteValue, START, Send, isCommand, isInterrupted } 
  from "./constants.js";

// 第 45 行 export 列表明确包含：
export { ... Send, ... };
```

**Send 类完整签名** [VERIFIED: `@langchain/langgraph/dist/constants.d.ts:81`]

```typescript
// node_modules/@langchain/langgraph/dist/constants.d.ts
interface SendInterface<Node extends string = string, Args = any> {
  node: Node;
  args: Args;
}

declare class Send<Node extends string = string, Args = any> implements SendInterface<Node, Args> {
  lg_name: string;
  node: Node;
  args: Args;
  constructor(node: Node, args: Args);
  toJSON(): { lg_name: string; node: Node; args: Args; };
}
```

**deepagents SDK 不导出 Send** [VERIFIED: `node_modules/deepagents/dist/index.d.ts` 末尾 export 列表]

deepagents 的 export 列表中没有 `Send`。SDK 仅导入了 `Command`（用于 HITL 恢复流程），而非 Send。这意味着 Send API 无法通过 deepagents 使用，必须直接从 `@langchain/langgraph` 引入。

**CDF 已有直接使用 LangGraph 的先例** [VERIFIED: `src/main/workflow/graph-builder.ts:9`]

```typescript
// src/main/workflow/graph-builder.ts
import { StateGraph, START, END } from '@langchain/langgraph';
```

CDF Workflow 路径的图构建器已经直接 `import` LangGraph，不通过 deepagents 转发。

### 2.3 Send 使用路径（fan-out 实现方案）

在 `graph-builder.ts` 中添加 `Send` 到现有 import，然后在 `addConditionalEdges` 的路由函数中返回 Send 实例数组：

```typescript
// 修改 graph-builder.ts 第 9 行
import { StateGraph, START, END, Send } from '@langchain/langgraph';

// 路由函数返回 Send[] 实现 fan-out
const fanOutRouter = (state: Record<string, unknown>): Send[] => {
  const items = state.items as string[];  // 待并行处理的项列表
  return items.map((item, i) => new Send(`worker_node`, { item, index: i }));
};

builder.addConditionalEdges('__start__', fanOutRouter);
```

官方文档（`constants.d.ts` 中的 JSDoc 示例）完整说明了用法：

```typescript
// 官方示例
const continueToJokes = async (state) => {
  return state.subjects.map((subject) => {
    return new Send("generate_joke", { subjects: [subject] });
  });
};

const graph = new StateGraph(ChainState)
  .addNode("generate_joke", ...)
  .addConditionalEdges("__start__", continueToJokes)  // Send[] 实现并行
  .compile();
```

### 2.4 WorkflowState 兼容性分析

**并行节点的状态合并已有 Reducer，可以支持 fan-out** [VERIFIED: `src/main/workflow/state-schema.ts`]

```typescript
// src/main/workflow/state-schema.ts
nodeOutputs: new ReducedValue(
  z.record(z.string(), z.unknown()).default(() => ({})),
  {
    reducer: (existing, update) => ({ ...existing, ...update }),  // spread-merge
  }
),

errors: new ReducedValue(
  z.array(...).default(() => []),
  { reducer: (existing, update) => [...existing, ...update] },  // append
),
```

`nodeOutputs` 的 spread-merge reducer 是**并行安全**的：多个并行节点写入各自的 key（`nodeOutputs[node.id]`），reducer 将它们合并而不是覆盖。`errors` 和 `artifacts` 也是 append reducer。**WorkflowState schema 无需修改即可支持 Send fan-out。**

唯一需要注意的是：fan-out 的 worker 节点输出如果需要聚合，应各自写入 `nodeOutputs[node.id]`，fan-in 节点读取 `state.nodeOutputs` 中多个 key 完成聚合——这与现有 `createNodeStateExtractor` 的 `upstreamNodeIds` 机制天然兼容。

---

## 3. 验证线 2 — T2：interrupt() HITL 原语

### 3.1 结论

**T2 假设：成立，且有两条可用路径。** LangGraph `interrupt()` 原语在 CDF 安装版本中可直接使用；deepagents 的 `interruptOn` 机制通过 `humanInTheLoopMiddleware` 封装了它，Chat 路径已验证可用。Workflow 路径的 `createDeepAgent` 调用**缺少 `interruptOn` 配置**，导致工作流节点内高危操作无人类审批。

### 3.2 代码级证据

**LangGraph 导出 interrupt() 函数** [VERIFIED: `@langchain/langgraph/dist/index.d.ts:28` 和 `interrupt.d.ts:45`]

```typescript
// node_modules/@langchain/langgraph/dist/interrupt.d.ts
declare function interrupt<I = unknown, R = any>(value: I): R;

// node_modules/@langchain/langgraph/dist/index.d.ts 第 28 行：
import { InferInterruptInputType, InferInterruptResumeType, interrupt } from "./interrupt.js";
// 第 45 行 export 列表明确包含：interrupt
```

**deepagents interruptOn 机制封装了 interrupt()** [VERIFIED: `langchain/dist/agents/middleware/hitl.d.ts:515`]

deepagents 的 `CreateDeepAgentParams` 接受 `interruptOn?: Record<string, boolean | InterruptOnConfig>` 参数（第 1979 行）。该参数传递给 `humanInTheLoopMiddleware`，后者在 `afterModel` 阶段拦截工具调用，使用 LangGraph `interrupt()` 原语暂停执行，等待用户的 `approve/edit/reject` 决策，通过 `Command({ resume })` 恢复。

```typescript
// langchain/dist/agents/middleware/hitl.d.ts
type InterruptOnConfig = {
  allowedDecisions: ("approve" | "edit" | "reject")[];
  description?: string | DescriptionFactory;
  argsSchema?: Record<string, any>;
};
```

**Chat 路径已有完整 HITL 实现** [VERIFIED: `src/main/deepagent/runtime.ts:55-81`]

```typescript
// src/main/deepagent/runtime.ts
const DEFAULT_INTERRUPT_ON = {
  write_file: { allowedDecisions: ['approve', 'edit', 'reject'] },
  edit_file: { allowedDecisions: ['approve', 'edit', 'reject'] },
  delete_file: { allowedDecisions: ['approve', 'reject'] },
  delete_agent: { allowedDecisions: ['approve', 'reject'] },
  update_agent: { allowedDecisions: ['approve', 'edit', 'reject'] },
  create_agent: { allowedDecisions: ['approve', 'edit', 'reject'] },
};

// createDeepAgent 调用 (第 619-633 行)
const deepAgent = createDeepAgent({
  ...
  interruptOn: DEFAULT_INTERRUPT_ON,  // ← Chat 路径：HITL 已配置
  checkpointer,
});
```

**Workflow 路径缺少 interruptOn** [VERIFIED: `src/main/workflow/node-executor.ts:361-368`]

```typescript
// src/main/workflow/node-executor.ts
const agent = createDeepAgent({
  model,
  backend,
  systemPrompt: agentRow.system_prompt || undefined,
  skills: skillsSources.length > 0 ? skillsSources : undefined,
  permissions,
  tools: [...mcpRuntime.tools, ...builtInTools],
  // ← 无 interruptOn！工作流节点内的 write_file/delete_file 等高危工具无审批
});
```

这正是 Phase 11 报告识别的**安全缺口**：工作流节点中的 DeepAgent 可以不经用户审批直接调用高危文件操作。

### 3.3 两种添加 HITL 的路径分析

**路径 A — 给 node-executor.ts 的 createDeepAgent 加 interruptOn 配置**

在 `createAgentNodeExecutor` 中的 `createDeepAgent` 调用上添加 `interruptOn` 参数，将工作流节点内的 Agent 行为同步纳入 HITL 审批。

```typescript
// node-executor.ts 修改方案
const agent = createDeepAgent({
  model,
  backend,
  systemPrompt: agentRow.system_prompt || undefined,
  skills: skillsSources.length > 0 ? skillsSources : undefined,
  permissions,
  tools: [...mcpRuntime.tools, ...builtInTools],
  interruptOn: {                                    // 新增
    write_file: { allowedDecisions: ['approve', 'edit', 'reject'] },
    delete_file: { allowedDecisions: ['approve', 'reject'] },
    edit_file: { allowedDecisions: ['approve', 'edit', 'reject'] },
  },
});
```

- **优点**：复用已有机制；与 Chat 路径行为一致；UI 审批流程无需改动（已通过 Chat 路径验证）。
- **缺点**：工作流 `builder.compile()` 时需要传入 `checkpointer` 才能支持 interrupt（`workflow-runtime.ts:316` 已有 `builder.compile({ checkpointer })`，满足条件）；workflow 的 interrupt resume 路径需要新增 IPC handler 来处理 `Command({ resume })`。
- **推荐度：高**，为 Phase 14 的首选路径。

**路径 B — 在 graph-builder.ts 的节点函数中直接调用 interrupt()**

在 LangGraph 节点函数内部直接调用 `interrupt(value)`，绕过 deepagents 的 `humanInTheLoopMiddleware`，实现图级别的 HITL 暂停。

```typescript
// graph-builder.ts 修改方案（示意）
import { StateGraph, START, END, interrupt } from '@langchain/langgraph';

builder.addNode('review_node', async (state) => {
  const decision = await interrupt({ message: '请审批此操作', data: state.pendingAction });
  if (decision === 'approve') { /* 继续 */ }
  return { routing: { review: decision } };
});
```

- **优点**：粒度更细（图节点级，而非工具级）；适合"整个节点需人类审批"场景；不依赖 deepagents 的 middleware 层。
- **缺点**：需要在 `workflow-runtime.ts` 的流式执行循环中处理 `GraphInterrupt` 异常；resume 需要通过 `graph.stream(new Command({ resume }), config)` 重新入图；Renderer 侧需要新增审批 UI（工作流审批与 Chat 审批 UI 不同）。
- **推荐度：中**，适合 Phase 14 中"工作流节点级审批"场景（如 Review 节点等待人工确认），作为路径 A 的补充。

### 3.4 推荐实施策略

Phase 14 采用**路径 A 为主、路径 B 为辅**：

1. 工具级 HITL（`write_file` 等）：路径 A（`interruptOn` 参数），复用现有审批 UI。
2. 节点级 HITL（Review 节点、人工确认节点）：路径 B（`interrupt()`），新增工作流专属审批 UI。

---

## 4. 验证线 3 — 绕过 SDK 直接使用 LangGraph 的可行性

### 4.1 结论

**绕过 SDK 已有先例，完全可行。** CDF 的 Workflow 路径在架构上已经是"deepagents 只用于节点内 Agent，LangGraph 直接用于图结构"的混合模式。这不是绕过，而是按职责分工的正确使用方式。

### 4.2 现有架构分工 [VERIFIED: `src/main/workflow/graph-builder.ts:9`, `src/main/workflow/node-executor.ts:10`]

```
CDF Workflow 路径的架构分工（已实现）：

┌─────────────────────────────────────────┐
│  graph-builder.ts                       │
│  import { StateGraph, START, END }      │  ← 直接用 LangGraph
│  from '@langchain/langgraph'            │
│                                         │
│  buildWorkflowGraph():                  │
│    builder = new StateGraph(...)        │  ← LangGraph 原生 API
│    builder.addNode(...)                 │
│    builder.addEdge(...)                 │
│    builder.addConditionalEdges(...)     │
│    return builder                       │
└─────────────────────────────────────────┘
           │
           │ nodeExecutor(node, upstreamNodeIds) 回调
           ↓
┌─────────────────────────────────────────┐
│  node-executor.ts                       │
│  import { createDeepAgent, ... }        │  ← 用 deepagents SDK
│  from 'deepagents'                      │
│                                         │
│  createAgentNodeExecutor():             │
│    const agent = createDeepAgent({...}) │  ← 每个节点内部是 DeepAgent
│    return async (state) => { ... }      │
└─────────────────────────────────────────┘
```

**结论**：`graph-builder.ts` 是图级别（负责节点连接、边、路由），直接使用 LangGraph；`node-executor.ts` 是节点内部（负责 Agent 执行），使用 deepagents SDK。这两层已经是正交关系，不存在冲突。

### 4.3 在 graph-builder.ts 中同时 import Send 和 interrupt 的可行性 [VERIFIED: `@langchain/langgraph/dist/index.d.ts:45`]

`Send` 和 `interrupt` 均在 `@langchain/langgraph` 的主导出中。直接扩展现有 import 即可：

```typescript
// graph-builder.ts（当前）
import { StateGraph, START, END } from '@langchain/langgraph';

// Phase 15 添加 Send 后（无兼容性问题）
import { StateGraph, START, END, Send } from '@langchain/langgraph';

// Phase 14 添加 interrupt 后（路径 B 方案）
import { StateGraph, START, END, interrupt } from '@langchain/langgraph';
```

版本约束方面：deepagents 依赖 `"@langchain/langgraph": "^1.3.0"`，CDF 安装 1.3.6，Send 类和 interrupt 函数自 LangGraph 1.x 起均已稳定导出，无版本兼容问题。

### 4.4 deepagents SDK 与 LangGraph 的关系

deepagents SDK 是 `createDeepAgent` 层面的封装，它**内部**使用 LangGraph 构建 Agent 执行图（ReAct 循环、subagent 委派、middleware 链）。但 CDF 的 Workflow 图（`StateGraph`）是由 `graph-builder.ts` 用 LangGraph 原生 API 构建的，deepagents SDK 并不介入图结构层面。

两者的关系是：**deepagents 是 LangGraph 的上层封装，专注于 Agent 层；CDF Workflow 图结构层直接使用 LangGraph，deepagents 只在节点执行器内部使用。**

---

## 5. 后续 Phase 技术路径推荐表

| Phase | 目标 | 技术方案 | 关键 API | 文件 |
|-------|------|---------|---------|------|
| **Phase 13** | Workflow 路由机制修复 | 继续使用 LangGraph `addConditionalEdges` + 改进 JSON 解析（结构化输出代替正则） | `addConditionalEdges`、LangGraph structured output | `graph-builder.ts`、`node-executor.ts` |
| **Phase 14** | 审批机制统一设计（HITL） | **路径 A（首选）**：`node-executor.ts` 的 `createDeepAgent` 加 `interruptOn` 配置，复用现有 Chat 路径审批 UI 和 IPC 流程；**路径 B（补充）**：`graph-builder.ts` 中 Review 节点用 `interrupt()` 实现节点级人工确认 | `createDeepAgent({ interruptOn })` / `interrupt()` from `@langchain/langgraph` | `node-executor.ts`（路径 A）、`graph-builder.ts`（路径 B） |
| **Phase 15** | 并行 Agent 执行（fan-out/fan-in） | 直接从 `@langchain/langgraph` 导入 `Send`，在 `addConditionalEdges` 路由函数中返回 `Send[]` 实现动态 fan-out；`WorkflowState.nodeOutputs` 的 spread-merge reducer 已是并行安全，无需修改 schema | `new Send(nodeName, args)` from `@langchain/langgraph`；`addConditionalEdges(source, () => Send[])` | `graph-builder.ts`（新增 fan-out 路由函数） |
| **Phase 16** | 基础设施统一 + 可观测性 | 统一 Chat/Workflow 两条路径的工具集（`builtInTools`）；新增 subagent trace 透传机制；按照现有 step 事件格式扩展可观测性 | 无新 SDK，重构现有代码 | `runtime.ts`、`node-executor.ts`、`workflow-runtime.ts` |

---

## 6. 验证结论汇总

| # | 假设 | 验证结论 | 代码路径 |
|---|------|---------|---------|
| T1 | deepagents SDK 暴露 Send API | **SDK 不导出 Send**，但 LangGraph 直接导出，graph-builder.ts 可直接 import | [VERIFIED: `@langchain/langgraph/dist/constants.d.ts:81`] |
| T1b | Send 在 CDF 版本中可用 | **完全可用**，LangGraph 1.3.6 稳定导出 `Send` 类 | [VERIFIED: `@langchain/langgraph/dist/index.d.ts:45`] |
| T1c | WorkflowState 支持 fan-out 并行合并 | **已支持**，`nodeOutputs` 的 spread-merge reducer 是并行安全的 | [VERIFIED: `src/main/workflow/state-schema.ts`] |
| T2 | interrupt() 在 CDF 版本中可用 | **完全可用**，LangGraph 1.3.6 稳定导出 `interrupt` | [VERIFIED: `@langchain/langgraph/dist/interrupt.d.ts:45`] |
| T2b | deepagents SDK 的 interruptOn 封装 interrupt | **是**，通过 `humanInTheLoopMiddleware` 封装 | [VERIFIED: `langchain/dist/agents/middleware/hitl.d.ts:515`] |
| T2c | Chat 路径已有 HITL 实现 | **已实现**，`DEFAULT_INTERRUPT_ON` 配置 6 个工具审批 | [VERIFIED: `src/main/deepagent/runtime.ts:55-81`] |
| T2d | Workflow 路径缺少 interruptOn | **确认缺失**，node-executor.ts 的 createDeepAgent 无 interruptOn 参数 | [VERIFIED: `src/main/workflow/node-executor.ts:361-368`] |
| T3 | 绕过 SDK 直接使用 LangGraph 可行 | **已有先例**，graph-builder.ts 已直接 import LangGraph | [VERIFIED: `src/main/workflow/graph-builder.ts:9`] |

---

## 7. 风险与注意事项

1. **interrupt() 需要 checkpointer**：`interrupt()` 调用会抛出 `GraphInterrupt`，LangGraph 将当前状态保存到 checkpointer 后暂停。Workflow 路径的 `builder.compile({ checkpointer })` 已有此配置（`workflow-runtime.ts:316`），满足条件。

2. **Send fan-out 需要 worker 节点预注册**：Send 的目标节点名称必须在 `addNode` 时已经注册。动态运行时决定目标节点数量没有问题（Send 数组长度可动态），但节点名称必须静态。

3. **Workflow 路径 HITL resume 需要新增 IPC**：目前 `workflow-runtime.ts` 的执行循环没有处理 `GraphInterrupt` 的逻辑，添加 interruptOn 后需要新增 `workflow:approve` IPC handler 来传递 `Command({ resume })` 恢复执行。这是 Phase 14 的核心工作。

4. **子 Agent interruptOn 配置**：`runtime.ts` 中子 Agent 已显式设置 `interruptOn: {}` 以避免不触发审批（`REPAIR-03`）。Workflow 路径的节点 Agent 添加 interruptOn 时需要考虑这个设计决策是否适用，或是否需要可配置的审批级别。
