import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLLMStore } from './llmStore';
import { useSessionStore } from './sessionStore';

describe('sessionStore sendMessage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    useLLMStore.setState({
      providers: [],
      activeProvider: {
        id: 'provider-1',
        name: 'Test Provider',
        provider_type: 'openai',
        default_model: 'test-model',
        context_limit: 8192,
        is_active: 1,
        created_at: Date.now(),
        updated_at: Date.now(),
      },
      isLoading: false,
      error: null,
    });

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
    let chunkListener: ((event: unknown, data: { type: 'chunk' | 'done' | 'error'; text?: string; error?: string }) => void) | null = null;

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
          await chunkListener?.(null, { type: 'chunk', text: '你好，' });
          await chunkListener?.(null, { type: 'chunk', text: '世界' });
          await chunkListener?.(null, { type: 'done' });
        }),
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
    expect(saveMessage).toHaveBeenCalledTimes(2);
    expect(state.isStreaming).toBe(false);
    expect(state.streamingMessageId).toBe(null);
    expect(state.error).toBe(null);
    expect(state.messages.at(-1)?.content).toBe('你好，世界');
  });
});
