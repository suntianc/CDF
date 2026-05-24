import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createDeepAgentRuntimeMock, persistSessionSummaryMock, extractSummaryFromStateMock } = vi.hoisted(() => ({
  createDeepAgentRuntimeMock: vi.fn(),
  persistSessionSummaryMock: vi.fn(),
  extractSummaryFromStateMock: vi.fn(),
}));

vi.mock('./deepagent/runtime', () => ({
  createDeepAgentRuntime: createDeepAgentRuntimeMock,
  persistSessionSummary: persistSessionSummaryMock,
  extractSummaryFromState: extractSummaryFromStateMock,
}));

vi.mock('./deepagent/llm-adapter', () => ({
  getOllamaBaseUrl: vi.fn((url: string) => url),
}));

import { runLLMChat } from './llm';

describe('runLLMChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should stream assistant tokens and persist summary when runtime completes', async () => {
    createDeepAgentRuntimeMock.mockResolvedValue({
      agent: {
        streamEvents: vi.fn().mockResolvedValue({
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
        }),
      },
      inputMessages: [{ role: 'user', content: 'ping' }],
      cleanup: vi.fn(),
    });
    extractSummaryFromStateMock.mockReturnValue('summary');

    const send = vi.fn();
    await runLLMChat({ send } as any, 'req-1', {
      projectId: 'project-1',
      sessionId: 'session-1',
    });

    expect(createDeepAgentRuntimeMock).toHaveBeenCalledWith(
      'project-1',
      'session-1',
      undefined
    );
    expect(send).toHaveBeenNthCalledWith(1, 'llm:chunk-req-1', { type: 'message_chunk', text: '收' });
    expect(send).toHaveBeenNthCalledWith(2, 'llm:chunk-req-1', { type: 'message_chunk', text: '到' });
    expect(send).toHaveBeenLastCalledWith('llm:chunk-req-1', { type: 'message_done' });
    expect(persistSessionSummaryMock).toHaveBeenCalledWith('session-1', 'summary');
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
      cleanup: vi.fn(),
    });
    extractSummaryFromStateMock.mockReturnValue(null);

    const send = vi.fn();
    await runLLMChat({ send } as any, 'req-2', {
      projectId: 'project-1',
      sessionId: 'session-2',
    });

    expect(send).toHaveBeenCalledWith('llm:chunk-req-2', { type: 'tool_start', name: 'tool-a', input: { x: 1 } });
    expect(send).toHaveBeenCalledWith('llm:chunk-req-2', { type: 'tool_end', name: 'tool-a', output: 'ok' });
    expect(send).toHaveBeenCalledWith('llm:chunk-req-2', { type: 'tool_start', name: 'tool-b', input: { y: 2 } });
    expect(send).toHaveBeenCalledWith('llm:chunk-req-2', { type: 'tool_error', name: 'tool-b', error: 'boom' });
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
      cleanup: vi.fn(),
    });
    extractSummaryFromStateMock.mockReturnValue(null);

    await runLLMChat({ send: vi.fn() } as any, 'req-3', {
      projectId: 'project-1',
      sessionId: 'session-3',
      overrides: {
        providerId: 'provider-2',
        model: 'model-2',
      },
    });

    expect(createDeepAgentRuntimeMock).toHaveBeenCalledWith(
      'project-1',
      'session-3',
      {
        providerId: 'provider-2',
        model: 'model-2',
      }
    );
  });
});
