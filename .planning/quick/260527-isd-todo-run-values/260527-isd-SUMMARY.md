---
phase: quick
plan: 260527-isd-todo-run-values
subsystem: llm
tags: [run.values, todos, event-driven, langgraph]

requires: []
provides:
  - "run.values event-driven todos push replacing 500ms polling"
affects: [llm, todos, deepagent]

tech-stack:
  added: []
  patterns: ["abort-aware async iteration via Promise.race"]

key-files:
  created: []
  modified:
    - path: "src/main/llm.ts"
      description: "Replaced startTodoPolling with run.values event-driven consumption"
    - path: "src/main/llm.test.ts"
      description: "Added 4 tests for run.values behavior"

key-decisions:
  - "Used Promise.race with waitForAbort for abort-aware iteration instead of simple for-await-of (generator may hang on internal await, blocking abort detection)"
  - "Kept checkAndSendTodos as fallback for boundary scenarios where run.values may not cover todos changes"

patterns-established:
  - "Abort-aware async iteration: Promise.race(iter.next(), abortPromise) pattern for streams that may hang"

requirements-completed: []

duration: 4min
completed: 2026-05-27
---

# Quick Task 260527-isd: Todo Run Values Summary

**500ms todo 轮询替换为 run.values 事件驱动推送，消除轮询开销并实现即时 todos 更新**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-27T05:33:58Z
- **Completed:** 2026-05-27T05:38:18Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- 移除 `startTodoPolling` 函数及所有轮询代码（500ms setInterval）
- 添加 `valuesStreamPromise` 消费 `run.values` 流，检测 todos 变化并即时推送 IPC
- 使用 abort-aware 迭代（Promise.race + waitForAbort）确保中断时正确终止
- 保留 `checkAndSendTodos` 作为兜底机制

## Task Commits

Each task was committed atomically:

1. **Task 1: RED - failing tests** - `b530fb7` (test)
2. **Task 1: GREEN - implementation** - `24aa12b` (feat)

## Files Created/Modified
- `src/main/llm.ts` - 移除 startTodoPolling，添加 run.values 消费逻辑
- `src/main/llm.test.ts` - 新增 4 个 run.values 相关测试用例

## Decisions Made
- 使用 `Promise.race(iter.next(), abortPromise)` 模式实现 abort-aware 迭代，因为 generator 内部 await 可能导致 for-await-of 无法响应 abort 信号
- 保留 `checkAndSendTodos` 作为兜底，覆盖 run.values 未触及的边界场景

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added async-iterator guard for run.values**
- **Found during:** Task 1 (implementation)
- **Issue:** 现有测试的 mock 没有 `run.values` 属性，`for await (const values of undefined)` 抛出 TypeError
- **Fix:** 添加 `if (!run.values || typeof run.values[Symbol.asyncIterator] !== 'function') return` 防护
- **Files modified:** src/main/llm.ts
- **Verification:** 所有 18 个测试通过
- **Committed in:** 24aa12b

**2. [Rule 1 - Bug] Abort-aware iteration for hung generators**
- **Found during:** Task 1 (implementation)
- **Issue:** 简单 `for await` 在 generator 内部 await 挂起时无法响应 abort 信号，导致测试超时
- **Fix:** 使用 `Promise.race(iter.next(), abortPromise)` 模式替代 `for await`
- **Files modified:** src/main/llm.ts
- **Verification:** abort 测试通过
- **Committed in:** 24aa12b

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** 两个修复都是正确性必需。无范围蔓延。

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
run.values 事件驱动推送已完成，todos 更新延迟从 500ms 降至即时推送。

---
*Phase: quick*
*Completed: 2026-05-27*

## Self-Check: PASSED
- FOUND: src/main/llm.ts
- FOUND: src/main/llm.test.ts
- FOUND: SUMMARY.md
- FOUND: b530fb7 (test commit)
- FOUND: 24aa12b (feat commit)
