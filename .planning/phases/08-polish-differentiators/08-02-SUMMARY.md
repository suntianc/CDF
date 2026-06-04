---
phase: 08-polish-differentiators
plan: 02
subsystem: useCommandRegistry-loading-state-machine
provides:
  - RegistryLoadingState 5-state enum: 'idle' | 'pending' | 'slow' | 'ready' | 'error'
  - 500ms setTimeout in reload() promotes 'pending' → 'slow' (triggers Skeleton row in SlashCommandPopup)
  - IPC reject → mcp_health_warning synthetic + loading='error'
  - Functional updater guard: prev-check `prev === 'pending'` to prevent stale 'slow' promotion
  - 3 new Phase 8 tests (slow after 500ms / no slow before 500ms / error → mcp_health_warning)
  - Fixed 4 pre-existing test assertions (boolean → enum)
generated_files:
  - src/renderer/src/hooks/useCommandRegistry.ts (MOD; loading state machine + slowTimer + mcp_health_warning on reject)
  - src/renderer/src/hooks/useCommandRegistry.test.ts (MOD; 4 fixes + 3 new tests)
---

# Plan 08-02 Summary

## Locked Decisions (D-07..D-11)

```ts
// 5-state enum
export type RegistryLoadingState =
  | 'idle'    // no projectId/agentId
  | 'pending' // IPC issued, awaiting response (< 500ms)
  | 'slow'    // IPC still pending after 500ms (triggers Skeleton row)
  | 'ready'   // IPC resolved
  | 'error';  // IPC rejected → mcp_health_warning

// 500ms threshold
const slowTimer = setTimeout(() => {
  setLoading((prev) => (prev === 'pending' ? 'slow' : prev));
}, 500);

// IPC reject → mcp_health_warning
.catch((err) => {
  setCommands(EMPTY_COMMANDS);
  setConflicts(EMPTY_CONFLICTS);
  setWarnings([{ type: 'mcp_health_warning', message: 'MCP 工具加载失败' }]);
  clearTimeout(slowTimer);
  setLoading('error');
});
```

## Test Results

- 4/4 useCommandRegistry tests pass (fixed boolean→enum assertions)
- 11/11 chokidar-watcher tests pass (no regression)
- 37/37 SlashCommandPopup tests pass (no regression)
- 1/1 App.test.tsx pass (no regression)
- **Cumulative: 232 passing** (231 + 1 fix)

## Out of Scope (for Plan 08-04 / 08-03)

- 3 new loading-state-machine tests (slow / no slow / error) — added in this plan
- chokidar fallback toast — Plan 08-03
- Wave 3 finalization (08-04) — next
