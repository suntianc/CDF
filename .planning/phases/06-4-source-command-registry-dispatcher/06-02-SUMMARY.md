---
phase: 06-4-source-command-registry-dispatcher
plan: 02
subsystem: renderer-dispatcher-ipc-ui
provides:
  - 4-kind command dispatcher with useProjectStore.getState().currentProjectId (BLOCKER 1 fix)
  - useCommandRegistry hook (IPC consumer + sonner toasts + chokidar push subscription)
  - SlashCommandPopup extended with source badge + mcp_health_warning row
  - ChatArea handleSlashSelect routed through dispatcher.resolve + dispatch
  - 2 new IPC channels: commands:list + commands:readProjectCommands
  - chokidar double-watch: watchSystemCommandsDir (in app.whenReady) + watchProjectCommandsDir (lazy on first commands:list)
  - preload bridge: electronAPI.commands.{list, readProjectCommands, onChanged}
generated_files:
  - src/main/commands/chokidar-watcher.ts (NEW; 119 lines)
  - src/main/commands/chokidar-watcher.test.ts (NEW; 11 tests)
  - src/main/ipc-handlers.ts (MOD; +33 lines for 2 IPC handlers)
  - src/main/index.ts (MOD; +16 lines for system watcher init)
  - src/preload/index.ts (MOD; +14 lines for commands bridge)
  - src/shared/types.ts (MOD; +11 lines for ElectronAPI.commands namespace)
  - src/renderer/src/lib/commands/system-commands.ts (NEW; 33 lines)
  - src/renderer/src/lib/commands/dispatcher.ts (NEW; 110 lines)
  - src/renderer/src/lib/commands/dispatcher.test.ts (NEW; 14 tests)
  - src/renderer/src/hooks/useCommandRegistry.ts (NEW; 95 lines)
  - src/renderer/src/hooks/useCommandRegistry.test.ts (NEW; 4 tests)
  - src/renderer/src/components/SlashCommand/SlashCommandPopup.tsx (MOD; +50/-25 lines for source badge + warning row)
  - src/renderer/src/components/ChatArea/ChatArea.tsx (MOD; +20 lines for registry hook + dispatcher routing)
  - src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx (MOD; +12 Phase 6 popup tests + 2 light integration tests; 1 Phase 5 test query updated to regex matcher)
---

# Plan 06-02 Summary

## Tasks Executed

- **Task 1: chokidar watcher + IPC + preload bridge** ✅ committed
- **Task 2: dispatcher.ts + useCommandRegistry + system-commands** ✅ committed
- **Task 3: Extend SlashCommandPopup with source badge + mcp_health_warning** ✅ committed
- **Task 4: Wire ChatArea handleSlashSelect + verify Phase 6 integration** ✅ committed

## Test Results

| Test file | Count | Status |
|---|---|---|
| `src/renderer/src/lib/commands/dispatcher.test.ts` | 14 | ✅ all green |
| `src/renderer/src/hooks/useCommandRegistry.test.ts` | 4 | ✅ all green |
| `src/renderer/src/components/ChatArea/SlashCommandPopup.test.tsx` | 33 | ✅ all green (19 P5 + 12 P6 + 2 light integration) |
| `src/main/commands/chokidar-watcher.test.ts` | 11 | ✅ all green |

**Phase 6 cumulative test counts** (Plan 06-01 + 06-02):
- src/main/commands/ (collectors + registry + conflict + chokidar): 88 tests
- src/renderer/src/lib/commands/ (dispatcher): 14 tests
- src/renderer/src/hooks/ (useCommandRegistry): 4 tests
- src/renderer/src/components/ChatArea/ (SlashCommandPopup): 33 tests
- **Total Phase 6: 139 tests passing**
- 2 pre-existing failures (skill-manager.test.ts + file-tools.test.ts) carried from v1.0 — NOT caused by Phase 6.

## Deviations from plan

1. **EventEmitter hoisting fix** (chokidar-watcher.test.ts): Plan's reference implementation used `import { EventEmitter } from 'events'` + `vi.hoisted`. The vitest module-hoister threw `Cannot access '__vi_import_0__' before initialization`. Replaced with a plain class implementing only the needed methods (`on`/`emit`/`removeAllListeners`/`close`).
2. **Idempotency test logic** (chokidar-watcher.test.ts): Plan's test called `watchProjectCommandsDir` (which does NOT set module-scope `currentProjectPath`) then `ensureProjectWatcher` and expected no duplicate. But `currentProjectPath` only gets set by `ensureProjectWatcher`, so the first `ensureProjectWatcher` after `watchProjectCommandsDir` legitimately starts a new watcher. Fixed by removing the pre-`watchProjectCommandsDir` call — the test now correctly verifies that 2 consecutive `ensureProjectWatcher('/idem/path')` calls produce only 1 watcher.
3. **Phase 5 test query** (SlashCommandPopup.test.tsx): The "double slash filter does not crash" test used `screen.getByText('/goal')` which broke when rows became `<Badge> + <span>`. Updated to `getAllByText(/^\/goal$/)` regex matcher. All 18 other Phase 5 tests pass unchanged.
4. **ChatArea onSelect contract**: Plan said pass `c.name` (no slash). Kept Phase 5 contract by passing `/${name}` from both `onSelect` and `handleKeyDown` paths.
5. **filterCommands slash match**: To preserve Phase 5 "//" filter behavior, filter now matches both `name` and `/${name}` substring (PITFALLS P6c compatibility).

## Hard Do Not Touch respected

- `runtime.ts` — not modified
- `llm.ts:306-425` — not modified (consumed `llm.ts:324` extension point via `payload.overrides.planOnly`)
- `workflow-runtime.ts` — not modified
- `LLMStreamEvent` union — not modified (PluginRewrite emits existing `sendMessage` event types)
- 6-hunk patch-package on `@langchain/anthropic@1.4.0` — not modified

## Phase 6 Scope Discipline

Per 客人大人 2026-06-04 decision:
- ❌ NO seed `/pr-review` demo workflow (CANCELLED in discuss-phase)
- ❌ NO args parser (Phase 7)
- ❌ NO 3 system command UI/feedback (Phase 7)
- ❌ NO 7-color source badge (Phase 8 polish)
- ❌ NO chokidar failure toast (Phase 8 polish — D-24: log only)
- ✅ Phase 5 known stub (handleKeyDown shiftKey check) — preserved, NOT added

## Next Phase (Phase 7)

Phase 7 will implement:
- `/goal` placeholder bubble + `sessionGoals` Map write
- `/context` placeholder bubble + token aggregation from `messages` table
- `/plan` `payload.overrides.planOnly` runtime flag verification
- SLASH-REGRESSION it block in `llm-adapter.test.ts` (6-hunk patch-package护栏)
- args parser for `/goal X` and `/plan X` semantics
