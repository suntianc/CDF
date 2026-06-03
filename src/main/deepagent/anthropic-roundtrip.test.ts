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
 * References:
 * - node_modules/@langchain/core/dist/language_models/stream.cjs:403-491
 *   (ChatModelStream class + _assembleMessage)
 * - node_modules/@langchain/anthropic/dist/utils/standard.js:117-121
 *   (reasoning -> thinking block conversion in _formatStandardContent)
 * - .planning/debug/minimax-m3-thinking-missing.md (root cause)
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import { ChatModelStream } from '@langchain/core/language_models/stream';
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
    const stream = new ChatModelStream(v3Events());
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
});
