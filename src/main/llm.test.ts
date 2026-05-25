import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createDeepAgentRuntimeMock, dbPrepareMock, modelCaptureMock } = vi.hoisted(() => ({
  createDeepAgentRuntimeMock: vi.fn(),
  dbPrepareMock: vi.fn(),
  modelCaptureMock: new WeakMap<object, { reasoningText: string; normalText: string }>(),
}));

vi.mock('./deepagent/runtime', () => ({
  DEEPAGENT_CHECKPOINT_NAMESPACE: 'cdf-master-runtime-v3',
  createDeepAgentRuntime: createDeepAgentRuntimeMock,
}));

vi.mock('./deepagent/llm-adapter', () => ({
  getOllamaBaseUrl: vi.fn((url: string) => url),
  takeModelReasoningCapture: vi.fn((model: object) => {
    const captured = modelCaptureMock.get(model);
    if (!captured) return '';
    modelCaptureMock.set(model, { ...captured, reasoningText: '' });
    return captured.reasoningText;
  }),
  takeModelTextCapture: vi.fn((model: object) => {
    const captured = modelCaptureMock.get(model);
    if (!captured) return '';
    modelCaptureMock.set(model, { ...captured, normalText: '' });
    return captured.normalText;
  }),
}));

vi.mock('./database', () => ({
  default: {
    prepare: dbPrepareMock,
  },
}));

import { RUN_OUTPUT_GRACE_MS, runLLMChat } from './llm';
import { appendCurrentText } from './deepagent/stream-accumulator';

