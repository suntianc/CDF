---
quick_id: 260603-soe-b
slug: m3-signature-chat-assistant-thinking-s
status: planned
date: 2026-06-03
type: execute
depends_on: []
files_modified:
  - src/main/deepagent/anthropic-roundtrip.test.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "A focused unit test proves that MiniMax M3 thinking blocks (with signature_delta) round-trip through LangChain's v3 streamEvents pipeline and end up in the assembled AIMessage.content"
    - "A focused unit test proves that the assembled AIMessage is re-serialized into the next Anthropic request body as a `{ type: 'thinking', thinking, signature }` block — the Anthropic extended thinking protocol shape"
    - "No regression to M2.7 / OpenAI / Anthropic / Ollama / DeepSeek / Zhipu / GLM-overseas providers — the test exercises only the M3-specific thinking path"
---

# Quick 260603-soe-b: M3 multi-turn thinking+signature roundtrip — verification

## Hypothesis Determination (Architectural Question)

The constraint asked the planner to determine which hypothesis holds by tracing the actual code path. **Hypothesis A is confirmed.** Evidence trail (file:line):

### Assembly — signature survives v3 streamEvents

1. **M3 upstream SSE** sends `content_block.type === "thinking"` (start) → `delta.type === "thinking_delta"` (text deltas) → `delta.type === "signature_delta"` (signature) → `content_block_stop`.

2. **`@langchain/anthropic@1.4.0` `convertAnthropicStream`** (`node_modules/@langchain/anthropic/dist/utils/stream_events.js`):
   - Line 140-144: `mapBlockToContentBlock` maps `block.type === "thinking"` → `{ type: "reasoning", reasoning: block.thinking ?? "", index }`
   - Line 187-196: `applyAnthropicDelta` for `thinking_delta` → `delta: { type: "reasoning-delta", reasoning: delta.thinking }`
   - **Line 229-241: `applyAnthropicDelta` for `signature_delta` → `delta: { type: "block-delta", fields: { type: "reasoning", signature: delta.signature } }` — and `accumulated` gets the signature merged in**
   - Line 273-297: `finalizeBlock` returns the accumulated block including `signature`

3. **`@langchain/core` `ChatModelStream._assembleMessage`** (`node_modules/@langchain/core/dist/language_models/stream.cjs:442-491`):
   - Line 100-110 `applyDelta` for `block-delta` does `{...block, ...delta.fields}` — signature is applied to the block on every `signature_delta` event
   - Line 480-490: returns `new AIMessage({ content: filteredBlocks, ... })` — **the AIMessage.content IS the array of blocks including the thinking block with signature**

### Replay — next Anthropic request includes the signature

4. **`@langchain/anthropic@1.4.0` `_convertMessagesToAnthropicPayload`** (`node_modules/@langchain/anthropic/dist/utils/message_inputs.js:196-243`):
   - For AIMessage with `response_metadata?.output_version === "v1"`, uses `_formatStandardContent` (which preserves thinking blocks)
   - For other AIMessages, falls through to `_formatContent` (line 185-189) which iterates `content` blocks
   - **Line 129-134: for thinking blocks (`_isAnthropicThinkingBlock(contentPart)`), yields `{ type: "thinking", thinking: contentPart.thinking, signature: contentPart.signature, ... }` — the signature is included in the next request body**

### Checkpoint roundtrip — deepagents state mutation

5. **`@langchain/langgraph-checkpoint` `JsonPlusSerializer`** (`node_modules/@langchain/langgraph-checkpoint/dist/serde/jsonplus.js:78-94`): uses `@langchain/core/load` to serialize/deserialize the full graph state. `AIMessage extends Serializable` (`node_modules/@langchain/core/dist/messages/base.cjs:84-86`), so its `content` array (with thinking block + signature) is faithfully preserved through the SQLite checkpoint roundtrip.

6. **deepagents runtime** (`src/main/deepagent/runtime.ts:262-275` `buildInputMessages`): returns ONLY the current user message when a checkpoint exists; deepagents reads AIMessages from the checkpoint and feeds them to the next LLM call. The checkpoint's AIMessage.content already has the thinking block + signature.

### Conclusion

