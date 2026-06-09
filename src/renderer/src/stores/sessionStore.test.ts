import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from './sessionStore';

describe('sessionStore sendMessage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    useSessionStore.setState({
      sessions: [
        {
          id: 'session-1',
          project_id: 'project-1',
          name: 'Test Session',
          parent_session_id: null,
          summary: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ],
      activeSessionId: 'session-1',
      messages: [],
      isStreaming: false,
      streamingMessageId: null,
      error: null,
    });
  });

  it('should register stream listener before starting llm chat', async () => {
    const saveMessage = vi.fn(async (message) => message);
    const getMessages = vi.fn(async () => []);
    let chunkListener: ((event: unknown, data: any) => void) | null = null;

    window.electronAPI = {
      store: {
        get: vi.fn(),
        set: vi.fn(),
      },
      db: {
        getProjects: vi.fn(),
        createProject: vi.fn(),
        deleteProject: vi.fn(),
        getSessions: vi.fn(),
        createSession: vi.fn(),
        deleteSession: vi.fn(),
        getMessages,
        saveMessage,
        getProviders: vi.fn(),
        saveProvider: vi.fn(),
        deleteProvider: vi.fn(),
        setActiveProvider: vi.fn(),
        selectDirectory: vi.fn(),
      },
      llm: {
        chat: vi.fn(async () => {
          expect(chunkListener).toBeTypeOf('function');
          await chunkListener?.(null, { type: 'message_chunk', text: '你好，' });
          await chunkListener?.(null, { type: 'tool_start', name: 'test_tool', input: { arg: 1 } });
          await chunkListener?.(null, { type: 'tool_end', name: 'test_tool', output: 'success_output' });
          await chunkListener?.(null, { type: 'message_chunk', text: '世界' });
          await chunkListener?.(null, { type: 'message_done' });
        }),
        judge: vi.fn(),
        stopChat: vi.fn(),
        testProvider: vi.fn(),
        fetchProviderModels: vi.fn(),
        fetchOllamaModels: vi.fn(),
        onChunk: vi.fn((_requestId, callback) => {
          chunkListener = callback;
          return () => {
            chunkListener = null;
          };
        }),
      },
      platform: 'darwin',
    };

    await useSessionStore.getState().sendMessage('project-1', '测试消息');

    const state = useSessionStore.getState();
    expect(window.electronAPI.llm.onChunk).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.llm.chat).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.llm.chat).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        projectId: 'project-1',
        sessionId: 'session-1',
        message: expect.objectContaining({
          content: '测试消息',
        }),
      })
    );
    // 5次：userMsg(1) + prevAssistantMsg("你好，")(2) + tool_start(3) + tool_end(4) + finalAssistantMsg("世界")(5)
    expect(saveMessage).toHaveBeenCalledTimes(5);
    expect(state.isStreaming).toBe(false);
    expect(state.streamingMessageId).toBe(null);
    expect(state.error).toBe(null);
    
    expect(state.messages).toHaveLength(4);
    // User message
    expect(state.messages[0].role).toBe('user');
    expect(state.messages[0].content).toBe('测试消息');
    // First Assistant message segment ("你好，")
    expect(state.messages[1].role).toBe('assistant');
    expect(state.messages[1].content).toBe('你好，');
    // Tool message (JSON formatted)
    expect(state.messages[2].role).toBe('system');
    const parsedTool = JSON.parse(state.messages[2].content);
    expect(parsedTool.type).toBe('tool');
    expect(parsedTool.name).toBe('test_tool');
    expect(parsedTool.status).toBe('success');
    expect(parsedTool.input).toEqual({ arg: 1 });
    expect(parsedTool.output).toBe('success_output');
    // Second Assistant message segment ("世界")
    expect(state.messages[3].role).toBe('assistant');
    expect(state.messages[3].content).toBe('世界');
  });

  it('hides internal user messages from persistence and visible chat state', async () => {
    const saveMessage = vi.fn(async (message) => message);
    let chunkListener: ((event: unknown, data: any) => void) | null = null;

    window.electronAPI = {
      store: {
        get: vi.fn(),
        set: vi.fn(),
      },
      db: {
        getProjects: vi.fn(),
        createProject: vi.fn(),
        deleteProject: vi.fn(),
        getSessions: vi.fn(),
        createSession: vi.fn(),
        deleteSession: vi.fn(),
        getMessages: vi.fn(async () => []),
        saveMessage,
        getProviders: vi.fn(),
        saveProvider: vi.fn(),
        deleteProvider: vi.fn(),
        setActiveProvider: vi.fn(),
        selectDirectory: vi.fn(),
      },
      llm: {
        chat: vi.fn(async () => {
          await chunkListener?.(null, { type: 'message_chunk', text: '继续执行中' });
          await chunkListener?.(null, { type: 'message_done' });
        }),
        judge: vi.fn(),
        stopChat: vi.fn(),
        testProvider: vi.fn(),
        fetchProviderModels: vi.fn(),
        fetchOllamaModels: vi.fn(),
        onChunk: vi.fn((_requestId, callback) => {
          chunkListener = callback;
          return () => {
            chunkListener = null;
          };
        }),
      },
      platform: 'darwin',
    };

    await useSessionStore.getState().sendMessage(
      'project-1',
      '内部继续指令',
      undefined,
      'session-1',
      { hiddenUserMessage: true }
    );

    const state = useSessionStore.getState();
    expect(saveMessage).toHaveBeenCalledTimes(1);
    expect(saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: 'assistant',
      content: '继续执行中',
    }));
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe('assistant');
    expect(state.messages[0].content).toBe('继续执行中');
  });
});

