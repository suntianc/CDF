// #107 差分验证驱动器：把三条真机流（普通对话 / 委派任务 / 审批中断）
// 以脚本化 runtime 喂给 runLLMChat，捕获完整 renderer 事件时间线写入 JSON。
// 在新旧两版实现上各跑一次，diff 时间线 => 字节级等价证明。
// 运行后由 scripts 对比：VERIFY_OUT 环境变量指定输出路径。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';

const {
  createDeepAgentRuntimeMock,
  resetDeepAgentRuntimeThreadMock,
  dbPrepareMock,
  subagentStepContextRef,
} = vi.hoisted(() => ({
  createDeepAgentRuntimeMock: vi.fn(),
  resetDeepAgentRuntimeThreadMock: vi.fn(),
  dbPrepareMock: vi.fn(),
  subagentStepContextRef: { current: null as { onStep: (step: unknown) => void } | null },
}));

vi.mock('./deepagent/runtime', async () => ({
  DELEGATED_TASK_RESULT_SCHEMA: (await vi.importActual<typeof import('../shared/types')>('../shared/types')).DELEGATED_TASK_RESULT_SCHEMA,
  DEEPAGENT_CHECKPOINT_NAMESPACE: '',
  createDeepAgentRuntime: createDeepAgentRuntimeMock,
  resetDeepAgentRuntimeThread: resetDeepAgentRuntimeThreadMock,
  subagentStepStorage: {
    run: async (context: { onStep: (step: unknown) => void }, callback: () => unknown) => {
      const previous = subagentStepContextRef.current;
      subagentStepContextRef.current = context;
      try {
        return await callback();
      } finally {
        subagentStepContextRef.current = previous;
      }
    },
    getStore: () => subagentStepContextRef.current,
  },
}));

vi.mock('./deepagent/llm-adapter', () => ({
  getOllamaBaseUrl: vi.fn((url: string) => url),
  takeModelReasoningCapture: vi.fn(() => ''),
  takeModelTextCapture: vi.fn(() => ''),
}));

vi.mock('./database', () => ({
  default: {
    prepare: dbPrepareMock,
    exec: vi.fn(),
  },
}));

import { resolveLLMApproval, runLLMChat } from './llm';

type TimelineEntry = { channel: string; event: unknown };
const timelines: Record<string, TimelineEntry[]> = {};

function makeCollector(scenario: string) {
  timelines[scenario] = [];
  return {
    send: (channel: string, event: unknown) => {
      timelines[scenario].push({ channel, event });
    },
  };
}

function makeRuntime(streamEvents: ReturnType<typeof vi.fn>) {
  return {
    agent: { streamEvents },
    inputMessages: [{ role: 'user', content: 'go' }],
    agentId: 'agent-verify',
    model: {},
    queueDelegatedRun: (
      _parentRunId: string,
      taskToolCallId: string,
      targetAgentSlug: string,
      goal: string,
    ) => ({
      id: `delegated:${taskToolCallId}`,
      target_agent_slug: targetAgentSlug,
      target_agent_name: 'Coder Agent',
      goal,
    }),
    cleanup: vi.fn(),
    skillAttributions: [],
  };
}

