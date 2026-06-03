---
quick_id: 260603-soe
slug: b-m3-signature-chat-assistant-thinking-s
status: complete
date: 2026-06-03
commits:
  - 37d2a53: test(llm): lock in M3 multi-turn thinking+signature roundtrip at LangChain layer
---

# Quick 260603-soe: M3 thinking+signature roundtrip — test evidence

## One-liner

Single new test file (`src/main/deepagent/anthropic-roundtrip.test.ts`) with 3 `it` blocks that proves the MiniMax M3 multi-turn thinking+signature roundtrip is automatic at the LangChain layer — no chat-side code change required.

## Hypothesis Result

**Hypothesis A confirmed (and proven by test).** Tracing the actual code path shows:

1. `convertAnthropicStream` (anthropic utils) emits v3 `content-block-delta { type: "block-delta", fields: { signature } }` for each `signature_delta` upstream SSE event.
2. `ChatModelStream._assembleMessage` (core stream.cjs:403-491) accumulates these into the AIMessage's `content[0]` block, which becomes `{ type: "reasoning", reasoning, signature }`.
3. `_convertMessagesToAnthropicPayload` (anthropic utils message_inputs.js:196-243) maps the v1 `reasoning` block back to `{ type: "thinking", thinking, signature }` in the next request body.
4. `LangGraph JsonPlusSerializer` faithfully preserves the `content` array (including `signature`) through the SQLite checkpoint roundtrip — `AIMessage extends Serializable`.
5. `deepagents runtime` `buildInputMessages` (runtime.ts:262-275) returns ONLY the current user message when a checkpoint exists, and reads AIMessages from the checkpoint for prior turns.

**Conclusion:** The multi-turn M3 thinking+signature roundtrip is automatic via the existing stack. The chat code's `msg.reasoning` consumer only emits the *text* of thinking to the renderer (which is what the UI needs); the *signature* lives entirely in the deepagents checkpoint and is consumed by the next LLM call. The renderer never sees the signature and never needs to.

## What Was Built

| File | Action | Lines |
|------|--------|-------|
| `src/main/deepagent/anthropic-roundtrip.test.ts` | create | 191 |

### Test structure

3 `it` blocks under one `describe('Anthropic thinking+signature roundtrip (M3 multi-turn)')`:

1. **1.1 — v3 stream with signature_delta → AIMessage.content carries the signature.** Builds a synthetic async iterable of v3 ChatModelStreamEvents (mirroring what `convertAnthropicStream` emits for an M3 thinking response), wraps in `ChatModelStream`, awaits `.output`, asserts:
   - `message.content` is the block-array form
   - `content[0].type === 'reasoning'`, `content[0].reasoning` is the accumulated text
   - **`content[0].signature === 'sig-m3-test-abc-123'`** — the load-bearing assertion
   - `content[1].type === 'text'`, `content[1].text === 'Here is my answer.'`
   - `message.id === 'msg_m3_test'`
   - `response_metadata.output_version === 'v1'` (proves v1 standard shape, which `_formatStandardContent` consumes)

2. **1.2 — AIMessage with reasoning+signature → next request body has the thinking block.** Constructs an AIMessage with `content: [{ type: 'reasoning', reasoning, signature }, { type: 'text', text }]` and `response_metadata: { model_provider: 'anthropic', output_version: 'v1' }`. Calls `_convertMessagesToAnthropicPayload`. Asserts the assistant message in the output has `content[0].type === 'thinking'`, `content[0].thinking`, `content[0].signature` — the Anthropic extended thinking protocol shape that the next LLM call will receive.

3. **1.3 — plain text AIMessage → no thinking block emitted (regression guard).** Constructs an AIMessage with `content: 'Plain M2.7 answer'` (string form, no reasoning block). Calls `_convertMessagesToAnthropicPayload`. Asserts:
   - `payload.messages[1].content === 'Plain M2.7 answer'` (string form preserved)
   - Serialized content does NOT contain `"type":"thinking"` — locks the boundary so future "always emit thinking" refactors are caught.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Deep import `@langchain/anthropic/dist/utils/message_inputs.cjs` blocked by package `exports` field**
