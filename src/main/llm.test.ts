import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createDeepAgentRuntimeMock, dbPrepareMock, modelCaptureMock } = vi.hoisted(() => ({
  createDeepAgentRuntimeMock: vi.fn(),
  dbPrepareMock: vi.fn(),
  modelCaptureMock: new WeakMap<object, { reasoningText: string; normalText: string }>(),
}));

vi.mock('./deepagent/runtime', () => ({
  DEEPAGENT_CHECKPOINT_NAMESPACE: '',
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
    exec: vi.fn(),
  },
}));

import { resolveLLMApproval, runLLMChat, stopLLMChat } from './llm';
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
          checkpoint_ns: '',
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

  it('should not complete before run.output resolves after streams finish', async () => {
    vi.useFakeTimers();
    let resolveOutput!: (value: unknown) => void;
    const output = new Promise((resolve) => {
      resolveOutput = resolve;
    });
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
          output,
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

    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledWith('llm:chunk-req-hang', { type: 'message_chunk', text: '<think>' });
    expect(send).toHaveBeenCalledWith('llm:chunk-req-hang', { type: 'message_chunk', text: '需要先查找 README。' });
    expect(send).toHaveBeenCalledWith('llm:chunk-req-hang', { type: 'message_chunk', text: '</think>\n\n' });
    expect(send).toHaveBeenCalledWith('llm:chunk-req-hang', { type: 'message_chunk', text: '我来读取。' });
    expect(send).not.toHaveBeenCalledWith('llm:chunk-req-hang', { type: 'message_done' });

    resolveOutput({});
    await promise;

    expect(send).toHaveBeenLastCalledWith('llm:chunk-req-hang', { type: 'message_done' });
  });

  it('should emit approval request when output contains an interrupt', async () => {
    const firstRun = {
      messages: (async function* () {})(),
      toolCalls: (async function* () {})(),
      output: Promise.resolve({
        __interrupt__: [
          {
            value: {
              actionRequests: [
                {
                  name: 'write_file',
                  args: { file_path: '/test.txt', content: 'hello' },
                  description: 'Tool execution requires approval',
                },
              ],
              reviewConfigs: [
                {
                  actionName: 'write_file',
                  allowedDecisions: ['approve', 'edit', 'reject'],
                },
              ],
            },
          },
        ],
      }),
    };
    const secondRun = {
      messages: (async function* () {})(),
      toolCalls: (async function* () {})(),
      output: Promise.resolve({}),
    };
    const streamEvents = vi.fn()
      .mockResolvedValueOnce(firstRun)
      .mockResolvedValueOnce(secondRun);
    createDeepAgentRuntimeMock.mockResolvedValue({
      agent: {
        streamEvents,
      },
      inputMessages: [{ role: 'user', content: '写文件' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    });

    const send = vi.fn();
    const promise = runLLMChat({ send } as any, 'req-approval', {
      projectId: 'project-1',
      sessionId: 'session-approval',
      message: {
        id: 'message-approval',
        content: '写文件',
      },
    });

    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        'llm:chunk-req-approval',
        expect.objectContaining({ type: 'approval_required' })
      );
    });
    const approvalEvent = send.mock.calls.find(([, payload]) => payload.type === 'approval_required')?.[1];
    expect(approvalEvent.approval.actions).toEqual([
      {
        name: 'write_file',
        args: { file_path: '/test.txt', content: 'hello' },
        description: 'Tool execution requires approval',
        allowedDecisions: ['approve', 'edit', 'reject'],
      },
    ]);

    resolveLLMApproval('req-approval', {
      approvalId: approvalEvent.approval.id,
      decisions: [{ type: 'approve' }],
    });
    await promise;

    expect(send).toHaveBeenCalledWith(
      'llm:chunk-req-approval',
      expect.objectContaining({ type: 'run_updated', status: 'waiting_approval' })
    );
    expect(send).toHaveBeenCalledWith(
      'llm:chunk-req-approval',
      expect.objectContaining({ type: 'approval_resolved', status: 'approved' })
    );
    expect(streamEvents).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('llm:chunk-req-approval', { type: 'message_done' });
  });

  it('should emit approval request from stream interrupt payload fallback', async () => {
    const interruptPayload = {
      actionRequests: [
        {
          name: 'edit_file',
          args: { file_path: '/test.txt', old_string: 'a', new_string: 'b' },
          description: 'Tool execution requires approval',
        },
      ],
      reviewConfigs: [
        {
          actionName: 'edit_file',
          allowedDecisions: ['approve', 'edit', 'reject'],
        },
      ],
    };
    const streamEvents = vi.fn()
      .mockResolvedValueOnce({
        messages: (async function* () {})(),
        toolCalls: (async function* () {})(),
        output: new Promise(() => {}),
        interrupts: [{ interruptId: 'interrupt-1', payload: interruptPayload }],
      })
      .mockResolvedValueOnce({
        messages: (async function* () {})(),
        toolCalls: (async function* () {})(),
        output: Promise.resolve({}),
        interrupts: [],
      });
    createDeepAgentRuntimeMock.mockResolvedValue({
      agent: {
        streamEvents,
      },
      inputMessages: [{ role: 'user', content: '改文件' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    });

    const send = vi.fn();
    const promise = runLLMChat({ send } as any, 'req-interrupt-payload', {
      projectId: 'project-1',
      sessionId: 'session-interrupt-payload',
      message: {
        id: 'message-interrupt-payload',
        content: '改文件',
      },
    });

    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        'llm:chunk-req-interrupt-payload',
        expect.objectContaining({ type: 'approval_required' })
      );
    });
    const approvalEvent = send.mock.calls.find(([, payload]) => payload.type === 'approval_required')?.[1];
    expect(approvalEvent.approval.actions[0]).toEqual({
      name: 'edit_file',
      args: { file_path: '/test.txt', old_string: 'a', new_string: 'b' },
      description: 'Tool execution requires approval',
      allowedDecisions: ['approve', 'edit', 'reject'],
    });

    resolveLLMApproval('req-interrupt-payload', {
      approvalId: approvalEvent.approval.id,
      decisions: [{ type: 'approve' }],
    });
    await promise;

    expect(send).toHaveBeenCalledWith(
      'llm:chunk-req-interrupt-payload',
      expect.objectContaining({ type: 'approval_resolved', status: 'approved' })
    );
  });

  it('should complete from lifecycle when output stays pending after streams finish', async () => {
    createDeepAgentRuntimeMock.mockResolvedValue({
      agent: {
        streamEvents: vi.fn().mockResolvedValue({
          messages: (async function* () {
            yield {
              text: (async function* () {
                yield '完成了';
              })(),
            };
          })(),
          toolCalls: (async function* () {})(),
          lifecycle: (async function* () {
            yield { namespace: [], event: 'completed' };
          })(),
          output: new Promise(() => {}),
          interrupts: [],
        }),
      },
      inputMessages: [{ role: 'user', content: '收尾' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    });

    const send = vi.fn();
    await runLLMChat({ send } as any, 'req-lifecycle-complete', {
      projectId: 'project-1',
      sessionId: 'session-lifecycle-complete',
      message: {
        id: 'message-lifecycle-complete',
        content: '收尾',
      },
    });

    expect(send).toHaveBeenCalledWith('llm:chunk-req-lifecycle-complete', { type: 'message_chunk', text: '完成了' });
    expect(send).toHaveBeenCalledWith(
      'llm:chunk-req-lifecycle-complete',
      expect.objectContaining({ type: 'run_updated', status: 'completed' })
    );
    expect(send).toHaveBeenLastCalledWith('llm:chunk-req-lifecycle-complete', { type: 'message_done' });
  });

  it('should abort a run while waiting for pending output', async () => {
    createDeepAgentRuntimeMock.mockResolvedValue({
      agent: {
        streamEvents: vi.fn().mockResolvedValue({
          messages: (async function* () {
            yield {
              text: (async function* () {
                yield '等待中';
              })(),
            };
          })(),
          toolCalls: (async function* () {})(),
          output: new Promise(() => {}),
          interrupts: [],
        }),
      },
      inputMessages: [{ role: 'user', content: '停止测试' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    });

    const send = vi.fn();
    const promise = runLLMChat({ send } as any, 'req-stop-output', {
      projectId: 'project-1',
      sessionId: 'session-stop-output',
      message: {
        id: 'message-stop-output',
        content: '停止测试',
      },
    });

    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith('llm:chunk-req-stop-output', { type: 'message_chunk', text: '等待中' });
    });
    stopLLMChat('req-stop-output');
    await promise;

    expect(send).toHaveBeenCalledWith(
      'llm:chunk-req-stop-output',
      expect.objectContaining({ type: 'run_updated', status: 'aborted' })
    );
    expect(send).not.toHaveBeenCalledWith(
      'llm:chunk-req-stop-output',
      expect.objectContaining({ type: 'run_updated', status: 'completed' })
    );
    expect(send).toHaveBeenLastCalledWith('llm:chunk-req-stop-output', { type: 'message_done' });
  });

  it('should flush cached text when stream events expose reasoning but no text', async () => {
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
          output: Promise.resolve({}),
          interrupts: [],
        }),
      },
      inputMessages: [{ role: 'user', content: '看一下目录' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    });

    const send = vi.fn();
    await runLLMChat({ send } as any, 'req-cached-text', {
      projectId: 'project-1',
      sessionId: 'session-cached-text',
      message: {
        id: 'message-cached-text',
        content: '看一下目录',
      },
    });

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
          output: Promise.resolve({}),
          interrupts: [],
        }),
      },
      model,
      inputMessages: [{ role: 'user', content: 'ping' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    });

    const send = vi.fn();
    await runLLMChat({ send } as any, 'req-model-reasoning', {
      projectId: 'project-1',
      sessionId: 'session-model-reasoning',
      message: {
        id: 'message-model-reasoning',
        content: 'ping',
      },
    });

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

  it('should stream todos_update event when agent state contains todos', async () => {
    const streamEvents = vi.fn().mockResolvedValue({
      messages: (async function* () {
        yield {
          text: (async function* () {
            yield 'Hello';
          })(),
        };
      })(),
      toolCalls: (async function* () {})(),
      output: Promise.resolve({ state: 'done' }),
    });

    const getState = vi.fn().mockResolvedValue({
      values: {
        todos: [
          { content: 'Step 1', status: 'completed' },
          { content: 'Step 2', status: 'in_progress' },
          { content: 'Step 3', status: 'pending' },
        ],
      },
    });

    createDeepAgentRuntimeMock.mockResolvedValue({
      agent: {
        streamEvents,
        getState,
      },
      inputMessages: [{ role: 'user', content: 'run plan' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    });

    const send = vi.fn();
    await runLLMChat({ send } as any, 'req-4', {
      projectId: 'project-1',
      sessionId: 'session-4',
      message: {
        id: 'message-4',
        content: 'run plan',
      },
    });

    expect(getState).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('llm:chunk-req-4', {
      type: 'todos_update',
      todos: [
        { content: 'Step 1', status: 'completed' },
        { content: 'Step 2', status: 'in_progress' },
        { content: 'Step 3', status: 'pending' },
      ],
    });
  });

  it('should refresh todos immediately after tool completion', async () => {
    const streamEvents = vi.fn().mockResolvedValue({
      messages: (async function* () {})(),
      toolCalls: (async function* () {
        yield { callId: 'tool-1', name: 'write_file', input: { path: '/a.txt' }, output: Promise.resolve('ok') };
      })(),
      values: (async function* () {
        yield {
          todos: [
            { content: 'Write file', status: 'completed' },
            { content: 'Summarize result', status: 'in_progress' },
          ],
        };
      })(),
      output: Promise.resolve({ state: 'done' }),
    });

    createDeepAgentRuntimeMock.mockResolvedValue({
      agent: {
        streamEvents,
      },
      inputMessages: [{ role: 'user', content: 'run plan' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    });

    const send = vi.fn();
    await runLLMChat({ send } as any, 'req-tool-todos', {
      projectId: 'project-1',
      sessionId: 'session-tool-todos',
      message: {
        id: 'message-tool-todos',
        content: 'run plan',
      },
    });

    expect(send).toHaveBeenCalledWith('llm:chunk-req-tool-todos', {
      type: 'todos_update',
      todos: [
        { content: 'Write file', status: 'completed' },
        { content: 'Summarize result', status: 'in_progress' },
      ],
    });
  });

  it('should push todos_update via run.values event stream', async () => {
    const streamEvents = vi.fn().mockResolvedValue({
      messages: (async function* () {
        yield {
          text: (async function* () {
            yield 'done';
          })(),
        };
      })(),
      toolCalls: (async function* () {})(),
      values: (async function* () {
        yield { todos: [{ content: 'Step A', status: 'in_progress' }] };
        yield { todos: [{ content: 'Step A', status: 'completed' }, { content: 'Step B', status: 'in_progress' }] };
      })(),
      output: Promise.resolve({ state: 'done' }),
    });

    createDeepAgentRuntimeMock.mockResolvedValue({
      agent: {
        streamEvents,
      },
      inputMessages: [{ role: 'user', content: 'run with values' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    });

    const send = vi.fn();
    await runLLMChat({ send } as any, 'req-values-1', {
      projectId: 'project-1',
      sessionId: 'session-values-1',
      message: {
        id: 'message-values-1',
        content: 'run with values',
      },
    });

    expect(send).toHaveBeenCalledWith('llm:chunk-req-values-1', {
      type: 'todos_update',
      todos: [{ content: 'Step A', status: 'in_progress' }],
    });
    expect(send).toHaveBeenCalledWith('llm:chunk-req-values-1', {
      type: 'todos_update',
      todos: [{ content: 'Step A', status: 'completed' }, { content: 'Step B', status: 'in_progress' }],
    });
  });

  it('should stop run.values iteration when signal is aborted', async () => {
    let resolveOutput!: (value: unknown) => void;
    const output = new Promise((resolve) => {
      resolveOutput = resolve;
    });

    const valuesChunks: Array<{ todos: Array<{ content: string; status: string }> }> = [];
    let valuesResolve!: () => void;
    const valuesDone = new Promise<void>((resolve) => {
      valuesResolve = resolve;
    });

    const streamEvents = vi.fn().mockResolvedValue({
      messages: (async function* () {})(),
      toolCalls: (async function* () {})(),
      values: (async function* () {
        yield { todos: [{ content: 'Before abort', status: 'in_progress' }] };
        await new Promise(() => {}); // hang until aborted
      })(),
      output,
      interrupts: [],
    });

    createDeepAgentRuntimeMock.mockResolvedValue({
      agent: {
        streamEvents,
      },
      inputMessages: [{ role: 'user', content: 'abort test' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    });

    const send = vi.fn();
    const promise = runLLMChat({ send } as any, 'req-values-abort', {
      projectId: 'project-1',
      sessionId: 'session-values-abort',
      message: {
        id: 'message-values-abort',
        content: 'abort test',
      },
    });

    // Wait for the first todos_update to be sent
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith('llm:chunk-req-values-abort', {
        type: 'todos_update',
        todos: [{ content: 'Before abort', status: 'in_progress' }],
      });
    });

    stopLLMChat('req-values-abort');
    resolveOutput({});
    await promise;

    expect(send).toHaveBeenCalledWith(
      'llm:chunk-req-values-abort',
      expect.objectContaining({ type: 'run_updated', status: 'aborted' })
    );
  });

  it('should deduplicate todos in run.values when todosJson has not changed', async () => {
    const streamEvents = vi.fn().mockResolvedValue({
      messages: (async function* () {
        yield {
          text: (async function* () {
            yield 'ok';
          })(),
        };
      })(),
      toolCalls: (async function* () {})(),
      values: (async function* () {
        yield { todos: [{ content: 'Same', status: 'pending' }] };
        yield { todos: [{ content: 'Same', status: 'pending' }] }; // duplicate
        yield { todos: [{ content: 'Same', status: 'completed' }] }; // changed
      })(),
      output: Promise.resolve({ state: 'done' }),
    });

    createDeepAgentRuntimeMock.mockResolvedValue({
      agent: {
        streamEvents,
      },
      inputMessages: [{ role: 'user', content: 'dedup test' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    });

    const send = vi.fn();
    await runLLMChat({ send } as any, 'req-values-dedup', {
      projectId: 'project-1',
      sessionId: 'session-values-dedup',
      message: {
        id: 'message-values-dedup',
        content: 'dedup test',
      },
    });

    const todosUpdates = send.mock.calls.filter(
      ([channel, payload]) => channel === 'llm:chunk-req-values-dedup' && payload.type === 'todos_update'
    );
    // Should have 2 unique todos_update events, not 3
    expect(todosUpdates).toHaveLength(2);
    expect(todosUpdates[0][1].todos).toEqual([{ content: 'Same', status: 'pending' }]);
    expect(todosUpdates[1][1].todos).toEqual([{ content: 'Same', status: 'completed' }]);
  });

  it('should not send todos_update from run.values when values has no todos field', async () => {
    const streamEvents = vi.fn().mockResolvedValue({
      messages: (async function* () {
        yield {
          text: (async function* () {
            yield 'ok';
          })(),
        };
      })(),
      toolCalls: (async function* () {})(),
      values: (async function* () {
        yield { someOtherField: 'value' };
        yield {};
      })(),
      output: Promise.resolve({ state: 'done' }),
    });

    createDeepAgentRuntimeMock.mockResolvedValue({
      agent: {
        streamEvents,
      },
      inputMessages: [{ role: 'user', content: 'no todos' }],
      agentId: 'agent-1',
      cleanup: vi.fn(),
    });

    const send = vi.fn();
    await runLLMChat({ send } as any, 'req-values-no-todos', {
      projectId: 'project-1',
      sessionId: 'session-values-no-todos',
      message: {
        id: 'message-values-no-todos',
        content: 'no todos',
      },
    });

    const todosUpdates = send.mock.calls.filter(
      ([channel, payload]) => channel === 'llm:chunk-req-values-no-todos' && payload.type === 'todos_update'
    );
    expect(todosUpdates).toHaveLength(0);
  });
});
