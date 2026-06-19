---
phase: 13-workflow-routing-fix
plan: "02"
status: complete
started: 2026-06-19T08:42:00Z
completed: 2026-06-19T08:44:00Z
---

## Summary

为 review 节点的 createDeepAgent 调用添加 responseFormat 参数，使用 Zod schema + toolStrategy 强制 LLM 输出结构化路由决策 JSON，彻底绕过 extractWorkflowRouting 文本正则解析。简化 review 节点 prompt（不再要求 LLM 手动嵌入 JSON）。task/loop/foreach 节点保持现有行为不变。

## Changes

### src/main/workflow/node-executor.ts
- 新增 `import { z } from 'zod'` 和 `import { toolStrategy } from 'langchain'`
- 定义 `reviewRoutingSchema`（routing + reasoning 字段）
- review 节点 createDeepAgent 调用传入 `responseFormat: toolStrategy(reviewRoutingSchema)`
- review 节点 prompt 简化——移除 JSON 嵌入要求，改为"系统自动收集路由决策"
- 通用路由 JSON 提示仅对非 review 节点显示
- review 节点独立执行分支：从 `result.structuredResponse` 取路由
- structuredResponse 为 null 时 fallback 到 extractWorkflowRouting 并输出 warn

### src/main/workflow/node-executor.test.ts
- 新增 toolStrategyMock 和 `vi.mock('langchain')`
- 修复 resolveAgentSkillsConfigMock 返回值包含 `permissions: []`
- 新增测试 "should use responseFormat with toolStrategy for review nodes"
- 新增测试 "should fallback to extractWorkflowRouting when review node structuredResponse is null"
- 新增测试 "should not pass responseFormat for non-review nodes"

## Self-Check: PASSED

- [x] node-executor.test.ts: 15/15 tests passed
- [x] graph-builder.test.ts: 10/10 tests passed
- [x] 全部 25 个工作流测试通过

## Key Files

### key-files.created
- src/main/workflow/node-executor.test.ts (新增 3 个测试)

### key-files.modified
- src/main/workflow/node-executor.ts (review 节点 responseFormat 分支)

## Deviations

None
