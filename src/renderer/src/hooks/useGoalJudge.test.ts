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
  sessionGoals: Map<string, string>;
  goalJudgeStatus: Map<string, any>;
  selectSession: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  getMessagesForSession: ReturnType<typeof vi.fn>;
  setGoalJudgeStatus: ReturnType<typeof vi.fn>;
  getGoalJudgeStatus: ReturnType<typeof vi.fn>;
  clearGoalJudgeStatus: ReturnType<typeof vi.fn>;
} = {
  activeSessionId: 'session-1',
  messages: [],
  isStreaming: false,
  sessionGoals: new Map(),
  goalJudgeStatus: new Map(),
  selectSession: vi.fn(async () => undefined),
  sendMessage: vi.fn(async () => undefined),
  getMessagesForSession: vi.fn((sessionId: string) => sessionId === 'session-1' ? mockState.messages : []),
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

// IPC mocks. We expose a `judgeChunkHandler` that tests can use to fire
// `message_chunk` / `message_done` events back through the onChunk callback
// the judge registered for its judgeRequestId.
let judgeChunkHandler: ((event: unknown, data: any) => void) | null = null;
let judgeChatMock: ReturnType<typeof vi.fn>;
const onChunkMock = vi.fn((_requestId: string, callback: (event: unknown, data: any) => void) => {
  judgeChunkHandler = callback;
  return () => {
    if (judgeChunkHandler === callback) judgeChunkHandler = null;
  };
});

const setupElectronAPI = () => {
  judgeChatMock = vi.fn(async () => {
    // Default: do nothing (tests that don't care about chat skip this)
  });
  (window as any).electronAPI = {
    llm: {
      chat: judgeChatMock,
      stopChat: vi.fn(),
      resolveApproval: vi.fn(),
      testProvider: vi.fn(),
      fetchProviderModels: vi.fn(),
      fetchOllamaModels: vi.fn(),
      onChunk: onChunkMock,
    },
  };
};

const fireJudgeChunk = (text: string, done: boolean = false) => {
  if (!judgeChunkHandler) throw new Error('judge onChunk handler not registered');
  judgeChunkHandler(null, { type: 'message_chunk', text });
  if (done) judgeChunkHandler(null, { type: 'message_done' });
};

// ===== Tests =====
describe('useGoalJudge (factory pattern — Issue 8 fix)', () => {
  beforeEach(() => {
    // Reset module-level mock state for isolation between tests.
    mockState.activeSessionId = 'session-1';
    mockState.messages = [];
    mockState.isStreaming = false;
    mockState.sessionGoals = new Map();
    mockState.goalJudgeStatus = new Map();
    mockState.selectSession.mockReset();
    mockState.selectSession.mockResolvedValue(undefined);
    mockState.sendMessage.mockReset();
    mockState.sendMessage.mockResolvedValue(undefined);
    mockState.getMessagesForSession.mockReset();
    mockState.getMessagesForSession.mockImplementation((sessionId: string) => sessionId === 'session-1' ? mockState.messages : []);
    mockState.setGoalJudgeStatus.mockReset();
    mockState.getGoalJudgeStatus.mockReset();
    mockState.clearGoalJudgeStatus.mockReset();
    subscriberBus.clear();
    mockSubscribe.mockClear();
    onChunkMock.mockClear();
    judgeChunkHandler = null;
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

  it('A: startGoalJudgeLoop calls electronAPI.llm.chat with judge prompt containing goal + last N turns', async () => {
    mockState.messages = [
      { role: 'user', content: '帮我把 README 翻译成英文' },
      { role: 'assistant', content: '好的，我先读 README.md' },
    ];
    let chatRequestId: string | null = null;
    judgeChatMock.mockImplementation(async (requestId: string) => {
      chatRequestId = requestId;
    });

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

    expect(judgeChatMock).toHaveBeenCalledTimes(1);
    expect(chatRequestId).toMatch(/^judge-/);
    const judgePayload = judgeChatMock.mock.calls[0][1];
    // payload.message.content is the prompt — must contain goal + recent turns
    const prompt: string = judgePayload?.message?.content ?? '';
    expect(prompt).toContain('翻译 README 到英文');
    expect(prompt).toContain('[user] 帮我把 README 翻译成英文');
    expect(prompt).toContain('[assistant] 好的，我先读 README.md');
  });

  it('B: judge returns {satisfied: true} → status transitions to satisfied, no further sendMessage', async () => {
    judgeChatMock.mockImplementation(async () => {
      // Fire the satisfied response
      setTimeout(() => fireJudgeChunk('{"satisfied":true,"reason":"已完成 README 翻译"}', true), 0);
    });

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

  it('C: judge returns {satisfied: false, reason} → sendMessage called with 继续：${reason}, iteration increments', async () => {
    judgeChatMock.mockImplementation(async () => {
      setTimeout(() => fireJudgeChunk('{"satisfied":false,"reason":"README 还有未翻译段落"}', true), 0);
    });

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

    // sendMessage called twice total (goal + 继续：...)
    expect(mockState.sendMessage).toHaveBeenCalledTimes(2);
    expect(mockState.sendMessage).toHaveBeenNthCalledWith(2, 'project-1', '继续：README 还有未翻译段落', undefined, 'session-1');

    // setGoalJudgeStatus with iteration 1 + reason
    const unsatisfiedCall = mockState.setGoalJudgeStatus.mock.calls.find(
      (c: any[]) => c[1]?.status === 'unsatisfied' && c[1]?.iteration === 1
    );
    expect(unsatisfiedCall).toBeTruthy();
  });

  it('D: after 20 unsatisfied returns → status transitions to paused, sonner.warning fired, no further sendMessage', async () => {
    // Pre-populate status to iteration 19 (i.e. one more unsatisfied = cap)
    const baseStatus: any = { status: 'unsatisfied', iteration: 19, startedAt: Date.now(), reason: '...' };
    mockState.goalJudgeStatus.set('session-1', baseStatus);
    mockState.getGoalJudgeStatus.mockImplementation((id: string) => mockState.goalJudgeStatus.get(id));

    judgeChatMock.mockImplementation(async () => {
      setTimeout(() => fireJudgeChunk('{"satisfied":false,"reason":"仍未完成"}', true), 0);
    });

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
    judgeChatMock.mockImplementation(async () => {
      setTimeout(
        () =>
          fireJudgeChunk(
            '<think>让我分析一下这个 goal 是否完成</think>\n{"satisfied":true,"reason":"已满足"}',
            true
          ),
        0
      );
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
    judgeChatMock.mockImplementation(async () => {
      setTimeout(() => fireJudgeChunk('this is not JSON at all', true), 0);
    });

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
});