describe('runLLMChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // WeakMap cannot be cleared; tests use fresh model objects where capture matters.
    dbPrepareMock.mockImplementation((sql: string) => ({
      run: vi.fn(),
      all: vi.fn(() => []),
      get: () => {
        if (sql.includes('FROM agent_runs')) return { id: 'run-1' };
        return undefined;
      },
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should stream assistant tokens with the current user message', async () => {
    const streamEvents = vi.fn().mockResolvedValue({
      messages: (async function* () {
        yield {
          text: (async function* () {
            yield '收';
            yield '到';
          })(),
        };
      })(),
      toolCalls: (async function* () {})(),
      output: Promise.resolve({ state: 'done' }),
    });
    createDeepAgentRuntimeMock.mockResolvedValue({
      agent: {
        streamEvents,
      },
      inputMessages: [{ role: 'user', content: 'ping' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    });

    const send = vi.fn();
    await runLLMChat({ send } as any, 'req-1', {
      projectId: 'project-1',
      sessionId: 'session-1',
      message: {
        id: 'message-1',
        content: 'ping',
      },
    });

    expect(createDeepAgentRuntimeMock).toHaveBeenCalledWith(
      'project-1',
      'session-1',
      {
        id: 'message-1',
        content: 'ping',
      },
      undefined,
      undefined
    );
    expect(streamEvents).toHaveBeenCalledWith(
      { messages: [{ role: 'user', content: 'ping' }] },
      expect.objectContaining({
        version: 'v3',
        configurable: {
          thread_id: 'session-1',
          checkpoint_ns: 'cdf-master-runtime-v3',
        },
      })
    );
    expect(send).toHaveBeenCalledWith('llm:chunk-req-1', { type: 'message_chunk', text: '收' });
    expect(send).toHaveBeenCalledWith('llm:chunk-req-1', { type: 'message_chunk', text: '到' });
    expect(send).toHaveBeenLastCalledWith('llm:chunk-req-1', { type: 'message_done' });
  });

  it('should stream tool lifecycle events and runtime errors', async () => {
    createDeepAgentRuntimeMock.mockResolvedValue({
      agent: {
        streamEvents: vi.fn().mockResolvedValue({
          messages: (async function* () {})(),
          toolCalls: (async function* () {
            yield { name: 'tool-a', input: { x: 1 }, output: Promise.resolve('ok') };
            yield { name: 'tool-b', input: { y: 2 }, output: Promise.reject(new Error('boom')) };
          })(),
          output: Promise.resolve({}),
        }),
      },
      inputMessages: [{ role: 'user', content: 'run' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    });

    const send = vi.fn();
    await runLLMChat({ send } as any, 'req-2', {
      projectId: 'project-1',
      sessionId: 'session-2',
      message: {
        id: 'message-2',
        content: 'run',
      },
    });

    expect(send).toHaveBeenCalledWith('llm:chunk-req-2', expect.objectContaining({ type: 'tool_start', name: 'tool-a', input: { x: 1 } }));
    expect(send).toHaveBeenCalledWith('llm:chunk-req-2', expect.objectContaining({ type: 'tool_end', name: 'tool-a', output: 'ok' }));
    expect(send).toHaveBeenCalledWith('llm:chunk-req-2', expect.objectContaining({ type: 'tool_start', name: 'tool-b', input: { y: 2 } }));
    expect(send).toHaveBeenCalledWith('llm:chunk-req-2', expect.objectContaining({ type: 'tool_error', name: 'tool-b', error: 'boom' }));
  });

  it('should complete when run.output does not resolve after streams finish', async () => {
    vi.useFakeTimers();
    createDeepAgentRuntimeMock.mockResolvedValue({
      agent: {
        streamEvents: vi.fn().mockResolvedValue({
          messages: (async function* () {
            yield {
              reasoning: (async function* () {
                yield '需要先查找 README。';
              })(),
              text: (async function* () {
                yield '我来读取。';
              })(),
            };
          })(),
          toolCalls: (async function* () {})(),
          output: new Promise(() => {}),
          interrupts: [],
        }),
      },
      inputMessages: [{ role: 'user', content: '读取 README' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    });

    const send = vi.fn();
    const promise = runLLMChat({ send } as any, 'req-hang', {
      projectId: 'project-1',
      sessionId: 'session-hang',
      message: {
        id: 'message-hang',
        content: '读取 README',
      },
    });

    await vi.advanceTimersByTimeAsync(RUN_OUTPUT_GRACE_MS);
    await promise;

    expect(send).toHaveBeenCalledWith('llm:chunk-req-hang', { type: 'message_chunk', text: '<think>' });
    expect(send).toHaveBeenCalledWith('llm:chunk-req-hang', { type: 'message_chunk', text: '需要先查找 README。' });
    expect(send).toHaveBeenCalledWith('llm:chunk-req-hang', { type: 'message_chunk', text: '</think>\n\n' });
    expect(send).toHaveBeenCalledWith('llm:chunk-req-hang', { type: 'message_chunk', text: '我来读取。' });
    expect(send).toHaveBeenLastCalledWith('llm:chunk-req-hang', { type: 'message_done' });
  });

  it('should flush cached text when stream events expose reasoning but no text', async () => {
    vi.useFakeTimers();
    createDeepAgentRuntimeMock.mockResolvedValue({
      agent: {
        streamEvents: vi.fn().mockResolvedValue({
          messages: (async function* () {
            appendCurrentText('当前项目目录如下。');
            yield {
              reasoning: (async function* () {
                yield '已经读取目录。';
              })(),
              text: (async function* () {})(),
            };
          })(),
          toolCalls: (async function* () {})(),
          output: new Promise(() => {}),
          interrupts: [],
        }),
      },
      inputMessages: [{ role: 'user', content: '看一下目录' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    });

    const send = vi.fn();
    const promise = runLLMChat({ send } as any, 'req-cached-text', {
      projectId: 'project-1',
      sessionId: 'session-cached-text',
      message: {
        id: 'message-cached-text',
        content: '看一下目录',
      },
    });

    await vi.advanceTimersByTimeAsync(RUN_OUTPUT_GRACE_MS);
    await promise;

    expect(send).toHaveBeenCalledWith('llm:chunk-req-cached-text', { type: 'message_chunk', text: '<think>' });
    expect(send).toHaveBeenCalledWith('llm:chunk-req-cached-text', { type: 'message_chunk', text: '已经读取目录。' });
    expect(send).toHaveBeenCalledWith('llm:chunk-req-cached-text', { type: 'message_chunk', text: '</think>\n\n' });
    expect(send).toHaveBeenCalledWith('llm:chunk-req-cached-text', { type: 'message_chunk', text: '当前项目目录如下。' });
    expect(send).toHaveBeenLastCalledWith('llm:chunk-req-cached-text', { type: 'message_done' });
  });

  it('should keep cached text scoped to each concurrent request', async () => {
    createDeepAgentRuntimeMock.mockImplementation(async (_projectId: string, sessionId: string) => ({
      agent: {
        streamEvents: vi.fn().mockResolvedValue({
          messages: (async function* () {
            appendCurrentText(sessionId === 'session-a' ? 'A 目录' : 'B 目录');
            yield {
              text: (async function* () {})(),
            };
          })(),
          toolCalls: (async function* () {})(),
          output: Promise.resolve({}),
          interrupts: [],
        }),
      },
      inputMessages: [{ role: 'user', content: '看目录' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    }));

    const sendA = vi.fn();
    const sendB = vi.fn();

    await Promise.all([
      runLLMChat({ send: sendA } as any, 'req-a', {
        projectId: 'project-1',
        sessionId: 'session-a',
        message: {
          id: 'message-a',
          content: '看目录',
        },
      }),
      runLLMChat({ send: sendB } as any, 'req-b', {
        projectId: 'project-1',
        sessionId: 'session-b',
        message: {
          id: 'message-b',
          content: '看目录',
        },
      }),
    ]);

    expect(sendA).toHaveBeenCalledWith('llm:chunk-req-a', { type: 'message_chunk', text: 'A 目录' });
    expect(sendA).not.toHaveBeenCalledWith('llm:chunk-req-a', { type: 'message_chunk', text: 'B 目录' });
    expect(sendB).toHaveBeenCalledWith('llm:chunk-req-b', { type: 'message_chunk', text: 'B 目录' });
    expect(sendB).not.toHaveBeenCalledWith('llm:chunk-req-b', { type: 'message_chunk', text: 'A 目录' });
  });

  it('should flush model-captured reasoning when async local context is not available', async () => {
    const model = {};
    createDeepAgentRuntimeMock.mockResolvedValue({
      agent: {
        streamEvents: vi.fn().mockResolvedValue({
          messages: (async function* () {
            modelCaptureMock.set(model, { reasoningText: '模型实例捕获的思考', normalText: '' });
            yield {
              text: (async function* () {})(),
            };
          })(),
          toolCalls: (async function* () {})(),
          output: new Promise(() => {}),
          interrupts: [],
        }),
      },
      model,
      inputMessages: [{ role: 'user', content: 'ping' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    });

    vi.useFakeTimers();
    const send = vi.fn();
    const promise = runLLMChat({ send } as any, 'req-model-reasoning', {
      projectId: 'project-1',
      sessionId: 'session-model-reasoning',
      message: {
        id: 'message-model-reasoning',
        content: 'ping',
      },
    });

    await vi.advanceTimersByTimeAsync(RUN_OUTPUT_GRACE_MS);
    await promise;

    expect(send).toHaveBeenCalledWith('llm:chunk-req-model-reasoning', { type: 'message_chunk', text: '<think>' });
    expect(send).toHaveBeenCalledWith('llm:chunk-req-model-reasoning', { type: 'message_chunk', text: '模型实例捕获的思考' });
    expect(send).toHaveBeenCalledWith('llm:chunk-req-model-reasoning', { type: 'message_chunk', text: '</think>\n\n' });
  });

  it('should buffer text streaming behind an active reasoning stream and flash it in order', async () => {
    let releaseReasoning!: () => void;
    const reasoningGate = new Promise<void>((resolve) => {
      releaseReasoning = resolve;
    });

    createDeepAgentRuntimeMock.mockResolvedValue({
      agent: {
        streamEvents: vi.fn().mockResolvedValue({
          messages: (async function* () {
            yield {
              reasoning: (async function* () {
                await reasoningGate;
                yield '稍后思考';
              })(),
              text: (async function* () {
                yield '即时回复';
              })(),
            };
          })(),
          toolCalls: (async function* () {})(),
          output: Promise.resolve({}),
        }),
      },
      inputMessages: [{ role: 'user', content: 'ping' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    });

    const send = vi.fn();
    const promise = runLLMChat({ send } as any, 'req-concurrent', {
      projectId: 'project-1',
      sessionId: 'session-concurrent',
      message: {
        id: 'message-concurrent',
        content: 'ping',
      },
    });

    // 此时由于 reasoning 流未结束，即使 text 流产出了 "即时回复"，也不应被发送
    await new Promise((r) => setTimeout(r, 100));
    expect(send).not.toHaveBeenCalledWith('llm:chunk-req-concurrent', { type: 'message_chunk', text: '即时回复' });

    releaseReasoning();
    await promise;

    expect(send).toHaveBeenCalledWith('llm:chunk-req-concurrent', { type: 'message_chunk', text: '<think>' });
    expect(send).toHaveBeenCalledWith('llm:chunk-req-concurrent', { type: 'message_chunk', text: '稍后思考' });
    expect(send).toHaveBeenCalledWith('llm:chunk-req-concurrent', { type: 'message_chunk', text: '</think>\n\n' });
    expect(send).toHaveBeenCalledWith('llm:chunk-req-concurrent', { type: 'message_chunk', text: '即时回复' });
    expect(send).toHaveBeenLastCalledWith('llm:chunk-req-concurrent', { type: 'message_done' });
  });

  it('should pass runtime model overrides to deepagent runtime', async () => {
    createDeepAgentRuntimeMock.mockResolvedValue({
      agent: {
        streamEvents: vi.fn().mockResolvedValue({
          messages: (async function* () {})(),
          toolCalls: (async function* () {})(),
          output: Promise.resolve({}),
        }),
      },
      inputMessages: [{ role: 'user', content: 'ping' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    });

    await runLLMChat({ send: vi.fn() } as any, 'req-3', {
      projectId: 'project-1',
      sessionId: 'session-3',
      message: {
        id: 'message-3',
        content: 'ping',
      },
      overrides: {
        providerId: 'provider-2',
        model: 'model-2',
      },
    });

    expect(createDeepAgentRuntimeMock).toHaveBeenCalledWith(
      'project-1',
      'session-3',
      {
        id: 'message-3',
        content: 'ping',
      },
      undefined,
      {
        providerId: 'provider-2',
        model: 'model-2',
      }
    );
  });
});