**The multi-turn M3 thinking+signature roundtrip is automatic via the existing LangChain + LangGraph + langgraph-checkpoint-sqlite stack.** No chat-side code change is required for correctness. The reasoning the constraint's doc listed — "msg.reasoning 异步迭代器只消费 reasoning-delta 事件，signature_delta 被忽略" — is correct but irrelevant: the signature is consumed by `_assembleMessage` (the buffer path), not by the `ReasoningContentStream` (the per-message text-stream path). The chat code's `msg.reasoning` consumer only emits the thinking *text* to the renderer, which is exactly what the UI needs.

The renderer's `<think>...</think>` display path is unaffected. The renderer never sees the signature (and never needs to), because the next LLM call gets the signature from the deepagents checkpoint, not from the renderer.

## Why a Test

The user explicitly asked for "让 chat 历史保存 assistant 消息的 thinking 块（含 signature）". The plan is to **prove** that the existing stack already does this — and lock the proof in with a regression test, so that any future LangChain upgrade or refactor that breaks the roundtrip is caught.

## Task

**Task 1: Write a focused unit test (`src/main/deepagent/anthropic-roundtrip.test.ts`) that proves the multi-turn thinking+signature roundtrip works.**

The test is self-contained, runs in <1s, and exercises only the v3 streamEvents assembly path that MiniMax M3 takes. It has 3 `it` blocks:

### Test 1.1: v3 stream events with signature_delta → AIMessage.content has signature

Construct a mock async iterable that yields the v3 `ChatModelStreamEvent` shape that `convertAnthropicStream` produces for an M3 thinking response:

```ts
const v3Events = [
  { event: 'message-start', id: 'msg_m3_test' },
  { event: 'content-block-start', index: 0, content: { type: 'reasoning', reasoning: '', index: 0 } },
  { event: 'content-block-delta', index: 0, delta: { type: 'reasoning-delta', reasoning: 'Let me think about this problem...' } },
  { event: 'content-block-delta', index: 0, delta: { type: 'block-delta', fields: { type: 'reasoning', signature: 'sig-m3-test-abc-123' } } },
  { event: 'content-block-finish', index: 0, content: { type: 'reasoning', reasoning: 'Let me think about this problem...', signature: 'sig-m3-test-abc-123' } },
  { event: 'content-block-start', index: 1, content: { type: 'text', text: '', index: 1 } },
  { event: 'content-block-delta', index: 1, delta: { type: 'text-delta', text: 'Here is my answer.' } },
  { event: 'content-block-finish', index: 1, content: { type: 'text', text: 'Here is my answer.' } },
  { event: 'message-finish', reason: 'stop' },
];
```

