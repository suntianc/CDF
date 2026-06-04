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