describe('sessionStore sessionGoals (D-02/D-04/D-05)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    window.electronAPI = {
      store: { get: vi.fn(), set: vi.fn() },
      db: {
        getProjects: vi.fn(),
        createProject: vi.fn(),
        deleteProject: vi.fn(),
        getSessions: vi.fn(),
        createSession: vi.fn(),
        deleteSession: vi.fn(),
        getMessages: vi.fn(async () => []),
        saveMessage: vi.fn(),
        getProviders: vi.fn(),
        saveProvider: vi.fn(),
        deleteProvider: vi.fn(),
        setActiveProvider: vi.fn(),
        selectDirectory: vi.fn(),
        getAgentRuns: vi.fn(async () => []),
        getAgentToolCalls: vi.fn(async () => []),
        getLatestTodos: vi.fn(async () => undefined),
      },
      llm: {
        chat: vi.fn(),
        stopChat: vi.fn(),
        testProvider: vi.fn(),
        fetchProviderModels: vi.fn(),
        fetchOllamaModels: vi.fn(),
        onChunk: vi.fn(),
      },
      platform: 'darwin',
    };

    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      sessionGoals: new Map(),
      error: null,
    } as any);
  });

  it('A: setSessionGoal writes a per-session goal to the Map', () => {
    useSessionStore.getState().setSessionGoal('session-1', 'write tests');
    expect(useSessionStore.getState().sessionGoals.get('session-1')).toBe('write tests');
  });

  it('B: setSessionGoal overwrites the existing value for the same session', () => {
    useSessionStore.getState().setSessionGoal('session-1', 'a');
    useSessionStore.getState().setSessionGoal('session-1', 'b');
    expect(useSessionStore.getState().sessionGoals.get('session-1')).toBe('b');
    // Map should still have exactly 1 entry (no stale duplicate)
    expect(useSessionStore.getState().sessionGoals.size).toBe(1);
  });

  it('C: setSessionGoal entries persist across session switches (D-04)', async () => {
    useSessionStore.getState().setSessionGoal('s1', 'goal-A');
    useSessionStore.getState().setSessionGoal('s2', 'goal-B');

    // Switch active session — should NOT clear sessionGoals
    await useSessionStore.getState().selectSession('s1');

    const goals = useSessionStore.getState().sessionGoals;
    expect(goals.get('s1')).toBe('goal-A');
    expect(goals.get('s2')).toBe('goal-B');
    expect(goals.size).toBe(2);
  });
});

