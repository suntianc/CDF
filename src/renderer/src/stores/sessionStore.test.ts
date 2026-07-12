import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMStreamEvent } from '@shared/types';
import { createConversationRuntimeRegistryState } from '../components/ChatArea/conversationRuntime/conversationRuntimeRegistry';
import { useSessionStore } from './sessionStore';

beforeEach(() => {
  useSessionStore.setState({
    conversationRuntimeRegistry: createConversationRuntimeRegistryState(),
    pendingHistoryRefreshes: {},
    isConversationLoading: false,
  });
});

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

  it('claims the target Conversation before persistence and rejects a concurrent submission', async () => {
    let releaseFirstSave: (() => void) | undefined;
    const saveMessage = vi.fn(async (message) => {
      await new Promise<void>((resolve) => {
        releaseFirstSave = resolve;
      });
      return message;
    });
    let chunkListener: ((event: unknown, data: LLMStreamEvent) => void | Promise<void>) | null = null;

    useSessionStore.setState((state) => ({
      sessions: [
        ...state.sessions,
        {
          id: 'session-2',
          project_id: 'project-1',
          name: 'Background Session',
          parent_session_id: null,
          summary: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ],
      todos: [{ id: 'visible-todo', content: 'Keep visible', status: 'in_progress' }],
    }));

    window.electronAPI = {
      store: { get: vi.fn(), set: vi.fn() },
      db: {
        getMessages: vi.fn(async () => []),
        saveMessage,
      },
      llm: {
        chat: vi.fn(async () => {
          await chunkListener?.(null, { type: 'message_done' });
        }),
        onChunk: vi.fn((_requestId, callback) => {
          chunkListener = callback;
          return () => {
            chunkListener = null;
          };
        }),
      },
      deepagents: {
        onParallelTaskStep: vi.fn(() => () => {}),
      },
      platform: 'darwin',
    } as unknown as Window['electronAPI'];

    const firstSubmission = useSessionStore.getState().sendMessage(
      'project-1',
      'first',
      undefined,
      'session-2',
    );
    await vi.waitFor(() => expect(saveMessage).toHaveBeenCalledTimes(1));

    const ownedRuntime = useSessionStore.getState().conversationRuntimeRegistry.entries['session-2'];
    expect(ownedRuntime?.requestId).toBeTruthy();
    expect(useSessionStore.getState().todos).toEqual([
      { id: 'visible-todo', content: 'Keep visible', status: 'in_progress' },
    ]);

    const secondResult = await useSessionStore.getState().sendMessage(
      'project-1',
      'second',
      undefined,
      'session-2',
    );

    expect(secondResult).toEqual({ ok: false, code: 'CONVERSATION_BUSY' });
    expect(saveMessage).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.llm.chat).not.toHaveBeenCalled();

    releaseFirstSave?.();
    await firstSubmission;
    expect(window.electronAPI.llm.chat).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().conversationRuntimeRegistry.entries['session-2']).toBeUndefined();
  });

  it('should register stream listener before starting llm chat', async () => {
    const saveMessage = vi.fn(async (message) => {
      if (!message.session_id) {
        throw new Error('SqliteError: NOT NULL constraint failed: messages.session_id');
      }
      return message;
    });
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
      deepagents: {
        onParallelTaskStep: vi.fn(() => () => {}),
      },
      platform: 'darwin',
    } as unknown as Window['electronAPI'];

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

  it('uses a persisted AI subscription model override when sending a session message', async () => {
    const saveMessage = vi.fn(async (message) => message);
    let chunkListener: ((event: unknown, data: LLMStreamEvent) => void) | null = null;

    useSessionStore.setState({
      sessionModelOverrides: {
        'session-1': {
          providerId: 'minimax-token-plan',
          sourceId: 'minimax-token-plan',
          sourceType: 'ai_subscription',
          model: 'MiniMax-M2.7',
        },
      },
    });

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
      deepagents: {
        onParallelTaskStep: vi.fn(() => () => {}),
      },
      platform: 'darwin',
    } as unknown as Window['electronAPI'];

    await useSessionStore.getState().sendMessage('project-1', 'Use the selected subscription model');

    expect(window.electronAPI.llm.chat).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        overrides: {
          modelSource: 'ai_subscription',
          sourceId: 'minimax-token-plan',
          providerId: undefined,
          model: 'MiniMax-M2.7',
        },
      })
    );
  });

  it('serializes stream event persistence so tool_start cannot overwrite tool_end', async () => {
    let releaseRunningSave: (() => void) | undefined;
    const runningSaveStarted = vi.fn();
    const persistedMessages = new Map<string, any>();
    const saveMessage = vi.fn(async (message) => {
      if (message.role === 'system') {
        const parsed = JSON.parse(message.content);
        if (parsed.status === 'running') {
          runningSaveStarted();
          await new Promise<void>((resolve) => {
            releaseRunningSave = resolve;
          });
        }
      }
      persistedMessages.set(message.id, message);
      return message;
    });
    let chunkListener: ((event: unknown, data: any) => void | Promise<void>) | null = null;

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
        saveMessage,
        getProviders: vi.fn(),
        saveProvider: vi.fn(),
        deleteProvider: vi.fn(),
        setActiveProvider: vi.fn(),
        selectDirectory: vi.fn(),
      },
      llm: {
        chat: vi.fn(async () => {
          chunkListener?.(null, { type: 'tool_start', id: 'tool-1', name: 'list_agents', input: {} });
          chunkListener?.(null, { type: 'tool_end', id: 'tool-1', name: 'list_agents', output: [{ name: 'Reviewer' }] });
          chunkListener?.(null, { type: 'message_done' });
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
      deepagents: {
        onParallelTaskStep: vi.fn(() => () => {}),
      },
      platform: 'darwin',
    } as unknown as Window['electronAPI'];

    const sendPromise = useSessionStore.getState().sendMessage('project-1', '测试工具生命周期');
    await vi.waitFor(() => expect(runningSaveStarted).toHaveBeenCalledTimes(1));

    releaseRunningSave?.();
    await sendPromise;

    const persistedTool = persistedMessages.get('tool-1');
    expect(JSON.parse(persistedTool.content)).toMatchObject({
      type: 'tool',
      name: 'list_agents',
      status: 'success',
      output: [{ name: 'Reviewer' }],
    });
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
      deepagents: {
        onParallelTaskStep: vi.fn(() => () => {}),
      },
      platform: 'darwin',
    } as unknown as Window['electronAPI'];

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

  it('persists explicit Skill attribution options as system messages', async () => {
    const saveMessage = vi.fn(async (message) => message);
    let chunkListener: ((event: unknown, data: unknown) => void) | null = null;

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
          await chunkListener?.(null, { type: 'message_chunk', text: '已使用 Skill' });
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
      deepagents: {
        onParallelTaskStep: vi.fn(() => () => {}),
      },
      platform: 'darwin',
    } as unknown as Window['electronAPI'];

    await useSessionStore.getState().sendMessage(
      'project-1',
      '请使用 Skill `apps/web:deploy`',
      undefined,
      'session-1',
      {
        skillAttributions: [
          {
            phase: 'explicit-invocation',
            name: 'deploy',
            qualifiedName: 'apps/web:deploy',
            sourceKind: 'project-additional',
            sourceLabel: 'Project Skill: apps/web',
            skillPath: '/repo/apps/web/.cdf/skills/deploy/SKILL.md',
            visibility: 'on',
            modelDiscovery: 'full',
            userInvocable: true,
          },
        ],
      }
    );

    const state = useSessionStore.getState();
    expect(saveMessage).toHaveBeenCalledTimes(3);
    expect(saveMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      role: 'system',
    }));
    const persistedAttribution = JSON.parse(saveMessage.mock.calls[1][0].content);
    expect(persistedAttribution).toEqual({
      type: 'skill_attribution',
      attributions: [
        expect.objectContaining({
          phase: 'explicit-invocation',
          qualifiedName: 'apps/web:deploy',
        }),
      ],
    });
    expect(state.messages[1].role).toBe('system');
    expect(JSON.parse(state.messages[1].content)).toMatchObject({
      type: 'skill_attribution',
      attributions: [
        {
          phase: 'explicit-invocation',
          qualifiedName: 'apps/web:deploy',
        },
      ],
    });
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
    } as unknown as Window['electronAPI'];

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
        onChunk: vi.fn(() => () => {}),
      },
      deepagents: {
        onParallelTaskStep: vi.fn(() => () => {}),
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
    expect(useSessionStore.getState().error?.message).toBe('agent activity db failed');
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
    ]) as unknown as typeof window.electronAPI.db.getAgentRuns;
    window.electronAPI.db.getAgentToolCalls = vi.fn(async () => []) as unknown as typeof window.electronAPI.db.getAgentToolCalls;
    window.electronAPI.db.getLatestTodos = vi.fn(async () => undefined) as unknown as typeof window.electronAPI.db.getLatestTodos;

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
    })) as unknown as typeof window.electronAPI.db.getAgentRuns;
    window.electronAPI.db.getAgentToolCalls = vi.fn(async () => []) as unknown as typeof window.electronAPI.db.getAgentToolCalls;
    window.electronAPI.db.getLatestTodos = vi.fn(async () => undefined) as unknown as typeof window.electronAPI.db.getLatestTodos;

    useSessionStore.setState({ activeSessionId: 'session-1' } as any);
    const first = useSessionStore.getState().fetchAgentActivity('session-1');
    const second = useSessionStore.getState().fetchAgentActivity('session-1');

    await Promise.resolve();
    expect(window.electronAPI.db.getAgentRuns).toHaveBeenCalledTimes(1);
    resolveRuns?.([{ id: 'run-1', status: 'completed', started_at: Date.now() }]);
    await Promise.all([first, second]);
    expect(useSessionStore.getState().agentRuns).toHaveLength(1);
  });

  it('hydrates completed persisted tool cards from agent activity', async () => {
    window.electronAPI.db.getAgentRuns = vi.fn(async () => [
      {
        id: 'run-1',
        session_id: 'session-1',
        agent_id: 'agent-1',
        request_id: 'assistant-1',
        status: 'completed',
        started_at: 100,
        ended_at: 200,
        aborted: 0,
      },
    ]) as unknown as typeof window.electronAPI.db.getAgentRuns;
    window.electronAPI.db.getAgentToolCalls = vi.fn(async () => [
      {
        id: 'tool-1',
        run_id: 'run-1',
        tool_name: 'read_file',
        input: JSON.stringify({ path: '/tmp/a.ts' }),
        output: JSON.stringify('file contents'),
        status: 'success',
        error: null,
        started_at: 120,
        ended_at: 180,
        approval_status: null,
      },
    ]) as unknown as typeof window.electronAPI.db.getAgentToolCalls;
    window.electronAPI.db.getLatestTodos = vi.fn(async () => undefined) as unknown as typeof window.electronAPI.db.getLatestTodos;

    useSessionStore.setState({
      activeSessionId: 'session-1',
      messages: [
        {
          id: 'tool-1',
          session_id: 'session-1',
          role: 'system',
          content: JSON.stringify({
            type: 'tool',
            name: 'read_file',
            status: 'running',
            input: { path: '/tmp/a.ts' },
          }),
          created_at: 120,
          tokens: 0,
        },
      ],
    } as any);

    await useSessionStore.getState().fetchAgentActivity('session-1', true);

    const parsed = JSON.parse(useSessionStore.getState().messages[0].content);
    expect(parsed.status).toBe('success');
    expect(parsed.output).toBe('file contents');
  });

  it('hydrates stale tool cards from older runs in the same session', async () => {
    window.electronAPI.db.getAgentRuns = vi.fn(async () => [
      {
        id: 'run-new',
        session_id: 'session-1',
        agent_id: 'agent-1',
        request_id: 'assistant-new',
        status: 'completed',
        started_at: 300,
        ended_at: 400,
        aborted: 0,
      },
      {
        id: 'run-old',
        session_id: 'session-1',
        agent_id: 'agent-1',
        request_id: 'assistant-old',
        status: 'completed',
        started_at: 100,
        ended_at: 200,
        aborted: 0,
      },
    ]) as unknown as typeof window.electronAPI.db.getAgentRuns;
    window.electronAPI.db.getAgentToolCalls = vi.fn(async (runId: string) => {
      if (runId === 'run-old') {
        return [
          {
            id: 'tool-old',
            run_id: 'run-old',
            tool_name: 'list_agents',
            input: JSON.stringify({}),
            output: JSON.stringify([{ name: 'Reviewer' }]),
            status: 'success',
            error: null,
            started_at: 120,
            ended_at: 130,
            approval_status: null,
          },
        ];
      }
      return [];
    }) as unknown as typeof window.electronAPI.db.getAgentToolCalls;
    window.electronAPI.db.getLatestTodos = vi.fn(async () => undefined) as unknown as typeof window.electronAPI.db.getLatestTodos;

    useSessionStore.setState({
      activeSessionId: 'session-1',
      messages: [
        {
          id: 'tool-old',
          session_id: 'session-1',
          role: 'system',
          content: JSON.stringify({
            type: 'tool',
            name: 'list_agents',
            status: 'running',
            input: {},
          }),
          created_at: 120,
          tokens: 0,
        },
      ],
    } as any);

    await useSessionStore.getState().fetchAgentActivity('session-1', true);

    expect(window.electronAPI.db.getAgentToolCalls).toHaveBeenCalledWith('run-new');
    expect(window.electronAPI.db.getAgentToolCalls).toHaveBeenCalledWith('run-old');
    const parsed = JSON.parse(useSessionStore.getState().messages[0].content);
    expect(parsed.status).toBe('success');
    expect(parsed.output).toEqual([{ name: 'Reviewer' }]);
  });

  it('ignores stale selectSession message loads and errors', async () => {
    let resolveA: ((messages: any[]) => void) | undefined;
    window.electronAPI.db.getMessages = vi.fn((sessionId: string) => {
      if (sessionId === 'session-a') {
        return new Promise((resolve) => { resolveA = resolve; });
      }
      return Promise.resolve([{ id: 'message-b', session_id: 'session-b', role: 'user', content: 'B' }]);
    }) as unknown as typeof window.electronAPI.db.getMessages;
    window.electronAPI.db.getAgentRuns = vi.fn(async () => []) as unknown as typeof window.electronAPI.db.getAgentRuns;

    const selectA = useSessionStore.getState().selectSession('session-a');
    await useSessionStore.getState().selectSession('session-b');
    resolveA?.([{ id: 'message-a', session_id: 'session-a', role: 'user', content: 'A' }]);
    await selectA;

    expect(useSessionStore.getState().activeSessionId).toBe('session-b');
    expect(useSessionStore.getState().messages[0]?.content).toBe('B');

    window.electronAPI.db.getMessages = vi.fn((sessionId: string) => {
      if (sessionId === 'session-c') return Promise.reject(new Error('stale message failure'));
      return Promise.resolve([]);
    }) as unknown as typeof window.electronAPI.db.getMessages;
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
    }) as unknown as typeof window.electronAPI.db.getMessages;
    window.electronAPI.db.getAgentRuns = vi.fn(async () => []) as unknown as typeof window.electronAPI.db.getAgentRuns;

    const first = useSessionStore.getState().selectSession('session-same');
    await useSessionStore.getState().selectSession('session-same');
    resolveFirst?.([{ id: 'message-old', session_id: 'session-same', role: 'user', content: 'old' }]);
    await first;

    expect(useSessionStore.getState().activeSessionId).toBe('session-same');
    expect(useSessionStore.getState().messages[0]?.content).toBe('new');
  });

  it('ignores older activity results for the same session id', async () => {
    const resolvers: Array<(runs: any[]) => void> = [];
    window.electronAPI.db.getMessages = vi.fn(async () => []) as unknown as typeof window.electronAPI.db.getMessages;
    window.electronAPI.db.getAgentRuns = vi.fn(() => new Promise((resolve) => {
      resolvers.push(resolve);
    })) as unknown as typeof window.electronAPI.db.getAgentRuns;
    window.electronAPI.db.getAgentToolCalls = vi.fn(async () => []) as unknown as typeof window.electronAPI.db.getAgentToolCalls;
    window.electronAPI.db.getLatestTodos = vi.fn(async () => undefined) as unknown as typeof window.electronAPI.db.getLatestTodos;

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
    window.electronAPI.db.getMessages = vi.fn(async () => { throw new Error('message db failed'); }) as unknown as typeof window.electronAPI.db.getMessages;
    window.electronAPI.db.getAgentRuns = vi.fn(async () => []) as unknown as typeof window.electronAPI.db.getAgentRuns;

    useSessionStore.setState({
      activeSessionId: 'session-old',
      messages: existingMessages,
      agentRuns: [{ id: 'old-run' }],
      error: null,
    } as any);

    await useSessionStore.getState().selectSession('session-new');

    const state = useSessionStore.getState();
    expect(state.activeSessionId).toBe('session-new');
    expect(state.messages).toEqual([]);
    expect(state.isConversationLoading).toBe(false);
    expect(state.error?.message).toBe('message db failed');
  });

  it('still attempts to refresh activity when message loading fails', async () => {
    window.electronAPI.db.getMessages = vi.fn(async () => { throw new Error('message db failed'); }) as unknown as typeof window.electronAPI.db.getMessages;
    window.electronAPI.db.getAgentRuns = vi.fn(async () => [
      { id: 'session-current-run', status: 'completed', started_at: Date.now() },
    ]) as unknown as typeof window.electronAPI.db.getAgentRuns;
    window.electronAPI.db.getAgentToolCalls = vi.fn(async () => []) as unknown as typeof window.electronAPI.db.getAgentToolCalls;
    window.electronAPI.db.getLatestTodos = vi.fn(async () => undefined) as unknown as typeof window.electronAPI.db.getLatestTodos;

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
    })) as unknown as typeof window.electronAPI.db.getMessages;
    window.electronAPI.db.saveMessage = vi.fn(async (message) => message) as unknown as typeof window.electronAPI.db.saveMessage;
    window.electronAPI.db.getAgentRuns = vi.fn(async () => []) as unknown as typeof window.electronAPI.db.getAgentRuns;
    window.electronAPI.db.getAgentToolCalls = vi.fn(async () => []) as unknown as typeof window.electronAPI.db.getAgentToolCalls;
    window.electronAPI.db.getLatestTodos = vi.fn(async () => undefined) as unknown as typeof window.electronAPI.db.getLatestTodos;
    window.electronAPI.llm.chat = vi.fn(async () => {
      chunkListener?.(null, { type: 'message_chunk', text: 'new reply' });
      chunkListener?.(null, { type: 'message_done' });
    }) as unknown as typeof window.electronAPI.llm.chat;
    window.electronAPI.llm.onChunk = vi.fn((_requestId, callback) => {
      chunkListener = callback;
      return () => {
        chunkListener = null;
      };
    }) as unknown as typeof window.electronAPI.llm.onChunk;

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
      sourceId: 'provider-1',
      sourceType: 'llm_provider',
      model: 'gpt-4',
    });

    // Verify localStorage item
    const saved = localStorage.getItem('sessionModelOverrides');
    expect(saved).toBeDefined();
    expect(JSON.parse(saved!)).toEqual({
      'session-1': {
        providerId: 'provider-1',
        sourceId: 'provider-1',
        sourceType: 'llm_provider',
        model: 'gpt-4',
      },
    });
  });

  it('persists a Conversation reasoning effort alongside its model override', () => {
    useSessionStore.getState().setSessionModelOverride(
      'session-1',
      'codex-oauth',
      'gpt-5.6-sol',
      'ai_subscription'
    );

    useSessionStore.getState().setSessionReasoningEffort('session-1', 'xhigh');

    expect(useSessionStore.getState().sessionModelOverrides['session-1']).toEqual({
      providerId: 'codex-oauth',
      sourceId: 'codex-oauth',
      sourceType: 'ai_subscription',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'xhigh',
    });
    expect(JSON.parse(localStorage.getItem('sessionModelOverrides')!))
      .toEqual({
        'session-1': {
          providerId: 'codex-oauth',
          sourceId: 'codex-oauth',
          sourceType: 'ai_subscription',
          model: 'gpt-5.6-sol',
          reasoningEffort: 'xhigh',
        },
      });
  });

  it('keeps a reasoning effort across model changes so capability normalization can decide its validity', () => {
    useSessionStore.setState({
      sessionModelOverrides: {
        'session-1': {
          providerId: 'codex-oauth',
          sourceId: 'codex-oauth',
          sourceType: 'ai_subscription',
          model: 'gpt-5.6-sol',
          reasoningEffort: 'high',
        },
      },
    });

    useSessionStore.getState().setSessionModelOverride(
      'session-1',
      'xai-oauth',
      'grok-4.5',
      'ai_subscription'
    );

    expect(useSessionStore.getState().sessionModelOverrides['session-1'])
      .toEqual(expect.objectContaining({
        sourceId: 'xai-oauth',
        model: 'grok-4.5',
        reasoningEffort: 'high',
      }));
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
    useSessionStore.getState().handleConversationRunEvent({
      sessionId: 'session-1',
      requestId: 'request-delete',
      messageId: 'message-delete',
      origin: 'background-capability-continuation',
      sequence: 1,
      event: { type: 'message_chunk', text: 'transient' },
    });
    expect(useSessionStore.getState().conversationRuntimeRegistry.entries['session-1']).toBeDefined();

    await useSessionStore.getState().deleteSession('session-1');

    expect(useSessionStore.getState().sessionModelOverrides['session-1']).toBeUndefined();
    expect(useSessionStore.getState().conversationRuntimeRegistry.entries['session-1']).toBeUndefined();
    const saved = localStorage.getItem('sessionModelOverrides');
    expect(JSON.parse(saved!)).toEqual({});
  });
});

