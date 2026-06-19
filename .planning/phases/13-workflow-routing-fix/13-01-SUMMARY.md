---
phase: 13-workflow-routing-fix
plan: "01"
status: complete
started: 2026-06-19T08:39:00Z
completed: 2026-06-19T08:41:00Z
---

## Summary

修复 `createConditionalRouter` 的静默 fallback 行为：路由决策缺失时从 `console.warn` + 返回 `__default__` 改为抛出明确错误，触发 LangGraph `retryPolicy`。保持"决策存在但不匹配"场景的 `__default__` fallback 并增强 warn 日志。

## Changes

### src/main/workflow/graph-builder.ts
- 路由决策缺失（`undefined`/`null`/`''`）时抛出 `Error`，错误消息包含条件名和当前 routing 状态
- routeMatchers 不匹配时保留 `__default__` fallback，新增 warn 日志输出已配置的匹配值列表

### src/main/workflow/graph-builder.test.ts
- 新增测试 "should throw when routing decision is completely missing for a conditional edge"
- 新增测试 "should fallback to END with warning when routing decision exists but does not match any configured edge"

## Self-Check: PASSED

- [x] graph-builder.test.ts: 10/10 tests passed
- [x] node-executor.test.ts: 12/12 tests passed
- [x] 现有测试无回退

## Key Files

### key-files.created
- src/main/workflow/graph-builder.test.ts (新增 2 个测试)

### key-files.modified
- src/main/workflow/graph-builder.ts (createConditionalRouter 行为变更)

## Deviations

None