// ===== 08.2 P3 C1-05: goalJudgeStatus lifecycle =====
describe('sessionStore goalJudgeStatus (P3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.electronAPI = {
      store: { get: vi.fn(), set: vi.fn() },
      db: {
        getProjects: vi.fn(),
        createProject: vi.fn(),
        deleteSession: vi.fn(async () => undefined),
        deleteProject: vi.fn(),
        getSessions: vi.fn(async () => []),
        createSession: vi.fn(),
        getMessages: vi.fn(async () => []),
        saveMessage: vi.fn(),
        getProviders: vi.fn(),
        saveProvider: vi.fn(),
        deleteProvider: vi.fn(),
        setActiveProvider: vi.fn(),
        selectDirectory: vi.fn(),
        getAgentRuns: vi.fn(async () => []),
        getAgentToolCalls: vi.fn(async () => []),
        getLatestTodos: vi.fn(async () => undefined),
      },
      llm: {
        chat: vi.fn(),
        stopChat: vi.fn(),
        testProvider: vi.fn(),
        fetchProviderModels: vi.fn(),
        fetchOllamaModels: vi.fn(),
        onChunk: vi.fn(),
      },
      platform: 'darwin',
    } as any;

    useSessionStore.setState({
      sessions: [
        {
          id: 's1',
          project_id: 'project-1',
          name: 'S1',
          parent_session_id: null,
          summary: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        {
          id: 's2',
          project_id: 'project-1',
          name: 'S2',
          parent_session_id: null,
          summary: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ],
      activeSessionId: 's1',
      sessionGoals: new Map(),
      goalJudgeStatus: new Map(),
      error: null,
    } as any);
  });

  it('D: setGoalJudgeStatus seeds an empty entry on first call', () => {
    useSessionStore.getState().setGoalJudgeStatus('s1', { status: 'judging' });
    const entry = useSessionStore.getState().goalJudgeStatus.get('s1');
    expect(entry).toBeDefined();
    expect(entry?.status).toBe('judging');
    expect(entry?.iteration).toBe(0);
    expect(typeof entry?.startedAt).toBe('number');
  });

  it('E: setGoalJudgeStatus shallow-merges into existing entry (preserves iteration)', () => {
    useSessionStore.getState().setGoalJudgeStatus('s1', {
      status: 'unsatisfied',
      iteration: 3,
      reason: 'need more',
    });
    useSessionStore.getState().setGoalJudgeStatus('s1', { status: 'judging' });
    const entry = useSessionStore.getState().goalJudgeStatus.get('s1');
    expect(entry?.status).toBe('judging');
    expect(entry?.iteration).toBe(3); // preserved
    expect(entry?.reason).toBe('need more'); // preserved
  });

  it('F: clearGoalJudgeStatus removes the entry', () => {
    useSessionStore.getState().setGoalJudgeStatus('s1', { status: 'satisfied' });
    expect(useSessionStore.getState().goalJudgeStatus.has('s1')).toBe(true);
    useSessionStore.getState().clearGoalJudgeStatus('s1');
    expect(useSessionStore.getState().goalJudgeStatus.has('s1')).toBe(false);
  });

  it('G: getGoalJudgeStatus returns the entry or undefined', () => {
    useSessionStore.getState().setGoalJudgeStatus('s1', { status: 'paused', iteration: 20 });
    expect(useSessionStore.getState().getGoalJudgeStatus('s1')?.status).toBe('paused');
    expect(useSessionStore.getState().getGoalJudgeStatus('unknown')).toBeUndefined();
  });

  it('H: goalJudgeStatus persists across session switches (P6 — sticky goal)', async () => {
    useSessionStore.getState().setGoalJudgeStatus('s1', { status: 'judging' });
    useSessionStore.getState().setGoalJudgeStatus('s2', { status: 'satisfied' });

    await useSessionStore.getState().selectSession('s2');

    const status = useSessionStore.getState().goalJudgeStatus;
    expect(status.get('s1')?.status).toBe('judging');
    expect(status.get('s2')?.status).toBe('satisfied');
    expect(status.size).toBe(2);
  });

  it('I: deleteSession cleans up both sessionGoals and goalJudgeStatus entries', async () => {
    useSessionStore.getState().setSessionGoal('s1', 'goal-A');
    useSessionStore.getState().setGoalJudgeStatus('s1', { status: 'judging' });
    expect(useSessionStore.getState().sessionGoals.has('s1')).toBe(true);
    expect(useSessionStore.getState().goalJudgeStatus.has('s1')).toBe(true);

    await useSessionStore.getState().deleteSession('s1');
    expect(useSessionStore.getState().sessionGoals.has('s1')).toBe(false);
    expect(useSessionStore.getState().goalJudgeStatus.has('s1')).toBe(false);
  });
});