describe('sessionStore background continuation streaming', () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: [{
        id: 'session-1',
        project_id: 'project-1',
        name: 'Test Session',
        parent_session_id: null,
        summary: null,
        created_at: 1,
        updated_at: 1,
      }],
      activeSessionId: 'session-1',
      messages: [],
      isStreaming: false,
      streamingMessageId: null,
      activeRunId: null,
      agentRuns: [],
      agentToolCalls: [],
      delegatedTasks: [],
      parallelBatches: [],
      todos: [],
      pendingApproval: null,
      error: null,
    });
  });

  it('projects background continuation chunks without persisting them from renderer', () => {
    const saveMessage = vi.fn();
    window.electronAPI = {
      db: { saveMessage },
      conversation: { getActiveRun: vi.fn() },
    } as unknown as Window['electronAPI'];

    useSessionStore.getState().handleConversationRunEvent({
      sessionId: 'session-1',
      requestId: 'background-continuation:batch-1',
      messageId: 'background-continuation-output:batch-1',
      origin: 'background-capability-continuation',
      sequence: 1,
      event: { type: 'message_chunk', text: '任务结果' },
    });

    expect(useSessionStore.getState()).toMatchObject({
      isStreaming: true,
      streamingMessageId: 'background-continuation-output:batch-1',
    });
    expect(useSessionStore.getState().messages).toContainEqual(expect.objectContaining({
      id: 'background-continuation-output:batch-1',
      role: 'assistant',
      content: '任务结果',
    }));
    expect(saveMessage).not.toHaveBeenCalled();
    useSessionStore.getState().handleConversationRunEvent({
      sessionId: 'session-1',
      requestId: 'background-continuation:batch-1',
      messageId: 'background-continuation-output:batch-1',
      origin: 'background-capability-continuation',
      sequence: 2,
      event: { type: 'message_done' },
    });
  });

  it('finishes the transient stream without duplicating the main-owned message', () => {
    window.electronAPI = {
      db: { saveMessage: vi.fn() },
      conversation: { getActiveRun: vi.fn() },
    } as unknown as Window['electronAPI'];

    const base = {
      sessionId: 'session-1',
      requestId: 'background-continuation:batch-1',
      messageId: 'background-continuation-output:batch-1',
      origin: 'background-capability-continuation' as const,
    };
    useSessionStore.getState().handleConversationRunEvent({
      ...base,
      sequence: 1,
      event: { type: 'message_chunk', text: '已完成' },
    });
    useSessionStore.getState().handleConversationRunEvent({
      ...base,
      sequence: 2,
      event: { type: 'message_done' },
    });

    expect(useSessionStore.getState().isStreaming).toBe(false);
    expect(useSessionStore.getState().messages).toContainEqual(expect.objectContaining({
      id: base.messageId,
      content: '已完成',
    }));
    expect(window.electronAPI.db.saveMessage).not.toHaveBeenCalled();
  });

  it('hydrates an in-flight continuation snapshot when its Conversation becomes active', async () => {
    window.electronAPI = {
      conversation: {
        getActiveRun: vi.fn().mockResolvedValue({
          sessionId: 'session-1',
          requestId: 'background-continuation:batch-1',
          messageId: 'background-continuation-output:batch-1',
          origin: 'background-capability-continuation',
          sequence: 4,
          content: '已经生成的内容',
          runId: 'run-1',
          agentId: 'agent-1',
        }),
      },
    } as unknown as Window['electronAPI'];

    await useSessionStore.getState().hydrateConversationRun('session-1');

    expect(useSessionStore.getState()).toMatchObject({
      isStreaming: true,
      streamingMessageId: 'background-continuation-output:batch-1',
      activeRunId: 'run-1',
    });
    expect(useSessionStore.getState().messages).toContainEqual(expect.objectContaining({
      id: 'background-continuation-output:batch-1',
      content: '已经生成的内容',
    }));
    useSessionStore.getState().handleConversationRunEvent({
      sessionId: 'session-1',
      requestId: 'background-continuation:batch-1',
      messageId: 'background-continuation-output:batch-1',
      origin: 'background-capability-continuation',
      sequence: 5,
      event: { type: 'message_done' },
    });
  });

  it('keeps a durable completion card when streaming starts during message reload', async () => {
    let resolveMessages!: (messages: any[]) => void;
    const getMessages = vi.fn(() => new Promise<any[]>((resolve) => {
      resolveMessages = resolve;
    }));
    window.electronAPI = {
      db: {
        getMessages,
      },
      conversation: {
        getActiveRun: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Window['electronAPI'];

    const selecting = useSessionStore.getState().selectSession('session-1');
    await Promise.resolve();
    useSessionStore.getState().handleConversationRunEvent({
      sessionId: 'session-1',
      requestId: 'background-continuation:batch-2',
      messageId: 'background-continuation-output:batch-2',
      origin: 'background-capability-continuation',
      sequence: 1,
      event: { type: 'message_chunk', text: '正在呈现' },
    });
    resolveMessages([{
      id: 'capability-job:job-2:terminal',
      session_id: 'session-1',
      role: 'assistant',
      content: JSON.stringify({
        type: 'capability_job_event',
        eventId: 'capability-job:job-2:terminal',
        jobId: 'job-2',
        projectId: 'project-1',
        sessionId: 'session-1',
        status: 'completed',
        provider: 'xai-oauth',
        mode: 'text',
        artifacts: [],
        error: null,
      }),
      tokens: 0,
      created_at: 1,
    }]);
    await selecting;

    expect(useSessionStore.getState().messages.map((message) => message.id)).toEqual([
      'capability-job:job-2:terminal',
      'background-continuation-output:batch-2',
    ]);
    useSessionStore.getState().handleConversationRunEvent({
      sessionId: 'session-1',
      requestId: 'background-continuation:batch-2',
      messageId: 'background-continuation-output:batch-2',
      origin: 'background-capability-continuation',
      sequence: 2,
      event: { type: 'message_done' },
    });
  });

  it('does not switch the visible Conversation for an inactive continuation', () => {
    useSessionStore.setState({
      activeSessionId: 'session-1',
      messages: [{
        id: 'visible-message',
        session_id: 'session-1',
        role: 'assistant',
        content: '当前会话',
        tokens: 1,
        created_at: 1,
      }],
    });

    useSessionStore.getState().handleConversationRunEvent({
      sessionId: 'session-2',
      requestId: 'background-continuation:batch-3',
      messageId: 'background-continuation-output:batch-3',
      origin: 'background-capability-continuation',
      sequence: 1,
      event: { type: 'message_chunk', text: '后台会话' },
    });

    expect(useSessionStore.getState().activeSessionId).toBe('session-1');
    expect(useSessionStore.getState().messages).toEqual([
      expect.objectContaining({ id: 'visible-message', content: '当前会话' }),
    ]);
    expect(useSessionStore.getState().getMessagesForSession('session-2')).toContainEqual(
      expect.objectContaining({
        id: 'background-continuation-output:batch-3',
        content: '后台会话',
      }),
    );
    useSessionStore.getState().handleConversationRunEvent({
      sessionId: 'session-2',
      requestId: 'background-continuation:batch-3',
      messageId: 'background-continuation-output:batch-3',
      origin: 'background-capability-continuation',
      sequence: 2,
      event: { type: 'message_done' },
    });
  });

  it('merges persisted history with an inactive continuation when its Conversation becomes active', async () => {
    const persistedMessage = {
      id: 'persisted-message',
      session_id: 'session-2',
      role: 'assistant' as const,
      content: '历史消息',
      tokens: 1,
      created_at: 1,
    };
    window.electronAPI = {
      db: {
        getMessages: vi.fn().mockResolvedValue([persistedMessage]),
        getAgentRuns: vi.fn().mockResolvedValue([]),
        getAgentToolCalls: vi.fn().mockResolvedValue([]),
        getLatestTodos: vi.fn().mockResolvedValue([]),
      },
      conversation: {
        getActiveRun: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Window['electronAPI'];
    useSessionStore.setState({
      activeSessionId: 'session-1',
      messages: [{
        id: 'visible-message',
        session_id: 'session-1',
        role: 'assistant',
        content: '当前会话',
        tokens: 1,
        created_at: 1,
      }],
    });
    useSessionStore.getState().handleConversationRunEvent({
      sessionId: 'session-2',
      requestId: 'background-continuation:batch-4',
      messageId: 'background-continuation-output:batch-4',
      origin: 'background-capability-continuation',
      sequence: 1,
      event: { type: 'message_chunk', text: '实时结果' },
    });

    await useSessionStore.getState().selectSession('session-2');

    expect(useSessionStore.getState().messages).toEqual([
      persistedMessage,
      expect.objectContaining({
        id: 'background-continuation-output:batch-4',
        content: '实时结果',
      }),
    ]);
    useSessionStore.getState().handleConversationRunEvent({
      sessionId: 'session-2',
      requestId: 'background-continuation:batch-4',
      messageId: 'background-continuation-output:batch-4',
      origin: 'background-capability-continuation',
      sequence: 2,
      event: { type: 'message_done' },
    });
  });
  it('keeps streaming into the source Conversation after the user switches away', async () => {
    const sourceMessage = {
      id: 'source-message',
      session_id: 'session-1',
      role: 'assistant' as const,
      content: '来源会话',
      tokens: 1,
      created_at: 1,
    };
    window.electronAPI = {
      db: {
        getMessages: vi.fn().mockResolvedValue([sourceMessage]),
        getAgentRuns: vi.fn().mockResolvedValue([]),
        getAgentToolCalls: vi.fn().mockResolvedValue([]),
        getLatestTodos: vi.fn().mockResolvedValue([]),
      },
      conversation: { getActiveRun: vi.fn().mockResolvedValue(null) },
    } as unknown as Window['electronAPI'];
    useSessionStore.setState({
      activeSessionId: 'session-1',
      messages: [sourceMessage],
    });
    const base = {
      sessionId: 'session-1',
      requestId: 'background-continuation:batch-5',
      messageId: 'background-continuation-output:batch-5',
      origin: 'background-capability-continuation' as const,
    };
    useSessionStore.getState().handleConversationRunEvent({
      ...base,
      sequence: 1,
      event: { type: 'message_chunk', text: '第一段' },
    });
    useSessionStore.setState({
      activeSessionId: 'session-2',
      messages: [{
        id: 'other-message',
        session_id: 'session-2',
        role: 'assistant',
        content: '其它会话',
        tokens: 1,
        created_at: 2,
      }],
    });

    useSessionStore.getState().handleConversationRunEvent({
      ...base,
      sequence: 2,
      event: { type: 'message_chunk', text: '第二段' },
    });

    expect(useSessionStore.getState().messages).toEqual([
      expect.objectContaining({ id: 'other-message', content: '其它会话' }),
    ]);
    await useSessionStore.getState().selectSession('session-1');
    expect(useSessionStore.getState().messages).toEqual([
      sourceMessage,
      expect.objectContaining({
        id: base.messageId,
        content: '第一段第二段',
      }),
    ]);
    useSessionStore.getState().handleConversationRunEvent({
      ...base,
      sequence: 3,
      event: { type: 'message_done' },
    });
  });
});

describe('sessionStore Conversation Runtime Registry adapter', () => {
  beforeEach(() => {
    useSessionStore.setState({
      activeSessionId: 'session-old',
      messages: [{
        id: 'old-message',
        session_id: 'session-old',
        role: 'assistant',
        content: 'old Conversation',
        tokens: 1,
        created_at: 1,
      }],
      todos: [{ content: 'old todo', status: 'in_progress' }],
      isStreaming: false,
      streamingMessageId: null,
      error: { message: 'old error' },
    });
  });

  it('switches identity immediately and exposes target-specific loading before history resolves', async () => {
    let resolveMessages: ((messages: any[]) => void) | undefined;
    window.electronAPI = {
      db: {
        getMessages: vi.fn(() => new Promise((resolve) => { resolveMessages = resolve; })),
        getAgentRuns: vi.fn().mockResolvedValue([]),
        getAgentToolCalls: vi.fn().mockResolvedValue([]),
        getLatestTodos: vi.fn().mockResolvedValue([]),
      },
      conversation: { getActiveRun: vi.fn().mockResolvedValue(null) },
    } as unknown as Window['electronAPI'];

    const selecting = useSessionStore.getState().selectSession('session-new');

    expect(useSessionStore.getState()).toMatchObject({
      activeSessionId: 'session-new',
      messages: [],
      todos: [],
      error: null,
      isConversationLoading: true,
    });

    resolveMessages?.([{ id: 'new-message', session_id: 'session-new', role: 'assistant', content: 'new Conversation' }]);
    await selecting;
    expect(useSessionStore.getState()).toMatchObject({
      activeSessionId: 'session-new',
      isConversationLoading: false,
    });
  });

  it('keeps a background failure on its source Conversation and restores it on selection', async () => {
    let resolveMessages: ((messages: any[]) => void) | undefined;
    window.electronAPI = {
      db: {
        getMessages: vi.fn(() => new Promise((resolve) => { resolveMessages = resolve; })),
        getAgentRuns: vi.fn().mockResolvedValue([]),
        getAgentToolCalls: vi.fn().mockResolvedValue([]),
        getLatestTodos: vi.fn().mockResolvedValue([]),
      },
      conversation: { getActiveRun: vi.fn().mockResolvedValue(null) },
    } as unknown as Window['electronAPI'];
    useSessionStore.setState({ activeSessionId: 'session-1', error: null });

    useSessionStore.getState().handleConversationRunEvent({
      sessionId: 'session-2',
      requestId: 'request-error',
      messageId: 'message-error',
      origin: 'background-capability-continuation',
      sequence: 1,
      event: { type: 'runtime_error', error: 'source failed' },
    });

    expect(useSessionStore.getState().activeSessionId).toBe('session-1');
    expect(useSessionStore.getState().error).toBeNull();
    const selecting = useSessionStore.getState().selectSession('session-2');
    expect(useSessionStore.getState()).toMatchObject({
      activeSessionId: 'session-2',
      error: { message: 'source failed' },
      isConversationLoading: false,
    });
    resolveMessages?.([]);
    await selecting;
  });

  it('translates a sequence gap into complete snapshot hydration', async () => {
    const base = {
      sessionId: 'session-1',
      requestId: 'request-1',
      messageId: 'message-1',
      origin: 'background-capability-continuation' as const,
    };
    const getActiveRun = vi.fn().mockResolvedValue({
      ...base,
      sequence: 3,
      content: '完整结果',
      runId: 'run-1',
      agentId: 'agent-1',
      events: [
        { type: 'run_started', runId: 'run-1', agentId: 'agent-1', status: 'running' },
        { type: 'message_chunk', text: '完整结果' },
        { type: 'todos_update', todos: [{ content: 'snapshot todo', status: 'in_progress' }] },
      ],
    });
    window.electronAPI = {
      db: { getMessages: vi.fn().mockResolvedValue([]) },
      conversation: { getActiveRun },
    } as unknown as Window['electronAPI'];
    useSessionStore.setState({ activeSessionId: 'session-1', messages: [], todos: [] });

    useSessionStore.getState().handleConversationRunEvent({
      ...base,
      sequence: 1,
      event: { type: 'message_chunk', text: '不完整' },
    });
    useSessionStore.getState().handleConversationRunEvent({
      ...base,
      sequence: 3,
      event: { type: 'message_chunk', text: '跳过的增量' },
    });

    await vi.waitFor(() => expect(getActiveRun).toHaveBeenCalledWith('session-1'));
    await vi.waitFor(() => expect(useSessionStore.getState().messages).toContainEqual(
      expect.objectContaining({ id: 'message-1', content: '完整结果' }),
    ));
    expect(useSessionStore.getState().todos).toEqual([
      { content: 'snapshot todo', status: 'in_progress' },
    ]);
    expect(useSessionStore.getState().conversationRuntimeRegistry.entries['session-1']).toMatchObject({
      lastSequence: 3,
      hydrationPending: false,
    });
  });

  it('keeps a failed terminal save visible, releases busy state, and retries persistence', async () => {
    let chunkListener: ((event: unknown, data: LLMStreamEvent) => void | Promise<void>) | null = null;
    let assistantSaveAttempts = 0;
    const saveMessage = vi.fn(async (message: any) => {
      if (message.role === 'assistant') {
        assistantSaveAttempts += 1;
        if (assistantSaveAttempts === 1) throw new Error('disk temporarily unavailable');
      }
      return message;
    });
    window.electronAPI = {
      db: { saveMessage },
      llm: {
        onChunk: vi.fn((_requestId, callback) => {
          chunkListener = callback;
          return () => { chunkListener = null; };
        }),
        chat: vi.fn(async () => {
          await chunkListener?.(null, { type: 'message_chunk', text: 'terminal answer' });
          await chunkListener?.(null, { type: 'message_done' });
        }),
      },
      deepagents: { onParallelTaskStep: vi.fn(() => () => {}) },
    } as unknown as Window['electronAPI'];
    useSessionStore.setState({
      sessions: [{ id: 'session-1', project_id: 'project-1', name: 'One', created_at: 1, updated_at: 1 }],
      activeSessionId: 'session-1',
      messages: [],
      error: null,
    });

    await useSessionStore.getState().sendMessage('project-1', 'question');

    const failed = useSessionStore.getState();
    const entry = failed.conversationRuntimeRegistry.entries['session-1'];
    expect(entry).toMatchObject({ active: false, reconciliation: 'failed' });
    expect(failed.isStreaming).toBe(false);
    expect(failed.messages).toContainEqual(expect.objectContaining({ content: 'terminal answer' }));
    expect(failed.error?.recoverableActions).toHaveLength(1);

    failed.error?.recoverableActions?.[0]?.action();
    await vi.waitFor(() => {
      expect(useSessionStore.getState().conversationRuntimeRegistry.entries['session-1']).toBeUndefined();
    });
    expect(assistantSaveAttempts).toBe(2);
  });
});
