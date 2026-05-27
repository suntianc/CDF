---
phase: quick-todolist-fix
plan: 01
subsystem: ui
tags: [zustand, sessionStore, todos, streaming, state-management]

requires: []
provides:
  - "sendMessage clears todos at entry, preventing stale todo flash on new round"
affects: [chat-area, todolist-panel]

tech-stack:
  added: []
  patterns: ["Defensive state reset at function entry point"]

key-files:
  created: []
  modified:
    - src/renderer/src/stores/sessionStore.ts

key-decisions:
  - "Defensive set({ todos: [] }) before cache operations rather than only relying on initialState.todos = []"

patterns-established:
  - "Clear derived state at entry point before cache/async operations to prevent race conditions"

requirements-completed: []

duration: 1min
completed: 2026-05-27
---

# Quick Task 260527-j8h: TodoList Cross-Round Fix Summary

**sendMessage clears todos at function entry via set({ todos: [] }) to prevent stale data flash when user starts a new round**

## Performance

- **Duration:** 1 min
- **Started:** 2026-05-27T06:03:50Z
- **Completed:** 2026-05-27T06:04:39Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added defensive `set({ todos: [] })` at `sendMessage` entry after the guard check
- Prevents stale todos from previous rounds flashing in the UI before new `todos_update` events arrive
- `initialState.todos` remains `[]` for cache consistency

## Task Commits

1. **Task 1: Clear todos at sendMessage start** - `93aa00a` (fix)

## Files Created/Modified
- `src/renderer/src/stores/sessionStore.ts` - Added `set({ todos: [] })` after guard check in `sendMessage`

## Decisions Made
- Placed `set({ todos: [] })` before cache operations and before `activeSession` lookup to ensure earliest possible state reset
- Did not modify `fetchAgentActivity`, `selectSession`, or `ChatArea.tsx` per plan constraints

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

---

*Quick task: 260527-j8h*
*Completed: 2026-05-27*
