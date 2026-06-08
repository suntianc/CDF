// 08.2 P3 C1-05: /goal judge hook tests.
//
// Issue 8 fix: each test uses a fresh `testJudge = createGoalJudge()` so the
// module-level singleton state does not leak between cases.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';

// ===== Mocks =====
// Mockable sessionStore + projectStore. We expose mutable state and a
// subscribe bus that the judge hook subscribes to for isStreaming changes.
const mockState: {
  activeSessionId: string;
  messages: Array<{ role: string; content: string }>;
  isStreaming: boolean;
  pendingApproval: unknown | null;
  agentToolCalls: Array<{ status: string }>;
  sessionGoals: Map<string, string>;
  goalJudgeStatus: Map<string, any>;
  selectSession: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  getMessagesForSession: ReturnType<typeof vi.fn>;
  getIsSessionStreaming: ReturnType<typeof vi.fn>;
  setGoalJudgeStatus: ReturnType<typeof vi.fn>;
  getGoalJudgeStatus: ReturnType<typeof vi.fn>;
  clearGoalJudgeStatus: ReturnType<typeof vi.fn>;
} = {
  activeSessionId: 'session-1',
  messages: [],
  isStreaming: false,
  pendingApproval: null,
  agentToolCalls: [],
  sessionGoals: new Map(),
  goalJudgeStatus: new Map(),
  selectSession: vi.fn(async () => undefined),
  sendMessage: vi.fn(async () => undefined),
  getMessagesForSession: vi.fn((sessionId: string) => sessionId === 'session-1' ? mockState.messages : []),
  getIsSessionStreaming: vi.fn((sessionId: string) => sessionId === mockState.activeSessionId ? mockState.isStreaming : false),
  setGoalJudgeStatus: vi.fn(),
  getGoalJudgeStatus: vi.fn(),
  clearGoalJudgeStatus: vi.fn(),
};

// Subscribe bus — the hook subscribes to this; tests fire callbacks to
// simulate isStreaming true→false transitions. Zustand's `subscribe` invokes
// the listener with the current state, so we mirror that signature.
const subscriberBus = new Set<(s: typeof mockState) => void>();
const mockSubscribe = vi.fn((cb: (s: typeof mockState) => void) => {
  subscriberBus.add(cb);
  return () => subscriberBus.delete(cb);
});
const fireStateChange = () => {
  for (const cb of subscriberBus) cb(mockState);
};

vi.mock('@/stores/sessionStore', () => {
  // Use a Proxy so getters always reflect the current mockState reference.
  return {
    useSessionStore: {
      getState: () => mockState,
      subscribe: (cb: (s: typeof mockState) => void) => mockSubscribe(cb),
      setState: (partial: any) => {
        Object.assign(mockState, typeof partial === 'function' ? partial(mockState) : partial);
      },
    },
  };
});

vi.mock('@/stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({ currentProjectId: 'project-1' }),
  },
}));

// Sonner toast mock
const mockToastWarning = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    warning: (...args: unknown[]) => mockToastWarning(...args),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

let judgeMock: ReturnType<typeof vi.fn>;

const setupElectronAPI = () => {
  judgeMock = vi.fn(async () => ({ text: '{"satisfied":true,"reason":"默认已满足"}' }));
  (window as any).electronAPI = {
    llm: {
      chat: vi.fn(),
      judge: judgeMock,
      stopChat: vi.fn(),
      resolveApproval: vi.fn(),
      testProvider: vi.fn(),
      fetchProviderModels: vi.fn(),
      fetchOllamaModels: vi.fn(),
      onChunk: vi.fn(),
    },
  };
};

