/**
 * Anthropic thinking+signature roundtrip — M3 multi-turn regression guard.
 *
 * MiniMax M3 protocol (Anthropic extended-thinking-compatible) requires the
 * client to (a) request thinking via the `thinking` field, and (b) echo back
 * the thinking block (with its `signature`) on every subsequent turn. This
 * test pins the **LangChain layer** (not the chat-runtime layer) so that
 * any future `@langchain/anthropic` upgrade that breaks the roundtrip is
 * caught here, in <1s, with no network.
 *
 * Background:
 * - @langchain/anthropic 1.4.0 `convertAnthropicStream` emits a v3 stream
 *   with content blocks of `type: "reasoning"` carrying `signature_delta`
 *   as a `block-delta { fields: { signature } }` event.
 * - `ChatModelStream._assembleMessage` (core) accumulates these into an
 *   AIMessage whose `content[0]` is `{ type: "reasoning", reasoning, signature }`
 *   and whose `response_metadata.output_version === "v1"`.
 * - `_convertMessagesToAnthropicPayload` (anthropic utils) maps the v1
 *   `reasoning` block back to `{ type: "thinking", thinking, signature }`
 *   in the next request body — preserving the signature for the next turn.
 *
 * Fallthrough path (no v1 marker) — bug + patch (added 2026-06-03, real-fix 260603-tiy):
 * - The 260603-soe-b conclusion above ("automatic roundtrip") is correct
 *   ONLY for AIMessages whose `response_metadata.output_version === "v1"`
 *   (the path test 1.2 covers — `_convertMessagesToAnthropicPayload` at
 *   line 208 routes those through `_formatStandardContent`, which has a
 *   `block.type === "reasoning" && isAnthropicMessage` branch — see
 *   `node_modules/@langchain/anthropic/dist/utils/standard.js:129`).
 * - However, when the AIMessage round-trips through deepagents'
 *   `langgraph-checkpoint-sqlite` serializer, the `output_version: "v1"`
 *   marker may be lost; the message then falls through to
 *   `_formatContentBlocks` (in `message_inputs.js` / `.cjs`). Before this
 *   patch the generator had NO `else if` branch for `type: "reasoning"`,
 *   so the block was silently dropped and the second-turn request body
 *   carried no thinking block, so the M3 upstream did not stream thinking
 *   events, so the chat UI showed no thinking region.
 * - Fix lives in `patches/@langchain+anthropic+1.4.0.patch` (new hunks in
 *   BOTH `message_inputs.js` AND `message_inputs.cjs` — production loads
 *   `.cjs` because the bundled Electron main is CommonJS, but tests load
 *   `.cjs` directly via `createRequire`; the parallel build outputs must
 *   stay in sync). The new branch is guarded by
 *   `contentPart.type === "reasoning" && "signature" in contentPart`
 *   (double-guard avoids producing signature-less thinking blocks that
 *   would trigger upstream 400).
 * - Test 1.4 below pins the fallthrough path: AIMessage with empty
 *   `response_metadata` + a reasoning+signature block must convert to a
 *   thinking block in the next request body.
 * - When upgrading `@langchain/anthropic` past 1.4.0: re-test this
 *   fallthrough path. If upstream now handles `type: "reasoning"` inside
 *   `_formatContentBlocks`, drop the new hunks from the patch and delete
 *   test 1.4 (the upstream library covers it).
 *
 * Patch scope v2 (added 2026-06-03, real-fix-2 260603-u6w):
 * - The 260603-tiy patch fixed the FALLTHROUGH path
 *   (`_formatContentBlocks` in message_inputs.js/.cjs). This v2 patch
 *   fixes the V1 path (`_formatStandardContent` in standard.js/.cjs)
 *   by removing the redundant `isAnthropicMessage` guard from the
 *   reasoning branch.
 * - Rationale: `_formatStandardContent` lives in @langchain/anthropic,
 *   so reasoning blocks can only come from Anthropic-compatible models.
 *   The `isAnthropicMessage` runtime check is defensive but breaks
 *   legitimate roundtrips where `response_metadata.model_provider` is
 *   lost through deepagents' langgraph-checkpoint-sqlite (note: the
 *   `output_version: "v1"` marker SURVIVES this serializer, so the
 *   message still takes the v1 dispatch path — but the guard inside
 *   `_formatStandardContent` is now false, and the reasoning branch
 *   is skipped).
 * - When upgrading @langchain/anthropic past 1.4.0: re-test both the
 *   fallthrough path (test 1.4) and the v1 path without model_provider
 *   (test 1.5). If upstream now handles `type: "reasoning"` in
 *   `_formatStandardContent` unconditionally, drop the v2 hunks from
 *   the patch and delete test 1.5.
 *
 * References:
 * - node_modules/@langchain/core/dist/language_models/stream.cjs:403-491
 *   (ChatModelStream class + _assembleMessage)
 * - node_modules/@langchain/anthropic/dist/utils/standard.js:117-121
 *   (reasoning -> thinking block conversion in _formatStandardContent)
 * - node_modules/@langchain/anthropic/dist/utils/message_inputs.cjs:130-135
 *   (the v1-only `_isAnthropicThinkingBlock` branch — does NOT match `type: "reasoning"`)
 * - patches/@langchain+anthropic+1.4.0.patch (new reasoning branches in .js + .cjs)
 * - .planning/debug/minimax-m3-thinking-missing.md (root cause)
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import { ChatModelStream } from '@langchain/core/language_models/stream';
import type { ChatModelStreamEvent } from '@langchain/core/language_models/event';
import { AIMessage, HumanMessage } from '@langchain/core/messages';

// The `_convertMessagesToAnthropicPayload` function is NOT exposed by
// `@langchain/anthropic`'s package.json `exports` field — only `.` and
// `./package.json` are public. Load the .cjs file directly via the
// resolved filesystem path. The existing `patches/@langchain+anthropic+1.4.0.patch`
// already mutates this exact file (line 179 of message_inputs.js), confirming
// the patch system treats it as a known-deep path.
const require = createRequire(import.meta.url);
const cjsPath = path.join(
  process.cwd(),
  'node_modules/@langchain/anthropic/dist/utils/message_inputs.cjs'
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { _convertMessagesToAnthropicPayload } = require(cjsPath) as {
  _convertMessagesToAnthropicPayload: (messages: unknown[]) => {
    messages: Array<{ role: string; content: unknown }>;
    system: unknown;
  };
};

// Test 1.5 calls `_formatStandardContent` directly via the same `createRequire`
// + .cjs pattern. This function lives in `standard.cjs` and is what the v1
// dispatch in `_convertMessagesToAnthropicPayload` (message_inputs.cjs:215-218)
// delegates to when `response_metadata.output_version === "v1"`.
const standardCjsPath = path.join(
  process.cwd(),
  'node_modules/@langchain/anthropic/dist/utils/standard.cjs'
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { _formatStandardContent } = require(standardCjsPath) as {
  _formatStandardContent: (message: {
    contentBlocks: Array<Record<string, unknown>>;
    response_metadata?: Record<string, unknown>;
  }) => Array<Record<string, unknown>>;
};

/**
 * Build a v3 ChatModelStream from a list of synthetic events that mirrors
 * the shape `convertAnthropicStream` emits for an M3 thinking response.
 */
