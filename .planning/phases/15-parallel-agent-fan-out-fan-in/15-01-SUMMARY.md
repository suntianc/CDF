---
phase: 15-parallel-agent-fan-out-fan-in
plan: "01"
subsystem: workflow-engine
tags:
  - langgraph
  - send-api
  - parallel
  - fan-out
  - fan-in
dependency_graph:
  requires:
    - "12-01: SDK 能力探针确认 Send API 可用"
    - "@langchain/langgraph Send 类"
  provides:
    - "parallel 节点类型（dispatcher + worker）"
    - "createFanOutRouter 辅助函数"
    - "nodeOutputs spread-merge fan-in（无需额外逻辑）"
  affects:
    - "src/shared/types.ts — WorkflowNodeType, WorkflowAgentNodeKind 扩展"
    - "src/main/workflow/graph-builder.ts — buildWorkflowGraph parallel 分支"
    - "src/main/workflow/node-executor.ts — createAgentNodeExecutor parallel 分支"
tech_stack:
  added: []
  patterns:
    - "LangGraph Send API fan-out: dispatcher node → addConditionalEdges 返回 Send[] → worker nodes 并行执行"
    - "fan-in 通过已有 nodeOutputs spread-merge reducer 自动完成，无需额外聚合节点"
    - "worker output key: `${nodeId}__worker:${index}` 保证并行写入不互相覆盖"
key_files:
  created: []
  modified:
    - src/shared/types.ts
    - src/main/workflow/graph-builder.ts
    - src/main/workflow/node-executor.ts
    - src/main/workflow/graph-builder.test.ts
decisions:
  - "parallel 节点分为 dispatcher（读取 items）和 worker（执行单 item）两个 LangGraph node，通过 state.__fanout_item 区分角色"
  - "worker output key 格式 `${nodeId}__worker:${index}` 而非 `${nodeId}` 避免并行写入竞争"
  - "concurrencyLimit 默认值 50（MAX_PARALLEL_ITEMS）与 MAX_LOOP_NODE_ITERATIONS 对齐，T-15-02 DoS 防护"
  - "parallel worker 豁免 invokeAgent 超时检查，与 foreach 保持一致"
  - "dataSource 不存在时从上游 nodeOutputs 寻找 items/results 数组（fallback 策略）"
metrics:
  duration: "~5 分钟"
  completed: "2026-06-20"
  tasks_completed: 2
  files_modified: 4
---

# Phase 15 Plan 01: 并行 Agent Fan-Out/Fan-In 实现 Summary

基于 LangGraph Send API 为 CDF Workflow 引擎实现 parallel 节点类型，支持真正的并行 fan-out 执行和自动 fan-in 聚合。

## What Was Built

**parallel 节点**（`type='parallel'`, `nodeKind='parallel'`）通过 LangGraph Send API 实现动态 fan-out：

1. **dispatcher node**（注册为 `node.id`）：执行 nodeExecutor 读取 items 数据（从 `dataSource` 文件或上游 nodeOutputs），将 `{ items, count }` 写入 `nodeOutputs[node.id]`
2. **fan-out router**（`createFanOutRouter`）：读取 `nodeOutputs[node.id].items`，为每个 item 返回 `new Send(workerNodeId, { ...state, __fanout_item, __fanout_index, __fanout_total })`
3. **worker node**（注册为 `${node.id}__worker`）：从 Send args（注入到 state）读取 `__fanout_item`，执行 agent，输出写入 `nodeOutputs[${nodeId}__worker:${index}]`
4. **fan-in**：由 `WorkflowState.nodeOutputs` 的 spread-merge reducer 自动完成，无需额外逻辑

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| Task 1 | 扩展类型定义 + graph-builder Send fan-out 实现 | e3d4ce2 |
| Task 2 | node-executor parallel worker 支持 + fan-out 单元测试 | 0337bba |
| Fix | parallel worker 豁免超时检查 | 1d1948e |

## Verification Results

```
Tests:  16 passed (16)
- 10 existing tests: all passing (no regression)
- 3 createFanOutRouter unit tests
- 3 buildWorkflowGraph parallel integration tests
```

**Acceptance Criteria:**
- grep -c "'parallel'" src/shared/types.ts: **2** (WorkflowNodeType + WorkflowAgentNodeKind) ✓
- grep -c "Send" src/main/workflow/graph-builder.ts: **9** (>=3) ✓
- grep -c "parallel" src/main/workflow/node-executor.ts: **3** (>=3) ✓
- createFanOutRouter 已导出 ✓
- TypeScript: 无新增错误（预先存在的 ProviderRow.context_limit 等错误不属于本 plan 范围）

## Deviations from Plan

**1. [Rule 2 - Missing Critical Functionality] parallel worker 豁免超时检查**
- **Found during:** Task 2 实现 worker 执行逻辑时
- **Issue:** `invokeAgent` 的超时检查 `nodeKind !== 'foreach'` 未包含 `parallel`，导致 worker 执行 item 时若耗时超过 DEFAULT_TIMEOUT_MS 会意外超时
- **Fix:** 将检查扩展为 `nodeKind !== 'foreach' && nodeKind !== 'parallel'`
- **Files modified:** `src/main/workflow/node-executor.ts`
- **Commit:** 1d1948e

## Known Stubs

无。所有实现均使用真实逻辑，无 placeholder 或 hardcoded empty 值。

## Threat Flags

无新增威胁面。本 plan 的 T-15-01 和 T-15-02 均已按计划缓解：
- T-15-01: `__fanout_item` 和 `__fanout_index` 使用双下划线前缀保留命名空间
- T-15-02: MAX_PARALLEL_ITEMS=50 限制 items 数组并发上限

## Self-Check: PASSED

- `src/shared/types.ts`: 包含 'parallel' ✓
- `src/main/workflow/graph-builder.ts`: 包含 Send 导入和 createFanOutRouter ✓
- `src/main/workflow/node-executor.ts`: 包含 parallel nodeKind 分支 ✓
- `src/main/workflow/graph-builder.test.ts`: 新增 6 个测试，全部通过 ✓
- Commits e3d4ce2, 0337bba, 1d1948e 均存在于 git history ✓
