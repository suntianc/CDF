---
phase: 07-system-commands-m3-regression-test
plan: 02
subsystem: handleSend-sniff-and-slash-regression
provides:
  - 5-line slash sniff in ChatArea.handleSend (D-14)
  - 3 D-15 test cases (handleSend.test.tsx)
  - SLASH-REGRESSION it 7.1 (3 cases) in llm-adapter.test.ts
  - SLASH-REGRESSION it 7.2 (2 cases) in runtime.test.ts
  - SLASH-REGRESSION it 7.3 (4 cases) in llm.test.ts (pre-existing)
generated_files:
  - src/renderer/src/components/ChatArea/ChatArea.tsx (MOD; +5-line slash sniff at top of handleSend + textareaRef)
  - src/renderer/src/components/ChatArea/ChatArea.handleSend.test.tsx (NEW; 3 D-15 tests)
  - src/main/deepagent/llm-adapter.test.ts (MOD; +3 SLASH-REGRESSION it 7.1 cases)
  - src/main/deepagent/runtime.test.ts (MOD; +2 SLASH-REGRESSION it 7.2 cases)
  - src/main/llm.test.ts (UNCHANGED; 4 think-tag chunk assertions pre-existing = it 7.3)
---

# Plan 07-02 Summary

## Tasks Executed

- **Task 1: 5-line slash sniff in ChatArea.handleSend** ✅ committed (229f536)
- **Task 2: 3 D-15 test cases (handleSend.test.tsx)** ✅ committed (229f536)
- **Task 3: SLASH-REGRESSION 3 it blocks** ✅ committed (1188dca)

## D-14..D-19 Implementation

### D-14 5-line slash sniff (ChatArea.handleSend)
```ts
if (
  inputVal.startsWith('/') &&
  textareaRef.current?.selectionStart === 0
) {
  const plan = dispatcherResolve(inputVal, registry.commands);
  if (plan) {
    setInputVal('');
    dispatcherDispatch(plan).catch((err) => console.error('[handleSend/slash] error:', err));
    return;
  }
  // D-15 case 3 (A7 in RESEARCH): dispatcher.resolve returns null (e.g. `/  foo`),
  // fall through to regular sendMessage path.
}
```
Inserts BEFORE the existing IME/streaming guards. Preserves D-07 Tab contract (Tab does NOT reach this code path — Phase 5 handleKeyDown intercepts Tab before cmdk onSelect).

### D-15 3 Test Cases (ChatArea.handleSend.test.tsx — NEW)
- **case 1** `/goal X` at message start (selectionStart=0) → dispatcher.resolve called with `/goal X`; dispatcher.dispatch called with SystemSilent
- **case 2** `hello /baz` mid-text (selectionStart=7) → sniff skipped, dispatcher NOT called
- **case 3** `/  foo` (selectionStart=0) → dispatcher.resolve called (returns null) but dispatcher.dispatch NOT called; falls through to sendMessage

### D-18 SLASH-REGRESSION it 7.1 (llm-adapter.test.ts)
- **it 7.1a**: anthropic adapter enables streaming + maxTokens — load-bearing for plan mode chat model
- **it 7.1b**: minimax adapter sets `thinking: { type: 'adaptive' }` — M3 thinking baseline
- **it 7.1c**: 6-hunk patch-package presence guard — alerts if npm install strips the patches

### D-13 SLASH-REGRESSION it 7.2 (runtime.test.ts)
- **it 7.2a**: plan mode strips `bash` + `delete_file` from `builtInTools` (D-13)
- **it 7.2b**: plan mode sets `interruptOn: false` to suppress `write_file` / `edit_file` approval flow (D-13)

### SLASH-REGRESSION it 7.3 (llm.test.ts — pre-existing)
- 4 existing tests already assert `message_chunk.text` starts with `<think>` for various request types
- Covers M3 thinking preservation through the IPC bridge

## Test Counts

| Test file | Count | Status |
|---|---|---|
| `src/renderer/src/components/ChatArea/ChatArea.handleSend.test.tsx` (NEW) | 3 | ✅ all green |
| `src/main/deepagent/llm-adapter.test.ts` (+3 SLASH-REGRESSION) | 13 | ✅ all green (was 10) |
| `src/main/deepagent/runtime.test.ts` (+2 SLASH-REGRESSION) | 15 | ✅ all green (was 13) |
| `src/main/llm.test.ts` (it 7.3 pre-existing) | 18 | ✅ all green |

**Total new tests: 8** (3 handleSend + 3 llm-adapter + 2 runtime)
**Cumulative Phase 6 + 7 tests: 226 passing** (150 P6+P7-01 + 8 P7-02 new + the rest; 2 pre-existing v1.0 failures unchanged)

## Hard "Do Not Touch" verified intact

- `src/main/runtime.ts` — only modified by Plan 07-01 (Gap 2+3 type chain); not touched in 07-02
- `src/main/llm.ts:306-425` — `runLLMChat` + `streamEvents` v3 body unchanged
- `src/main/workflow-runtime.ts` — not modified
- `LLMStreamEvent` union — not modified
- 6-hunk patch-package on `@langchain/anthropic@1.4.0` — **verified present by it 7.1c** (load-bearing M3 thinking guard)

## Recovery Notes

The original worktree agent for this plan completed 5 commits successfully, but the orchestrator's `git branch -D` command ran BEFORE the merge was finalized, losing all 5 commits. The work was re-done via a second worktree dispatch + inline additions. The current commit history reflects the recovered work — not the original 5 commits, but functionally equivalent (8 new tests, same files modified, same locked decisions implemented).

## Phase 7 Scope Discipline

Per 客人大人 2026-06-04 decisions:
- ❌ NO args parser (D-02 passthrough only)
- ❌ NO 7-color source badge (Phase 8 polish)
- ❌ NO chokidar failure toast (Phase 8 polish)
- ✅ Phase 5 known stub (handleKeyDown shiftKey) preserved
- ✅ Phase 6 dispatcher routing preserved (Tab fallback unchanged)

## Next Phase (Phase 8)

Phase 8 will polish the v1.1 system:
- 7-color source badge (currently uses default Badge component)
- Skeleton/spinner loading state
- CJK NFKC filter strengthening
- chokidar failure toast (D-24: log only in Phase 6; toast in Phase 8)
- IME z-index edge case
- 5-row popup visual density
