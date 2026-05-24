import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createDeepAgentRuntimeMock, dbPrepareMock } = vi.hoisted(() => ({
  createDeepAgentRuntimeMock: vi.fn(),
  dbPrepareMock: vi.fn(),
}));

vi.mock('./deepagent/runtime', () => ({
  DEEPAGENT_CHECKPOINT_NAMESPACE: 'cdf-master-runtime-v3',
  createDeepAgentRuntime: createDeepAgentRuntimeMock,
}));

vi.mock('./deepagent/llm-adapter', () => ({
  getOllamaBaseUrl: vi.fn((url: string) => url),
}));

vi.mock('./database', () => ({
  default: {
    prepare: dbPrepareMock,
  },
}));

import { RUN_OUTPUT_GRACE_MS, runLLMChat } from './llm';

describe('runLLMChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