// ===== Tests =====
describe('useGoalJudge (factory pattern — Issue 8 fix)', () => {
  beforeEach(() => {
    // Reset module-level mock state for isolation between tests.
    mockState.activeSessionId = 'session-1';
    mockState.messages = [];
    mockState.isStreaming = false;
    mockState.pendingApproval = null;
    mockState.agentToolCalls = [];
    mockState.sessionGoals = new Map();
    mockState.goalJudgeStatus = new Map();
    mockState.selectSession.mockReset();
    mockState.selectSession.mockResolvedValue(undefined);
    mockState.sendMessage.mockReset();
    mockState.sendMessage.mockResolvedValue(undefined);
    mockState.getMessagesForSession.mockReset();
    mockState.getMessagesForSession.mockImplementation((sessionId: string) => sessionId === 'session-1' ? mockState.messages : []);
    mockState.getIsSessionStreaming.mockReset();
    mockState.getIsSessionStreaming.mockImplementation((sessionId: string) => sessionId === mockState.activeSessionId ? mockState.isStreaming : false);
    mockState.setGoalJudgeStatus.mockReset();
    mockState.getGoalJudgeStatus.mockReset();
    mockState.clearGoalJudgeStatus.mockReset();
    subscriberBus.clear();
    mockSubscribe.mockClear();
    mockToastWarning.mockReset();
    setupElectronAPI();
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  // Helper: start a fresh loop and return the instance.
  const startFresh = async (goal: string) => {
    // Lazy import so vi.mock hoisting applies before module evaluation.
    const { createGoalJudge } = await import('./useGoalJudge');
    const testJudge = createGoalJudge();
    await testJudge.startGoalJudgeLoop('session-1', goal);
    return testJudge;
  };

  it('A: startGoalJudgeLoop calls electronAPI.llm.judge with judge prompt containing goal + last N turns', async () => {
    mockState.messages = [
      { role: 'user', content: '帮我把 README 翻译成英文' },
      { role: 'assistant', content: '好的，我先读 README.md' },
    ];
    await startFresh('翻译 README 到英文');
    // First turn: sendMessage called with the goal
    expect(mockState.sendMessage).toHaveBeenCalledWith('project-1', '翻译 README 到英文', undefined, 'session-1');

    // Simulate main agent finished a turn (isStreaming true → false)
    mockState.isStreaming = true;
    fireStateChange();
    mockState.isStreaming = false;
    fireStateChange();

    // Wait microtask queue
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(judgeMock).toHaveBeenCalledTimes(1);
    const judgePayload = judgeMock.mock.calls[0][0];
    const prompt: string = judgePayload?.prompt ?? '';
    expect(prompt).toContain('翻译 README 到英文');
    expect(prompt).toContain('[user] 帮我把 README 翻译成英文');
    expect(prompt).toContain('[assistant] 好的，我先读 README.md');
  });

  it('B: judge returns {satisfied: true} → status transitions to satisfied, no further sendMessage', async () => {
    judgeMock.mockResolvedValue({ text: '{"satisfied":true,"reason":"已完成 README 翻译"}' });

    await startFresh('翻译 README');

    // First sendMessage = goal injection
    expect(mockState.sendMessage).toHaveBeenCalledTimes(1);

    // Simulate main agent turn completion
    mockState.isStreaming = true;
    fireStateChange();
    mockState.isStreaming = false;
    fireStateChange();

    // Wait for judgeOnce to resolve
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // setGoalJudgeStatus was called with status: 'satisfied'
    const statusCalls = mockState.setGoalJudgeStatus.mock.calls;
    const satisfiedCall = statusCalls.find((c: any[]) => c[1]?.status === 'satisfied');
    expect(satisfiedCall).toBeTruthy();
    expect(satisfiedCall![1].reason).toContain('已完成');

    // No further sendMessage (loop terminated)
    expect(mockState.sendMessage).toHaveBeenCalledTimes(1);
    // Terminal status is preserved so GoalSystemBubble can render the result.
    expect(mockState.clearGoalJudgeStatus).not.toHaveBeenCalled();
  });

  it('C: judge returns {satisfied: false, reason} → sends a hidden continue instruction and increments iteration', async () => {
    judgeMock.mockResolvedValue({ text: '{"satisfied":false,"reason":"README 还有未翻译段落"}' });

    await startFresh('翻译 README');
    expect(mockState.sendMessage).toHaveBeenCalledTimes(1); // goal injection

    // First turn completion
    mockState.isStreaming = true;
    fireStateChange();
    mockState.isStreaming = false;
    fireStateChange();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // sendMessage called twice total (goal + hidden continue)
    expect(mockState.sendMessage).toHaveBeenCalledTimes(2);
    expect(mockState.sendMessage).toHaveBeenNthCalledWith(
      2,
      'project-1',
      expect.stringContaining('README 还有未翻译段落'),
      undefined,
      'session-1',
      { hiddenUserMessage: true }
    );

    // setGoalJudgeStatus with iteration 1 + reason
    const unsatisfiedCall = mockState.setGoalJudgeStatus.mock.calls.find(
      (c: any[]) => c[1]?.status === 'unsatisfied' && c[1]?.iteration === 1
    );
    expect(unsatisfiedCall).toBeTruthy();
  });

  it('C2: does not judge when streaming stops with a running tool call', async () => {
    await startFresh('翻译 README');
    mockState.agentToolCalls = [{ status: 'running' }];

    mockState.isStreaming = true;
    fireStateChange();
    mockState.isStreaming = false;
    fireStateChange();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(judgeMock).not.toHaveBeenCalled();
  });

  it('D: after 20 unsatisfied returns → status transitions to paused, sonner.warning fired, no further sendMessage', async () => {
    // Pre-populate status to iteration 19 (i.e. one more unsatisfied = cap)
    const baseStatus: any = { status: 'unsatisfied', iteration: 19, startedAt: Date.now(), reason: '...' };
    mockState.goalJudgeStatus.set('session-1', baseStatus);
    mockState.getGoalJudgeStatus.mockImplementation((id: string) => mockState.goalJudgeStatus.get(id));

    judgeMock.mockResolvedValue({ text: '{"satisfied":false,"reason":"仍未完成"}' });

    await startFresh('goal');
    // First turn completion → judge called
    mockState.isStreaming = true;
    fireStateChange();
    mockState.isStreaming = false;
    fireStateChange();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // setGoalJudgeStatus with status='paused' at iteration 20
    const pausedCall = mockState.setGoalJudgeStatus.mock.calls.find(
      (c: any[]) => c[1]?.status === 'paused'
    );
    expect(pausedCall).toBeTruthy();
    expect(pausedCall![1].iteration).toBe(20);

    // sonner.warning was fired
    expect(mockToastWarning).toHaveBeenCalled();
    // No 'continue' sendMessage (only goal injection)
    expect(mockState.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('E: judge raw text contains <think>...</think> wrapper → JSON.parse succeeds after strip (P2 pitfall)', async () => {
    judgeMock.mockResolvedValue({
      text: '<think>让我分析一下这个 goal 是否完成</think>\n{"satisfied":true,"reason":"已满足"}',
    });

    await startFresh('goal');
    mockState.isStreaming = true;
    fireStateChange();
    mockState.isStreaming = false;
    fireStateChange();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // Status transitioned to satisfied (parse succeeded after strip)
    const satisfiedCall = mockState.setGoalJudgeStatus.mock.calls.find(
      (c: any[]) => c[1]?.status === 'satisfied'
    );
    expect(satisfiedCall).toBeTruthy();
  });

  it('F: judge raw text is invalid JSON → status transitions to failed, reason starts with "judge 失败："', async () => {
    judgeMock.mockResolvedValue({ text: 'this is not JSON at all' });

    await startFresh('goal');
    mockState.isStreaming = true;
    fireStateChange();
    mockState.isStreaming = false;
    fireStateChange();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const failedCall = mockState.setGoalJudgeStatus.mock.calls.find(
      (c: any[]) => c[1]?.status === 'failed'
    );
    expect(failedCall).toBeTruthy();
    expect(failedCall![1].reason).toMatch(/^judge 失败：/);
  });

  it('G: judge prompt includes summarized tool results and truncates large output', async () => {
    const hugeOutput = 'x'.repeat(5_000);
    mockState.messages = [
      { role: 'user', content: '实现功能' },
      { role: 'assistant', content: '<think>准备读文件</think>' },
      {
        role: 'system',
        content: JSON.stringify({
          type: 'tool',
          name: 'read_file',
          status: 'success',
          input: { path: '/src/App.tsx' },
          output: hugeOutput,
        }),
      },
      { role: 'assistant', content: '已经完成修改' },
    ];

    await startFresh('确认功能完成');
    mockState.isStreaming = true;
    fireStateChange();
    mockState.isStreaming = false;
    fireStateChange();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const judgePayload = judgeMock.mock.calls[0][0];
    const prompt: string = judgePayload?.prompt ?? '';
    expect(prompt).toContain('[tool] name=read_file status=success');
    expect(prompt).toContain('input={"path":"/src/App.tsx"}');
    expect(prompt).toContain('output=' + 'x'.repeat(220) + '...');
    expect(prompt).not.toContain(hugeOutput);
  });

  it('H: queues the next judge pass when continue streaming finishes during an active judge iteration', async () => {
    let releaseContinueSend: (() => void) | null = null;

    mockState.sendMessage.mockImplementation(async (_projectId, content) => {
      if (String(content).includes('当前未完成原因')) {
        mockState.isStreaming = true;
        fireStateChange();
        mockState.isStreaming = false;
        fireStateChange();

        // The false transition above happened while the first judge iteration
        // is still awaiting sendMessage(). It should be queued, not run
        // concurrently.
        expect(judgeMock).toHaveBeenCalledTimes(1);

        await new Promise<void>((resolve) => {
          releaseContinueSend = resolve as any;
        });
      }
    });

    judgeMock.mockImplementation(async () => {
      const response = judgeMock.mock.calls.length === 1
        ? '{"satisfied":false,"reason":"还需要继续"}'
        : '{"satisfied":true,"reason":"现在完成"}';
      return { text: response };
    });

    await startFresh('完成目标');

    mockState.isStreaming = true;
    fireStateChange();
    mockState.isStreaming = false;
    fireStateChange();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(judgeMock).toHaveBeenCalledTimes(1);
    expect(releaseContinueSend).toBeTruthy();
    (releaseContinueSend as any)?.();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(judgeMock).toHaveBeenCalledTimes(2);
    const satisfiedCall = mockState.setGoalJudgeStatus.mock.calls.find(
      (c: any[]) => c[1]?.status === 'satisfied'
    );
    expect(satisfiedCall).toBeTruthy();
  });

  it('I: parses the first JSON object when the judge adds prose around it', async () => {
    judgeMock.mockResolvedValue({
      text: 'The task is not done yet.\n{"satisfied":false,"reason":"核心文件还没写完"}\nExtra trailing note.',
    });

    await startFresh('完成目标');

    mockState.isStreaming = true;
    fireStateChange();
    mockState.isStreaming = false;
    fireStateChange();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const failedCall = mockState.setGoalJudgeStatus.mock.calls.find(
      (c: any[]) => c[1]?.status === 'failed'
    );
    expect(failedCall).toBeFalsy();
    const unsatisfiedCall = mockState.setGoalJudgeStatus.mock.calls.find(
      (c: any[]) => c[1]?.status === 'unsatisfied' && c[1]?.reason === '核心文件还没写完'
    );
    expect(unsatisfiedCall).toBeTruthy();
  });

  it('J: watches target session streaming, not the active session global flag', async () => {
    const streamingBySession = new Map<string, boolean>();
    mockState.activeSessionId = 'active-session';
    mockState.getIsSessionStreaming.mockImplementation((sessionId: string) => streamingBySession.get(sessionId) ?? false);
    judgeMock.mockResolvedValue({ text: '{"satisfied":true,"reason":"目标线程已完成"}' });

    await startFresh('完成后台线程目标');

    streamingBySession.set('session-1', true);
    mockState.isStreaming = false;
    fireStateChange();
    streamingBySession.set('session-1', false);
    fireStateChange();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(judgeMock).toHaveBeenCalledTimes(1);
    const satisfiedCall = mockState.setGoalJudgeStatus.mock.calls.find(
      (c: any[]) => c[1]?.status === 'satisfied'
    );
    expect(satisfiedCall).toBeTruthy();
  });
});