Then wrap them in `ChatModelStream` (imported from `@langchain/core/language_models/stream`, which is exposed by the `@langchain/core` package's `./language_models/stream` export — see `node_modules/@langchain/core/package.json` exports config) and await `stream.output` to get the assembled `AIMessage`.

**Assertions** (the test the LangChain assembly actually preserves signature):
- `Array.isArray(message.content)` — content is the array form, not a string
- `message.content[0].type === 'reasoning'`
- `message.content[0].reasoning === 'Let me think about this problem...'`
- `message.content[0].signature === 'sig-m3-test-abc-123'` — **the critical assertion that the signature survives**
- `message.content[1].type === 'text'` and `message.content[1].text === 'Here is my answer.'`
- `message.id === 'msg_m3_test'` (carried from `message-start`)
- `message.response_metadata.output_version === 'v1'` (proves we got the v1 standard shape that `_formatStandardContent` consumes)

This pins the roundtrip evidence at the assembly step.

### Test 1.2: AIMessage with thinking+signature → next Anthropic request body has the thinking block

Construct an `AIMessage` with `content: [{ type: 'reasoning', reasoning: '...', signature: 'sig-...' }, { type: 'text', text: '...' }]` and `response_metadata: { model_provider: 'anthropic', output_version: 'v1' }`. Then invoke `ChatAnthropic`'s public `_formatStandardContent` indirectly by calling `model._streamResponseChunks` with a mocked createStreamWithRetry... 

Actually, the cleanest way to test the conversion is to use ChatAnthropic's public `stream` method twice with a mocked underlying client, capturing the second request. But this requires deep mocking of `@anthropic-ai/sdk`.

**Pragmatic alternative**: directly test the conversion by importing `_convertMessagesToAnthropicPayload` via the deep path `@langchain/anthropic/dist/utils/message_inputs.js`. This file is patched by `patches/@langchain+anthropic+1.4.0.patch` (which already deep-imports this exact path), so the deep-import works in our build (the patch wouldn't be applied otherwise).

**Assertions**:
- `_convertMessagesToAnthropicPayload([userMessage, assistantWithThinking])` returns `{ messages: [...], system: undefined }`
- The assistant message in the output has `content[0].type === 'thinking'`
- `content[0].thinking === 'Let me think about this problem...'`
- `content[0].signature === 'sig-m3-test-abc-123'`
- The user message roundtrips with `role: 'user'`

This proves the next request body is the Anthropic extended thinking protocol shape.

### Test 1.3: M3-only guard (negative scope)

A non-M3 AIMessage (one without the thinking block, simulating M2.7 / Claude / OpenAI) must NOT produce a `thinking` block in the next request body. This locks the regression boundary: if someone accidentally turns the conversion into "always emit thinking", this test fails.

- Construct a plain `AIMessage` with `content: 'Plain M2.7 answer'` (string form, no thinking block)
- Call `_convertMessagesToAnthropicPayload`
- Assert the resulting `messages[0].content` is the plain text form (no `type: 'thinking'` block)

### Test execution

The test file imports:
- `describe`, `expect`, `it` from `vitest`
- `ChatModelStream` from `@langchain/core/language_models/stream`
- `AIMessage` from `@langchain/core/messages`
- `_convertMessagesToAnthropicPayload` from `@langchain/anthropic/dist/utils/message_inputs.js` (deep import — works because the existing patch file already deep-imports this exact path; if the deep import is rejected by the build, fall back to constructing the conversion inline from the same logic at `node_modules/@langchain/anthropic/dist/utils/message_inputs.js:196-243` and `node_modules/@langchain/anthropic/dist/utils/standard.js:95-...`)

Run command: `npx vitest run src/main/deepagent/anthropic-roundtrip.test.ts`

Expected: PASS (3).

## Out of Scope (deferred / not needed)

- **No chat-side code change in `src/main/llm.ts`**: the multi-turn roundtrip is automatic via checkpoint. Adding a `message_metadata` IPC event to forward the signature to the renderer would be cosmetic — the renderer never needs the signature (it just renders `<think>{text}</think>`), and the next LLM call gets the signature from the checkpoint, not from the renderer. Per `<scope_reduction_prohibition>`, "v1" / "static for now" / "future enhancement" placeholders are forbidden — the spec is satisfied as-is, so adding a partial cosmetic IPC is rejected.
- **No DB schema change to `messages` table**: the `messages` table is the fallback for sessions with no checkpoint (`src/main/deepagent/runtime.ts:262-275`). The first turn of a session reads from `messages`, but M3 thinking blocks on the first turn have no prior signature to preserve. After the first turn, deepagents owns history via the checkpoint. Adding a `signature` column would be a speculative future-use change with no consumer.
- **No patch-package edit**: LangChain 1.4.0 already handles the roundtrip. The existing `patches/@langchain+anthropic+1.4.0.patch` (video block) is unrelated and untouched.

## Files Touched

| File | Action | Lines |
|------|--------|-------|
| `src/main/deepagent/anthropic-roundtrip.test.ts` | create | ~120 |

## Verification

- `npx vitest run src/main/deepagent/anthropic-roundtrip.test.ts` → **PASS (3) FAIL (0)**
- All pre-existing tests in `src/main/deepagent/llm-adapter.test.ts` (10 tests from prior quick tasks 260603-s29 and 260603-se4) still pass unmodified
- The existing M3 thinking injection (`src/main/deepagent/llm-adapter.ts:550-553`) is the production prerequisite for the test (M3 model would not emit thinking events without it); the test does NOT re-test the injection (already covered by the 3 passing tests in `llm-adapter.test.ts`)

## Success Criteria

1. New test file exists at the specified path and runs successfully.
2. The 3 `it` blocks each pass on the first run (no flaky timing, no live network).
3. Test 1.1's signature assertion is the load-bearing one — it proves the v3 stream surface correctly accumulates `signature_delta` into the thinking block.
4. Test 1.2's roundtrip assertion proves the next Anthropic request body includes the signature.
5. Test 1.3's negative-scope assertion guards against accidental scope creep.
6. STATE.md gains a one-line entry for this quick task (the writing agent updates it after test passes).