describe('sessionStore selectSession activity errors', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.electronAPI = {
      store: { get: vi.fn(), set: vi.fn() },
      db: {
        getProjects: vi.fn(),
        createProject: vi.fn(),
        deleteProject: vi.fn(),
        getSessions: vi.fn(),
        createSession: vi.fn(),
        deleteSession: vi.fn(),
        getMessages: vi.fn(async () => []),
        saveMessage: vi.fn(),
        getProviders: vi.fn(),
        saveProvider: vi.fn(),
        deleteProvider: vi.fn(),
        setActiveProvider: vi.fn(),
        selectDirectory: vi.fn(),
        getAgentRuns: vi.fn(async () => { throw new Error('agent activity db failed'); }),
        getAgentToolCalls: vi.fn(),
        getLatestTodos: vi.fn(),
      },
      llm: {
        chat: vi.fn(),
        stopChat: vi.fn(),
        testProvider: vi.fn(),
        fetchProviderModels: vi.fn(),
        fetchOllamaModels: vi.fn(),
        onChunk: vi.fn(),
      },
      platform: 'darwin',
    } as any;

    useSessionStore.setState({
      activeSessionId: null,
      messages: [],
      agentRuns: [],
      agentToolCalls: [],
      delegatedTasks: [],
      todos: [],
      error: null,
      isStreaming: false,
      streamingMessageId: null,
    } as any);
  });

  it('keeps the activity-load error instead of overwriting it as a message-load error', async () => {
    await useSessionStore.getState().selectSession('session-activity-fails');

    expect(window.electronAPI.db.getMessages).toHaveBeenCalledWith('session-activity-fails');
    expect(useSessionStore.getState().error).toBe('agent activity db failed');
  });

  it('clears stale activity before loading a new uncached session', async () => {
    useSessionStore.setState({
      agentRuns: [{ id: 'old-run' }],
      agentToolCalls: [{ id: 'old-tool' }],
      delegatedTasks: [{ taskId: 'old-task' }],
      activeRunId: 'old-run',
    } as any);

    await useSessionStore.getState().selectSession('session-activity-fails');

    const state = useSessionStore.getState();
    expect(state.agentRuns).toEqual([]);
    expect(state.agentToolCalls).toEqual([]);
    expect(state.delegatedTasks).toEqual([]);
    expect(state.activeRunId).toBe(null);
  });

  it('does not let a slow activity fetch overwrite a newer active session', async () => {
    window.electronAPI.db.getAgentRuns = vi.fn(async (sessionId: string) => [
      { id: `${sessionId}-run`, status: 'completed', started_at: Date.now() },
    ]);
    window.electronAPI.db.getAgentToolCalls = vi.fn(async () => []);
    window.electronAPI.db.getLatestTodos = vi.fn(async () => undefined);

    useSessionStore.setState({ activeSessionId: 'session-b' } as any);
    await useSessionStore.getState().fetchAgentActivity('session-a');

    expect(useSessionStore.getState().agentRuns).toEqual([]);
  });

  it('does not let stale activity failures overwrite the current session error', async () => {
    useSessionStore.setState({ activeSessionId: 'session-b', error: null } as any);

    await expect(useSessionStore.getState().fetchAgentActivity('session-a')).rejects.toThrow('agent activity db failed');

    expect(useSessionStore.getState().error).toBe(null);
  });

  it('deduplicates concurrent activity fetches for the same session in the store', async () => {
    let resolveRuns: ((runs: any[]) => void) | undefined;
    window.electronAPI.db.getAgentRuns = vi.fn(() => new Promise((resolve) => {
      resolveRuns = resolve;
    }));
    window.electronAPI.db.getAgentToolCalls = vi.fn(async () => []);
    window.electronAPI.db.getLatestTodos = vi.fn(async () => undefined);

    useSessionStore.setState({ activeSessionId: 'session-1' } as any);
    const first = useSessionStore.getState().fetchAgentActivity('session-1');
    const second = useSessionStore.getState().fetchAgentActivity('session-1');

    await Promise.resolve();
    expect(window.electronAPI.db.getAgentRuns).toHaveBeenCalledTimes(1);
    resolveRuns?.([{ id: 'run-1', status: 'completed', started_at: Date.now() }]);
    await Promise.all([first, second]);
    expect(useSessionStore.getState().agentRuns).toHaveLength(1);
  });

  it('ignores stale selectSession message loads and errors', async () => {
    let resolveA: ((messages: any[]) => void) | undefined;
    window.electronAPI.db.getMessages = vi.fn((sessionId: string) => {
      if (sessionId === 'session-a') {
        return new Promise((resolve) => { resolveA = resolve; });
      }
      return Promise.resolve([{ id: 'message-b', session_id: 'session-b', role: 'user', content: 'B' }]);
    });
    window.electronAPI.db.getAgentRuns = vi.fn(async () => []);

    const selectA = useSessionStore.getState().selectSession('session-a');
    await useSessionStore.getState().selectSession('session-b');
    resolveA?.([{ id: 'message-a', session_id: 'session-a', role: 'user', content: 'A' }]);
    await selectA;

    expect(useSessionStore.getState().activeSessionId).toBe('session-b');
    expect(useSessionStore.getState().messages[0]?.content).toBe('B');

    window.electronAPI.db.getMessages = vi.fn((sessionId: string) => {
      if (sessionId === 'session-c') return Promise.reject(new Error('stale message failure'));
      return Promise.resolve([]);
    });
    const selectC = useSessionStore.getState().selectSession('session-c');
    await useSessionStore.getState().selectSession('session-d');
    await selectC;

    expect(useSessionStore.getState().activeSessionId).toBe('session-d');
    expect(useSessionStore.getState().error).toBe(null);
  });

  it('ignores older selectSession results for the same session id', async () => {
    let resolveFirst: ((messages: any[]) => void) | undefined;
    window.electronAPI.db.getMessages = vi.fn(() => {
      if (!resolveFirst) {
        return new Promise((resolve) => { resolveFirst = resolve; });
      }
      return Promise.resolve([{ id: 'message-new', session_id: 'session-same', role: 'user', content: 'new' }]);
    });
    window.electronAPI.db.getAgentRuns = vi.fn(async () => []);

    const first = useSessionStore.getState().selectSession('session-same');
    await useSessionStore.getState().selectSession('session-same');
    resolveFirst?.([{ id: 'message-old', session_id: 'session-same', role: 'user', content: 'old' }]);
    await first;

    expect(useSessionStore.getState().activeSessionId).toBe('session-same');
    expect(useSessionStore.getState().messages[0]?.content).toBe('new');
  });

  it('ignores older activity results for the same session id', async () => {
    const resolvers: Array<(runs: any[]) => void> = [];
    window.electronAPI.db.getMessages = vi.fn(async () => []);
    window.electronAPI.db.getAgentRuns = vi.fn(() => new Promise((resolve) => {
      resolvers.push(resolve);
    }));
    window.electronAPI.db.getAgentToolCalls = vi.fn(async () => []);
    window.electronAPI.db.getLatestTodos = vi.fn(async () => undefined);

    const first = useSessionStore.getState().selectSession('session-same');
    await Promise.resolve();
    await Promise.resolve();
    const second = useSessionStore.getState().selectSession('session-same');
    await Promise.resolve();
    await Promise.resolve();

    expect(resolvers).toHaveLength(2);
    resolvers[1]?.([{ id: 'new-run', status: 'completed', started_at: Date.now() }]);
    await second;
    resolvers[0]?.([{ id: 'old-run', status: 'running', started_at: Date.now() }]);
    await first;

    expect(useSessionStore.getState().agentRuns[0]?.id).toBe('new-run');
  });

  it('does not leave a failed uncached session active with empty messages', async () => {
    const existingMessages = [{ id: 'old-message', session_id: 'session-old', role: 'user', content: 'old' }];
    window.electronAPI.db.getMessages = vi.fn(async () => { throw new Error('message db failed'); });
    window.electronAPI.db.getAgentRuns = vi.fn(async () => []);

    useSessionStore.setState({
      activeSessionId: 'session-old',
      messages: existingMessages,
      agentRuns: [{ id: 'old-run' }],
      error: null,
    } as any);

    await useSessionStore.getState().selectSession('session-new');

    const state = useSessionStore.getState();
    expect(state.activeSessionId).toBe('session-old');
    expect(state.messages).toBe(existingMessages);
    expect(state.error).toBe('message db failed');
  });

  it('still attempts to refresh activity when message loading fails', async () => {
    window.electronAPI.db.getMessages = vi.fn(async () => { throw new Error('message db failed'); });
    window.electronAPI.db.getAgentRuns = vi.fn(async () => [
      { id: 'session-current-run', status: 'completed', started_at: Date.now() },
    ]);
    window.electronAPI.db.getAgentToolCalls = vi.fn(async () => []);
    window.electronAPI.db.getLatestTodos = vi.fn(async () => undefined);

    useSessionStore.setState({ activeSessionId: 'session-current', agentRuns: [], error: null } as any);

    await useSessionStore.getState().selectSession('session-current');

    expect(window.electronAPI.db.getAgentRuns).toHaveBeenCalledWith('session-current');
    expect(useSessionStore.getState().agentRuns[0]?.id).toBe('session-current-run');
  });

  it('does not overwrite messages created while session messages are loading', async () => {
    let resolveMessages: ((messages: any[]) => void) | undefined;
    let chunkListener: ((event: unknown, data: any) => void) | null = null;
    window.electronAPI.db.getMessages = vi.fn(() => new Promise((resolve) => {
      resolveMessages = resolve;
    }));
    window.electronAPI.db.saveMessage = vi.fn(async (message) => message);
    window.electronAPI.db.getAgentRuns = vi.fn(async () => []);
    window.electronAPI.db.getAgentToolCalls = vi.fn(async () => []);
    window.electronAPI.db.getLatestTodos = vi.fn(async () => undefined);
    window.electronAPI.llm.chat = vi.fn(async () => {
      chunkListener?.(null, { type: 'message_chunk', text: 'new reply' });
      chunkListener?.(null, { type: 'message_done' });
    });
    window.electronAPI.llm.onChunk = vi.fn((_requestId, callback) => {
      chunkListener = callback;
      return () => {
        chunkListener = null;
      };
    });

    useSessionStore.setState({
      sessions: [{ id: 'session-loading', project_id: 'project-1', name: 'Loading', created_at: Date.now(), updated_at: Date.now() }],
      activeSessionId: 'session-loading',
      messages: [],
      isStreaming: false,
      streamingMessageId: null,
      error: null,
    } as any);

    const select = useSessionStore.getState().selectSession('session-loading');
    await useSessionStore.getState().sendMessage('project-1', 'new message');
    resolveMessages?.([{ id: 'history-message', session_id: 'session-loading', role: 'user', content: 'history' }]);
    await select;

    const contents = useSessionStore.getState().messages.map((message) => message.content);
    expect(contents).toContain('new message');
    expect(contents).toContain('new reply');
    expect(contents).not.toEqual(['history']);
  });
});

