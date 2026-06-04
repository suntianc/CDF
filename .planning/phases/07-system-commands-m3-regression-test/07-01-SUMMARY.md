---
phase: 07-system-commands-m3-regression-test
plan: 01
subsystem: system-commands-data-and-dispatcher-impl
provides:
  - useSessionStore.sessionGoals: Map<sessionId, string> + setSessionGoal action
  - context-aggregator.ts: token breakdown calculator (conversation + skills + mcp + workflows)
  - IPC context:currentSession channel (main → renderer breakdown fetch)
  - 3 integration gap fixes: ChatPayload.overrides → ChatRuntimeOverrides, RuntimeModelOverrides → ChatRuntimeOverrides, runtime.ts isPlanMode gate
  - dispatcher.ts: 3 real implementations (SystemSilent/SystemLocal/PlanMode — replaces console.log placeholders)
generated_files:
  - src/renderer/src/stores/sessionStore.ts (MOD; +14 lines for sessionGoals field + setSessionGoal action)
  - src/renderer/src/stores/sessionStore.test.ts (MOD; +70 lines for 3 sessionGoals tests)
  - src/main/deepagent/context-aggregator.ts (NEW; 152 lines)
  - src/main/context-aggregator.test.ts (NEW; 169 lines, 4-5 tests)
  - src/main/ipc-handlers.ts (MOD; +11 lines for context:currentSession handler)
  - src/preload/index.ts (MOD; +5 lines for context namespace)
  - src/shared/types.ts (MOD; +7 lines for ElectronAPI.context + ContextBreakdown)
  - src/main/llm.ts (MOD; lines 7-11 imports + lines 32-44 ChatPayload type — only type chain, not runLLMChat/streamEvents body)
  - src/main/deepagent/runtime.ts (MOD; lines 1-25 imports + lines 43-46 type alias + line 488 builtInTools + line 599 interruptOn)
  - src/renderer/src/lib/commands/dispatcher.ts (MOD; +68/-27 lines for 3 real dispatch branches)
  - src/renderer/src/lib/commands/dispatcher.test.ts (MOD; +76 lines for 3 real-impl tests)
---

# Plan 07-01 Summary

## Tasks Executed

- **Task 1: sessionGoals Map + setSessionGoal action** ✅ committed (de1912e)
- **Task 2: /context IPC + context-aggregator + preload bridge** ✅ committed (01d5903)
- **Task 3: Close 3 integration gaps (ChatPayload.overrides / RuntimeModelOverrides / runtime.ts planOnly consumption)** ✅ committed (958d712)
- **Task 4: Wire 3 real dispatcher implementations (replaces console.log placeholders)** ✅ committed (ee2a1d0)

## Locked Decisions Implemented

### /goal SystemSilent (D-01..D-05)
- D-01: `[system] 正在执行 /goal…` placeholder text
- D-02: args = inputVal.slice(`/${name}`.length).trim()
- D-03: write happens immediately, no async
- D-04: sessionGoals Map persists across session switches (not cleared)
- D-05: in-memory only (SLASH-15 SQLite persistence → v1.2)

### /context SystemLocal (D-06..D-09)
- D-06: `/context` and `/context [all]` return same current-session scope
- D-07: breakdown shows conversation / skills / mcp / workflows tokens + total
- D-08: new IPC channel `context:currentSession(sessionId) → { breakdown, total }`
- D-09: token estimation = `String.length * 0.25` rough heuristic (gpt-tokenizer → v1.2)

### /plan PlanMode (D-10..D-13)
- D-10: `[plan]` marker bubble (different from /goal)
- D-11: placeholder = `[plan] 进入 plan 模式：${X || '(无描述)'}`
- D-12: dispatcher passes `{ planOnly: true }` to sendMessage
- D-13: runtime strips `bash` / `delete_file` from `builtInTools` + sets `interruptOn: false` to suppress `write_file` / `edit_file` in plan mode

### 3 Integration Gap Fixes (from RESEARCH §2)
- **Gap 1**: `src/main/llm.ts:32-44` `ChatPayload` type — original `{ providerId, model }` was too narrow; added optional `overrides?: ChatRuntimeOverrides` field so `planOnly: true` flows through
- **Gap 2**: `src/main/deepagent/runtime.ts:43-46` `RuntimeModelOverrides` was a local type — aliased to `ChatRuntimeOverrides` to share the same type chain
- **Gap 3**: `src/main/deepagent/runtime.ts:488+599` — `builtInTools` + `interruptOn` now branch on `isPlanMode` (computed from `overrides?.planOnly`) to strip bash/delete_file and set `interruptOn: false`

### 3 Real Dispatcher Implementations (replaces console.log placeholders)
- **SystemSilent**: `setSessionGoal(activeSessionId, args)` + `toast.info('[system] 正在执行 /goal…')`
- **SystemLocal**: `electronAPI.context.currentSession(activeSessionId)` + breakdown toast
- **PlanMode**: `[plan]` toast + `sendMessage(projectId, args, { planOnly: true })`

## Test Counts

| Test file | Count | Status |
|---|---|---|
| `src/renderer/src/stores/sessionStore.test.ts` (new tests) | 3 | ✅ all green (write / overwrite / cross-session persistence) |
| `src/main/context-aggregator.test.ts` (NEW) | 5 | ✅ all green (conversation / skills / mcp / workflows / total) |
| `src/renderer/src/lib/commands/dispatcher.test.ts` (new tests) | 3 | ✅ all green (SystemSilent / SystemLocal / PlanMode real impls) |

**Total new tests: 11**
**Cumulative Phase 6 + 7 tests: 150 passing** (139 Phase 6 + 11 Phase 7-01; pre-existing v1.0 failures unchanged)

## Hard "Do Not Touch" verified intact

- `src/main/runtime.ts` — only `imports` (1-25) + `type alias` (43-46) + `builtInTools` (488) + `interruptOn` (599) modified; rest untouched
- `src/main/llm.ts:306-425` — only `imports` (7-11) + `ChatPayload` type (32-44) modified; `runLLMChat` + `streamEvents` v3 body unchanged
- `src/main/workflow-runtime.ts` — not modified
- `LLMStreamEvent` union — not modified
- 6-hunk patch-package on `@langchain/anthropic@1.4.0` — not modified (SLASH-REGRESSION it 7.1 in 07-02 verifies)

## Deferred to Phase 7 Plan 02

- 5-line sniff in ChatArea.handleSend (D-14) — Plan 07-02
- handleSend 3 D-15 test cases — Plan 07-02
- SLASH-REGRESSION 3 it blocks (it 7.1 / 7.2 / 7.3) — Plan 07-02

## Phase 7 Scope Discipline

Per 客人大人 2026-06-04 decisions:
- ❌ NO args parser (D-02 passthrough only)
- ❌ NO 7-color source badge (Phase 8 polish)
- ❌ NO chokidar failure toast (Phase 8 polish)
- ❌ NO 3 system command 7 色彩色气泡（Phase 8）
- ✅ Phase 5 known stub (handleKeyDown shiftKey) preserved
- ✅ Phase 6 dispatcher routing preserved (Tab fallback unchanged)