describe('#107 stream flow verification timelines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subagentStepContextRef.current = null;
    let uuidSeq = 0;
    vi.spyOn(crypto, 'randomUUID').mockImplementation(
      () => `uuid-${++uuidSeq}` as `${string}-${string}-${string}-${string}-${string}`,
    );
    dbPrepareMock.mockImplementation((sql: string) => ({
      run: vi.fn(),
      all: vi.fn(() => {
        if (sql.includes('FROM agent_tool_calls') && sql.includes("status = 'running'")) {
          return [{ id: 'running-tool-1', tool_name: 'write_file' }];
        }
        return [];
      }),
      get: () => {
        if (sql.includes('FROM agent_runs')) return { id: 'run-verify' };
        if (sql.includes('FROM agents')) return { name: 'Coder Agent' };
        return undefined;
      },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('flow 1: normal chat with streamed reasoning + backpressured text', async () => {
    const streamEvents = vi.fn().mockResolvedValue({
      messages: (async function* () {
        yield {
          reasoning: (async function* () {
            yield '想一下';
            await Promise.resolve();
            yield '再想想';
          })(),
          text: (async function* () {
            yield '正文A';
            yield '正文B';
          })(),
        };
      })(),
      toolCalls: (async function* () {})(),
      output: Promise.resolve({
        messages: [{ role: 'assistant', content: '正文A正文B' }],
      }),
    });
    createDeepAgentRuntimeMock.mockResolvedValue(makeRuntime(streamEvents));

    await runLLMChat(makeCollector('flow1-normal-chat') as never, 'req-f1', {
      projectId: 'p',
      sessionId: 's1',
      message: { id: 'm1', content: 'hi' },
    });

    expect(timelines['flow1-normal-chat'].length).toBeGreaterThan(3);
  });

  it('flow 2: delegated task with durable identity and standard result', async () => {
    const taskResult = JSON.stringify({ status: 'success', artifacts: [], summary: '任务完成' });
    const streamEvents = vi.fn().mockResolvedValue({
      messages: (async function* () {})(),
      toolCalls: (async function* () {
        yield {
          callId: 'task-call-1',
          name: 'task',
          input: { subagent_type: 'coder', task: JSON.stringify({ name: 'coder', goal: '写代码' }) },
          output: Promise.resolve(taskResult),
        };
      })(),
      output: Promise.resolve({ messages: [{ role: 'assistant', content: '已委派' }] }),
    });
    createDeepAgentRuntimeMock.mockResolvedValue(makeRuntime(streamEvents));

    await runLLMChat(makeCollector('flow2-delegated-task') as never, 'req-f2', {
      projectId: 'p',
      sessionId: 's2',
      message: { id: 'm2', content: 'delegate' },
    });

    expect(timelines['flow2-delegated-task'].length).toBeGreaterThan(3);
  });

  const approvalPayload = [
    {
      id: 'approval-1',
      value: {
        actionRequests: [
          {
            name: 'write_file',
            args: { file_path: '/tmp/x.ts', content: 'x' },
            description: 'Tool execution requires approval',
          },
        ],
        reviewConfigs: [
          { actionName: 'write_file', allowedDecisions: ['approve', 'edit', 'reject'] },
        ],
      },
    },
  ];

  function approvalScenario(requestId: string, decisions: Array<{ type: string }>) {
    const streamEvents = vi.fn()
      .mockResolvedValueOnce({
        messages: (async function* () {})(),
        toolCalls: (async function* () {})(),
        output: Promise.resolve({ __interrupt__: approvalPayload }),
      })
      .mockResolvedValueOnce({
        messages: (async function* () {
          yield {
            text: (async function* () {
              yield '恢复后的回复';
            })(),
          };
        })(),
        toolCalls: (async function* () {})(),
        output: Promise.resolve({ messages: [{ role: 'assistant', content: '恢复后的回复' }] }),
      });
    createDeepAgentRuntimeMock.mockResolvedValue(makeRuntime(streamEvents));

    const collector = makeCollector(requestId);
    const originalSend = collector.send;
    collector.send = (channel: string, event: unknown) => {
      originalSend(channel, event);
      const typed = event as { type?: string; approval?: { id: string } };
      if (typed.type === 'approval_required' && typed.approval) {
        setTimeout(() => {
          resolveLLMApproval(requestId.replace('flow', 'req-f'), {
            approvalId: typed.approval!.id,
            decisions: decisions as never,
          } as never);
        }, 0);
      }
    };
    return collector;
  }

  it('flow 3: approval interrupt then approve resumes the run', async () => {
    const collector = approvalScenario('flow3-approval-approve', [{ type: 'approve' }]);
    await runLLMChat(collector as never, 'req-f3-approval-approve', {
      projectId: 'p',
      sessionId: 's3',
      message: { id: 'm3', content: 'do risky thing' },
    });
    expect(timelines['flow3-approval-approve'].length).toBeGreaterThan(3);
  });

  it('flow 4: approval interrupt then reject skips running tools', async () => {
    const collector = approvalScenario('flow4-approval-reject', [{ type: 'reject' }]);
    await runLLMChat(collector as never, 'req-f4-approval-reject', {
      projectId: 'p',
      sessionId: 's4',
      message: { id: 'm4', content: 'do risky thing' },
    });
    expect(timelines['flow4-approval-reject'].length).toBeGreaterThan(3);
  });

  it('writes timelines to VERIFY_OUT', () => {
    const out = process.env.VERIFY_OUT;
    if (out) {
      fs.writeFileSync(out, JSON.stringify(timelines, null, 2));
    }
    expect(Object.keys(timelines)).toHaveLength(4);
  });
});