- **Found during:** Task execution — initial import test failed with `Package subpath './dist/utils/message_inputs.cjs' is not defined by "exports"`
- **Issue:** The planner's spec assumed the deep import would work because `patches/@langchain+anthropic+1.4.0.patch` references this file. The patch mutates the file on disk, but `@langchain/anthropic`'s `package.json` `exports` field only exposes `.` and `./package.json` to consumers — deep paths to `dist/utils/*` are not public.
- **Fix:** Load the .cjs file via `createRequire(import.meta.url)` with a `path.join(process.cwd(), 'node_modules/...')` absolute path, bypassing Node's exports check. This works because `createRequire`+absolute-path doesn't go through package resolution. The file is the same one the patch mutates, so the assertion reflects the production runtime.
- **Files modified:** `src/main/deepagent/anthropic-roundtrip.test.ts` (new)
- **Commit:** 37d2a53

**2. [Rule 2 - Critical fix] AIMessage content block type for the v1 path is `reasoning`, not `thinking`**
- **Found during:** Task execution — initial test 1.2 had the AIMessage with `type: 'thinking'` blocks, but the v1 `_formatStandardContent` path only handles `type: 'reasoning'` (then converts it to `type: 'thinking'` in the output payload). The test would have falsely "passed" by going through a different code branch that doesn't exist for `type: 'thinking'` input.
- **Issue:** The plan's spec used `type: 'thinking'` (the Anthropic extended-thinking protocol shape) for the AIMessage content. But after v3 streamEvents assembly, blocks are `type: 'reasoning'` (the LangChain standard). The converter then maps `reasoning` → `thinking` for the next request body.
- **Fix:** Used `type: 'reasoning'` for the AIMessage content blocks in test 1.2 (matching what `ChatModelStream._assembleMessage` actually produces) and asserted `type: 'thinking'` in the OUTPUT payload (matching the Anthropic wire format). Also added `response_metadata.model_provider: 'anthropic'` which is the gate `_formatStandardContent` checks to decide whether to emit the `thinking` block (otherwise it skips even `type: 'reasoning'` blocks for non-Anthropic providers).
- **Files modified:** `src/main/deepagent/anthropic-roundtrip.test.ts` (new)
- **Commit:** 37d2a53

## Verification

- `npx vitest run src/main/deepagent/anthropic-roundtrip.test.ts` → **3 PASS, 0 FAIL, 2ms**
- `npx vitest run src/main/deepagent/llm-adapter.test.ts` → **10 PASS, 0 FAIL, 4ms** (pre-existing tests from 260603-s29 and 260603-se4 still pass)
- No production source files modified
- No `node_modules` modifications (the existing patch `patches/@langchain+anthropic+1.4.0.patch` is the video patch from 260601-nzn, unrelated and untouched)
- No `package.json` / `package-lock.json` changes

## Files Touched

| File | Action | Lines |
|------|--------|-------|
| `src/main/deepagent/anthropic-roundtrip.test.ts` | create | 191 |

## Out of Scope (per plan, NOT done)

- No chat-side code change in `src/main/llm.ts` — the roundtrip is automatic via checkpoint
- No DB schema change to `messages` table — `messages` table is the fallback for first turn (no prior signature to preserve); after first turn, deepagents owns history via checkpoint
- No `patch-package` edit — LangChain 1.4.0 already handles the roundtrip

## Success Criteria

| Criterion | Status |
|-----------|--------|
| New test file exists at the specified path and runs successfully | PASS — 3 tests pass in 2ms |
| The 3 `it` blocks each pass on the first run (no flaky timing, no live network) | PASS — fully synchronous, no I/O |
| Test 1.1's signature assertion is the load-bearing one | PASS — `content[0].signature === 'sig-m3-test-abc-123'` is asserted |
| Test 1.2's roundtrip assertion proves the next Anthropic request body includes the signature | PASS — `content[0].type === 'thinking'` + `content[0].signature === 'sig-...'` |
| Test 1.3's negative-scope assertion guards against accidental scope creep | PASS — asserts NO `type: 'thinking'` in output for plain text input |
| STATE.md gains a one-line entry for this quick task | DEFERRED — orchestrator handles STATE.md commit in Step 8 (per constraint) |

## Self-Check: PASSED

- File created at `src/main/deepagent/anthropic-roundtrip.test.ts` (FOUND)
- Commit 37d2a53 exists in `git log` (FOUND)
- Test suite reports 3 PASS, 0 FAIL