async function* v3Events(): AsyncGenerator<Record<string, unknown>> {
  yield { event: 'message-start', id: 'msg_m3_test' };
  // Block 0: reasoning (thinking)
  yield {
    event: 'content-block-start',
    index: 0,
    content: { type: 'reasoning', reasoning: '', index: 0 },
  };
  yield {
    event: 'content-block-delta',
    index: 0,
    delta: {
      type: 'reasoning-delta',
      reasoning: 'Let me think about this problem...',
    },
  };
  yield {
    event: 'content-block-delta',
    index: 0,
    delta: {
      type: 'block-delta',
      fields: { type: 'reasoning', signature: 'sig-m3-test-abc-123' },
    },
  };
  yield {
    event: 'content-block-finish',
    index: 0,
    content: {
      type: 'reasoning',
      reasoning: 'Let me think about this problem...',
      signature: 'sig-m3-test-abc-123',
    },
  };
  // Block 1: text
  yield {
    event: 'content-block-start',
    index: 1,
    content: { type: 'text', text: '', index: 1 },
  };
  yield {
    event: 'content-block-delta',
    index: 1,
    delta: { type: 'text-delta', text: 'Here is my answer.' },
  };
  yield {
    event: 'content-block-finish',
    index: 1,
    content: { type: 'text', text: 'Here is my answer.' },
  };
  yield { event: 'message-finish', reason: 'stop' };
}

