import { describe, expect, it } from 'vitest';
import {
  createRuntimeStreamState,
  projectRuntimeStream,
  type RuntimeStreamEvent,
  type RuntimeStreamProjectionDeps,
} from './runtime-stream-projection';

// Runtime Stream Projection 的测试通过「事件序列」驱动纯核心，
// 断言产出的 renderer 事件（LLMStreamEvent）与 effect 序列。
// 事件序列即并发交织的全序化表示——死锁/乱序场景在这里可以枚举。

function makeDeps(overrides: Partial<RuntimeStreamProjectionDeps> = {}): RuntimeStreamProjectionDeps {
  return {
    takeBufferedReasoning: () => '',
    takeFallbackText: () => '',
    lookupAgentName: (slug) => slug,
    generateTaskId: () => 'task-fixed-id',
    ...overrides,
  };
}

function drive(events: RuntimeStreamEvent[], deps = makeDeps()) {
  let state = createRuntimeStreamState();
  const emitted: unknown[] = [];
  const effects: unknown[] = [];
  for (const event of events) {
    const result = projectRuntimeStream(state, event, deps);
    state = result.state;
    emitted.push(...result.events);
    effects.push(...result.effects);
  }
  return { state, emitted, effects };
}

describe('Runtime Stream Projection — text streaming', () => {
  it('passes plain text tokens through as message_chunk when the message has no reasoning source', () => {
    const { emitted } = drive([
      { kind: 'message-started', hasReasoningSource: false },
      { kind: 'text-token', token: '你好' },
      { kind: 'text-token', token: '，世界' },
      { kind: 'message-ended' },
    ]);

    expect(emitted).toEqual([
      { type: 'message_chunk', text: '你好' },
      { type: 'message_chunk', text: '，世界' },
    ]);
  });
});

describe('Runtime Stream Projection — buffered reasoning drain (deps)', () => {
  it('drains accumulator reasoning as one think block before the first visible text', () => {
    // llm-adapter 把思考捕获进 accumulator 而非流式 reasoning 时，
    // 首个可见正文前核心应通过 deps 抽干并补发完整 think 块。
    const deps = makeDeps({ takeBufferedReasoning: () => '缓冲的思考' });
    const { emitted } = drive(
      [
        { kind: 'message-started', hasReasoningSource: false },
        { kind: 'text-token', token: '正文' },
        { kind: 'message-ended' },
      ],
      deps,
    );

    expect(emitted).toEqual([
      { type: 'message_chunk', text: '<think>' },
      { type: 'message_chunk', text: '缓冲的思考' },
      { type: 'message_chunk', text: '</think>\n\n' },
      { type: 'message_chunk', text: '正文' },
    ]);
  });

  it('drains buffered reasoning at most once per message', () => {
    let calls = 0;
    const deps = makeDeps({
      takeBufferedReasoning: () => {
        calls += 1;
        return calls === 1 ? '只此一次' : '不应出现';
      },
    });
    const { emitted } = drive(
      [
        { kind: 'message-started', hasReasoningSource: false },
        { kind: 'text-token', token: 'A' },
        { kind: 'text-token', token: 'B' },
        { kind: 'message-ended' },
      ],
      deps,
    );

    expect(emitted).toEqual([
      { type: 'message_chunk', text: '<think>' },
      { type: 'message_chunk', text: '只此一次' },
      { type: 'message_chunk', text: '</think>\n\n' },
      { type: 'message_chunk', text: 'A' },
      { type: 'message_chunk', text: 'B' },
    ]);
  });

  it('drains buffered reasoning when flushing backpressured text after a zero-token reasoning stream', () => {
    // reasoning 源存在但一个 token 都没产出（部分模型行为）：
    // 积压文本在 reasoning-ended 冲刷时，仍要先补发 accumulator 里捕获的思考。
    const deps = makeDeps({ takeBufferedReasoning: () => '适配器捕获的思考' });
    const { emitted } = drive(
      [
        { kind: 'message-started', hasReasoningSource: true },
        { kind: 'text-token', token: '被积压的正文' },
        { kind: 'reasoning-ended' },
        { kind: 'message-ended' },
      ],
      deps,
    );

    expect(emitted).toEqual([
      { type: 'message_chunk', text: '<think>' },
      { type: 'message_chunk', text: '适配器捕获的思考' },
      { type: 'message_chunk', text: '</think>\n\n' },
      { type: 'message_chunk', text: '被积压的正文' },
    ]);
  });

  it('does not drain when reasoning already streamed in this message', () => {
    const deps = makeDeps({ takeBufferedReasoning: () => '不应出现' });
    const { emitted } = drive(
      [
        { kind: 'message-started', hasReasoningSource: true },
        { kind: 'reasoning-token', token: '流式思考' },
        { kind: 'reasoning-ended' },
        { kind: 'text-token', token: '正文' },
        { kind: 'message-ended' },
      ],
      deps,
    );

    expect(emitted).toEqual([
      { type: 'message_chunk', text: '<think>' },
      { type: 'message_chunk', text: '流式思考' },
      { type: 'message_chunk', text: '</think>\n\n' },
      { type: 'message_chunk', text: '正文' },
    ]);
  });
});

describe('Runtime Stream Projection — streamed reasoning', () => {
  it('wraps streamed reasoning tokens in think tags: open before first token, close after reasoning ends', () => {
    const { emitted } = drive([
      { kind: 'message-started', hasReasoningSource: true },
      { kind: 'reasoning-token', token: '思考中' },
      { kind: 'reasoning-token', token: '…继续' },
      { kind: 'reasoning-ended' },
      { kind: 'message-ended' },
    ]);

    expect(emitted).toEqual([
      { type: 'message_chunk', text: '<think>' },
      { type: 'message_chunk', text: '思考中' },
      { type: 'message_chunk', text: '…继续' },
      { type: 'message_chunk', text: '</think>\n\n' },
    ]);
  });

  it('buffers text tokens that arrive while reasoning is still streaming, flushing them after the think block closes', () => {
    // 并发交织的全序化：text token 与 reasoning token 交错到达。
    // 现网行为：reasoning 未完成前 text 积压，思考块闭合后按序冲刷。
    const { emitted } = drive([
      { kind: 'message-started', hasReasoningSource: true },
      { kind: 'reasoning-token', token: '先想' },
      { kind: 'text-token', token: '正文A' },
      { kind: 'reasoning-token', token: '再想' },
      { kind: 'text-token', token: '正文B' },
      { kind: 'reasoning-ended' },
      { kind: 'message-ended' },
    ]);

    expect(emitted).toEqual([
      { type: 'message_chunk', text: '<think>' },
      { type: 'message_chunk', text: '先想' },
      { type: 'message_chunk', text: '再想' },
      { type: 'message_chunk', text: '</think>\n\n' },
      { type: 'message_chunk', text: '正文A' },
      { type: 'message_chunk', text: '正文B' },
    ]);
  });

  it('does not buffer text when the message has no reasoning source, even before any reasoning-ended', () => {
    const { emitted } = drive([
      { kind: 'message-started', hasReasoningSource: false },
      { kind: 'text-token', token: '直发' },
      { kind: 'message-ended' },
    ]);
    expect(emitted).toEqual([{ type: 'message_chunk', text: '直发' }]);
  });

  it('emits no think tags when the reasoning source exists but yields zero tokens', () => {
    const { emitted } = drive([
      { kind: 'message-started', hasReasoningSource: true },
      { kind: 'reasoning-ended' },
      { kind: 'message-ended' },
    ]);

    expect(emitted).toEqual([]);
  });
});