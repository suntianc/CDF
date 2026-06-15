---
phase: "10"
plan: "01"
subsystem: deepagent-runtime
tags: [bugfix, subagent, interrupt, approval]
dependency_graph:
  requires: []
  provides: [REPAIR-03-subagent-no-interrupt]
  affects: [src/main/deepagent/runtime.ts]
tech_stack:
  added: []
  patterns: [interruptOn-per-agent-scope]
key_files:
  modified:
    - src/main/deepagent/runtime.ts
decisions:
  - "在 subagents.push 对象内设置 interruptOn: {} 而非修改 DEFAULT_INTERRUPT_ON，保持主 Agent 审批流不变"
metrics:
  duration: "5 minutes"
  completed: "2026-06-15"
  tasks_completed: 1
  tasks_total: 1
---

# Phase 10 Plan 01: 子 Agent 工具调用审批中断修复 Summary

## One-liner

在 subagents.push 对象中添加 `interruptOn: {}`，覆盖父层继承，子 Agent 工具调用不再触发审批挂起

## What Was Built

修复 deepagents SDK 将顶层 `createDeepAgent` 的 `interruptOn` 策略传播到子 Agent 层导致任务永久挂起的问题。

根因：子 Agent（如 ReactBuilder、Code Reviewer）调用 `write_file`/`edit_file` 时，继承了主 Agent 的 `DEFAULT_INTERRUPT_ON` 配置，导致工具调用进入 `waiting_approval` 状态，父 run 挂起等待用户审批，任务无法完成。

修复：在 `runtime.ts` line 613 的 `subagents.push({})` 对象中，于 `middleware` 字段之后添加 `interruptOn: {}`，空对象覆盖继承的审批策略，子 Agent 工具调用直接执行不中断。

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | 移除子 Agent 的 interruptOn 继承 | e4da1fd | src/main/deepagent/runtime.ts |

## Verification

- `grep -n "interruptOn" runtime.ts` 输出 3 处：DEFAULT_INTERRUPT_ON 定义（line 55）、subagents.push 中的 `interruptOn: {}`（line 613）、createDeepAgent 调用中的 `interruptOn: DEFAULT_INTERRUPT_ON`（line 630）
- pnpm test: 540/540 通过（65 个测试文件）

## Deviations from Plan

None - 计划执行完全按预期进行。

## Known Stubs

None.

## Threat Flags

None - 修改仅收窄子 Agent 审批范围，符合 T-10-01 的 accept 处置。

## Self-Check: PASSED

- [x] src/main/deepagent/runtime.ts 已修改且包含 `interruptOn: {}`
- [x] 提交 e4da1fd 存在
- [x] createDeepAgent 调用中仍保留 `interruptOn: DEFAULT_INTERRUPT_ON`
- [x] pnpm test 540/540 通过