describe('Anthropic thinking+signature roundtrip (M3 multi-turn)', () => {
  it('1.1 v3 stream with signature_delta -> AIMessage.content carries the signature', async () => {
    // Cast synthetic events to ChatModelStreamEvent: the generator's yield
    // values are well-formed v3 events (matching MessageStartEvent /
    // ContentBlockStartEvent / etc. shapes) but the AsyncGenerator's inferred
    // type is `Record<string, unknown>` because of how we build the literals.
    // The cast is safe at the boundary; runtime behavior is covered by
    // vitest 3/3 PASS.
    const stream = new ChatModelStream(
      v3Events() as AsyncIterable<ChatModelStreamEvent>
    );
    const message = await stream.output;

    // Content is the block-array form (not a string)
    expect(Array.isArray(message.content)).toBe(true);
    const blocks = message.content as Array<Record<string, unknown>>;

    // Reasoning block preserved with signature
    expect(blocks[0].type).toBe('reasoning');
    expect(blocks[0].reasoning).toBe('Let me think about this problem...');
    // **The critical assertion:** signature survives the assembly path
    expect(blocks[0].signature).toBe('sig-m3-test-abc-123');

    // Text block preserved in order
    expect(blocks[1].type).toBe('text');
    expect(blocks[1].text).toBe('Here is my answer.');

    // Metadata carried from message-start and message-finish
    expect(message.id).toBe('msg_m3_test');
    // v1 standard shape — what _formatStandardContent consumes on the way out
    expect(message.response_metadata?.output_version).toBe('v1');
    expect(message.response_metadata?.finish_reason).toBe('stop');
  });

  it('1.2 AIMessage with reasoning+signature -> next request body has the thinking block', () => {
    // Construct the assembled AIMessage exactly as the v3 stream would
    // produce it (type: "reasoning" + response_metadata.output_version: "v1"
    // + response_metadata.model_provider: "anthropic" — the latter is
    // what `_formatStandardContent` checks to emit the Anthropic-flavored
    // `thinking` block).
    const assistant = new AIMessage({
      content: [
        { type: 'reasoning', reasoning: 'Let me think about this problem...', signature: 'sig-m3-test-abc-123' },
        { type: 'text', text: 'Here is my answer.' },
      ],
      response_metadata: { model_provider: 'anthropic', output_version: 'v1' },
    });
    const user = new HumanMessage('What is 2+2?');

    const payload = _convertMessagesToAnthropicPayload([user, assistant]);

    // System may be undefined when no system message is passed
    expect(payload.messages).toHaveLength(2);

    // User message roundtrips
    expect(payload.messages[0].role).toBe('user');
    expect(payload.messages[0].content).toBe('What is 2+2?');

    // Assistant message is converted to Anthropic extended-thinking shape
    const assistantPayload = payload.messages[1];
    expect(assistantPayload.role).toBe('assistant');
    const assistantContent = assistantPayload.content as Array<Record<string, unknown>>;
    expect(assistantContent[0].type).toBe('thinking');
    expect(assistantContent[0].thinking).toBe('Let me think about this problem...');
    expect(assistantContent[0].signature).toBe('sig-m3-test-abc-123');
    // Text block follows the thinking block (order preserved)
    expect(assistantContent[1].type).toBe('text');
    expect(assistantContent[1].text).toBe('Here is my answer.');
  });

  it('1.3 plain text AIMessage -> no thinking block emitted (regression guard)', () => {
    // A non-M3 AIMessage (string content, no reasoning block) must NOT
    // produce a `thinking` block in the next request body. If someone
    // accidentally turns the converter into "always emit thinking",
    // this test fails.
    const assistant = new AIMessage('Plain M2.7 answer');
    const user = new HumanMessage('Hi');

    const payload = _convertMessagesToAnthropicPayload([user, assistant]);

    expect(payload.messages).toHaveLength(2);
    expect(payload.messages[1].role).toBe('assistant');

    // Content is the string form (no block array, no thinking block)
    expect(payload.messages[1].content).toBe('Plain M2.7 answer');
    // Belt-and-suspenders: serialize and search for the forbidden type
    const serialized = JSON.stringify(payload.messages[1].content);
    expect(serialized).not.toContain('"type":"thinking"');
  });

  it('1.4 fallthrough path (no v1 marker) — reasoning+signature block converts to thinking block', () => {
    // **Why this test exists:** 260603-soe-b claimed M3 thinking+signature
    // roundtrips automatically. That claim is correct ONLY for the v1 path
    // (test 1.2 covers it). When deepagents' checkpoint serializer loses
    // the `response_metadata.output_version: "v1"` marker (which it does
    // empirically after one checkpoint roundtrip), the AIMessage falls
    // through to `_formatContentBlocks` instead of `_formatStandardContent`.
    //
    // Before the patch in `patches/@langchain+anthropic+1.4.0.patch` (new
    // hunks in message_inputs.js + .cjs, added 2026-06-03), the fallthrough
    // generator had no `else if` branch for `type: "reasoning"` blocks, so
    // they were silently dropped — second-turn request body had no thinking
    // block — M3 upstream did not emit thinking events — chat UI showed no
    // thinking region (the bug the user reported).
    //
    // **Assumption about test verification:** this test runs against the
    // post-patch `node_modules` state (patch-package's postinstall has
    // already applied the patch). The test does NOT itself disable+re-enable
    // the patch — that would require shelling out to `patch-package`. The
    // regression value is: if the patch is later removed (or if an upgrade
    // overrides it) the test fails immediately at `expect(blocks[0].type)
    // .toBe('thinking')`, surfacing the regression.
    const assistant = new AIMessage({
      content: [
        { type: 'reasoning', reasoning: 'Let me think...', signature: 'sig-fallthrough-xyz' },
      ],
      // Empty response_metadata — deliberately NO `output_version: "v1"`
      // and NO `model_provider: "anthropic"`, so the message takes the
      // fallthrough path through `_formatContentBlocks`, not the v1 path
      // through `_formatStandardContent` (which test 1.2 covers).
      response_metadata: {},
    });
    const user = new HumanMessage('What is 2+2?');

    const payload = _convertMessagesToAnthropicPayload([user, assistant]);

    expect(payload.messages).toHaveLength(2);
    const assistantPayload = payload.messages[1];
    expect(assistantPayload.role).toBe('assistant');

    // Content must be the block-array form (not string)
    expect(Array.isArray(assistantPayload.content)).toBe(true);
    const blocks = assistantPayload.content as Array<Record<string, unknown>>;

    // The critical assertion: reasoning block was converted to thinking
    // block (not silently dropped) and signature was preserved.
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks[0].type).toBe('thinking');
    expect(blocks[0].thinking).toBe('Let me think...');
    expect(blocks[0].signature).toBe('sig-fallthrough-xyz');
  });

  it('1.5 v1 path without model_provider — reasoning+signature block converts to thinking block', () => {
    // **Why this test exists:** 260603-tiy fixed the fallthrough path
    // (no `output_version: "v1"` marker — see test 1.4). This test
    // pins the V1 path (`_convertMessagesToAnthropicPayload` at
    // message_inputs.cjs:215-218 routes to `_formatStandardContent`)
    // when the AIMessage has `output_version: "v1"` BUT is missing
    // `model_provider: "anthropic"` from `response_metadata`.
    //
    // Empirically: deepagents' langgraph-checkpoint-sqlite serializer
    // preserves `output_version: "v1"` but drops `model_provider` on
    // roundtrip. Before the v2 patch, `_formatStandardContent` had:
    //   } else if (block.type === "reasoning" && isAnthropicMessage)
    // so the guard evaluated to false and the reasoning block was
    // silently dropped. After the v2 patch the guard is removed and
    // the reasoning block converts to a thinking block.
    //
    // **Test calls `_formatStandardContent` DIRECTLY** (via
    // `createRequire` on standard.cjs) so this test is independent
    // of the dispatch routing in `_convertMessagesToAnthropicPayload`
    // — that routing is already pinned by test 1.2. Here we only
    // assert that the function itself produces a thinking block for
    // an AIMessage whose `model_provider` is missing.
    //
    // We pass a plain object with explicit `contentBlocks` (not an
    // AIMessage instance) so we don't have to construct a fully
    // assembled message just to feed one reasoning block to the
    // function under test. `_formatStandardContent` only reads
    // `message.contentBlocks` and `message.response_metadata`.
    const message = {
      contentBlocks: [
        {
          type: 'reasoning',
          reasoning: 'Let me think about this problem...',
          signature: 'sig-v1-no-provider-xyz',
        },
      ],
      // output_version: "v1" is set (so v1 path is taken upstream)
      // but model_provider is DELIBERATELY missing — this is the
      // post-checkpoint state deepagents produces empirically.
      response_metadata: { output_version: 'v1' },
    } as unknown as Parameters<typeof _formatStandardContent>[0];

    const blocks = _formatStandardContent(message);

    // The reasoning block was converted to a thinking block (not
    // silently dropped because of the redundant model_provider guard)
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    const first = blocks[0];
    expect(first.type).toBe('thinking');
    expect(first.thinking).toBe('Let me think about this problem...');
    expect(first.signature).toBe('sig-v1-no-provider-xyz');
  });
});