describe('sessionStore model overrides persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    useSessionStore.setState({
      sessionModelOverrides: {},
    });
  });

  it('saves model overrides to localStorage and retrieves them', () => {
    useSessionStore.getState().setSessionModelOverride('session-1', 'provider-1', 'gpt-4');
    
    // Verify stored state
    expect(useSessionStore.getState().sessionModelOverrides['session-1']).toEqual({
      providerId: 'provider-1',
      model: 'gpt-4',
    });

    // Verify localStorage item
    const saved = localStorage.getItem('sessionModelOverrides');
    expect(saved).toBeDefined();
    expect(JSON.parse(saved!)).toEqual({
      'session-1': { providerId: 'provider-1', model: 'gpt-4' },
    });
  });

  it('cleans up overrides when a session is deleted', async () => {
    window.electronAPI = {
      db: {
        deleteSession: vi.fn().mockResolvedValue(undefined),
      },
    } as any;

    useSessionStore.setState({
      sessions: [{ id: 'session-1', project_id: 'project-1', name: 'Test', created_at: 0, updated_at: 0 }],
      sessionModelOverrides: {
        'session-1': { providerId: 'provider-1', model: 'gpt-4' },
      },
      sessionGoals: new Map(),
      goalJudgeStatus: new Map(),
    });

    await useSessionStore.getState().deleteSession('session-1');

    expect(useSessionStore.getState().sessionModelOverrides['session-1']).toBeUndefined();
    const saved = localStorage.getItem('sessionModelOverrides');
    expect(JSON.parse(saved!)).toEqual({});
  });
});
