import { create } from 'zustand';
import { ChatRuntimeOverrides, LLMStreamEvent, Message, Session } from '../../../shared/types';

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let englishChars = 0;
  let cjkChars = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) {
      cjkChars++;
    } else {
      englishChars++;
    }
  }
  return Math.ceil(englishChars / 4) + Math.ceil(cjkChars * 1.5);
}

interface SessionState {
  sessions: Session[];
  activeSessionId: string | null;
  messages: Message[];
  isStreaming: boolean;
  streamingMessageId: string | null;
  error: string | null;
  fetchSessions: (projectId: string) => Promise<void>;
  createSession: (projectId: string, name: string, parentSessionId?: string, summary?: string) => Promise<Session>;
  deleteSession: (sessionId: string) => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  sendMessage: (projectId: string, content: string, overrides?: ChatRuntimeOverrides) => Promise<void>;
  stopMessage: () => Promise<void>;
  checkContextThreshold: (projectId: string) => Promise<void>;
  clearError: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  isStreaming: false,
  streamingMessageId: null,
  error: null,

  fetchSessions: async (projectId: string) => {
    try {
      const sessions = await window.electronAPI.db.getSessions(projectId);
      set({ sessions });
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch sessions' });
    }
  },

  createSession: async (projectId: string, name: string, parentSessionId?: string, summary?: string) => {
    try {
      const newSession = await window.electronAPI.db.createSession(projectId, name, parentSessionId, summary);
      await get().fetchSessions(projectId);
      return newSession;
    } catch (err: any) {
      set({ error: err.message || 'Failed to create session' });
      throw err;
    }
  },

  deleteSession: async (sessionId: string) => {
    try {
      await window.electronAPI.db.deleteSession(sessionId);
      set((state) => {
        const remaining = state.sessions.filter((s) => s.id !== sessionId);
        const nextActive = state.activeSessionId === sessionId
          ? (remaining[0]?.id || null)
          : state.activeSessionId;
        return {
          sessions: remaining,
          activeSessionId: nextActive,
        };
      });
      
      const { activeSessionId } = get();
      if (activeSessionId) {
        await get().selectSession(activeSessionId);
      } else {
        set({ messages: [] });
      }
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete session' });
    }
  },

  selectSession: async (sessionId: string) => {
    try {
      const messages = await window.electronAPI.db.getMessages(sessionId);
      set({ activeSessionId: sessionId, messages, error: null });
    } catch (err: any) {
      set({ error: err.message || 'Failed to load messages for session' });
    }
  },

  sendMessage: async (projectId: string, content: string, overrides?: ChatRuntimeOverrides) => {
    const { activeSessionId, isStreaming } = get();
    if (!activeSessionId || isStreaming) return;

    const userMsgId = window.crypto.randomUUID();
    const userTokens = estimateTokens(content);
    const userMsg: Message = {
      id: userMsgId,
      session_id: activeSessionId,
      role: 'user',
      content,
      tokens: userTokens,
      created_at: Date.now(),
    };

    try {
      // Save User Message to SQLite
      await window.electronAPI.db.saveMessage(userMsg);

      // Append User message and placeholder Assistant message
      const assistantMsgId = window.crypto.randomUUID();
      const assistantMsgPlaceholder: Message = {
        id: assistantMsgId,
        session_id: activeSessionId,
        role: 'assistant',
        content: '',
        tokens: 0,
        created_at: Date.now(),
      };

      set((state) => ({
        messages: [...state.messages, userMsg, assistantMsgPlaceholder],
        isStreaming: true,
        streamingMessageId: assistantMsgId,
        error: null,
      }));

      let accumulatedContent = '';
      let cleanup = () => {};
      const pendingToolMessages = new Map<string, string[]>();
      let currentAssistantMsgId = assistantMsgId;

      const streamPromise = new Promise<void>((resolve, reject) => {
        cleanup = window.electronAPI.llm.onChunk(assistantMsgId, async (_event, data: LLMStreamEvent) => {
          if (data.type === 'message_chunk' && data.text) {
            const hasMsg = get().messages.some((m) => m.id === currentAssistantMsgId);
            if (!hasMsg) {
              const newPlaceholder: Message = {
                id: currentAssistantMsgId,
                session_id: activeSessionId!,
                role: 'assistant',
                content: '',
                tokens: 0,
                created_at: Date.now(),
              };
              set((state) => ({
                messages: [...state.messages, newPlaceholder],
              }));
            }

            accumulatedContent += data.text;
            set((state) => ({
              messages: state.messages.map((m) =>
                m.id === currentAssistantMsgId ? { ...m, content: accumulatedContent } : m
              ),
            }));
            return;
          }

          if (data.type === 'tool_start') {
            // 1. 如果上一段助手有说话，将其持久化写入 SQLite
            if (accumulatedContent.trim()) {
              const prevMsg = {
                id: currentAssistantMsgId,
                session_id: activeSessionId!,
                role: 'assistant' as const,
                content: accumulatedContent,
                tokens: estimateTokens(accumulatedContent),
              };
              window.electronAPI.db.saveMessage(prevMsg).catch((err) => {
                console.error('Failed to save intermediate assistant message:', err);
              });
            }

            // 2. 插入运行中的工具卡片
            const toolMessageId = window.crypto.randomUUID();
            const queue = pendingToolMessages.get(data.name) || [];
            queue.push(toolMessageId);
            pendingToolMessages.set(data.name, queue);

            const toolMsgContent = {
              type: 'tool',
              name: data.name,
              status: 'running',
              input: data.input,
            };

            const toolMsg: Message = {
              id: toolMessageId,
              session_id: activeSessionId!,
              role: 'system',
              content: JSON.stringify(toolMsgContent),
              created_at: Date.now(),
              tokens: 0,
            };

            set((state) => ({
              messages: [...state.messages, toolMsg],
            }));

            window.electronAPI.db.saveMessage(toolMsg).catch((err) => {
              console.error('Failed to save tool start message:', err);
            });

            // 3. 准备切换下一段助手消息
            currentAssistantMsgId = window.crypto.randomUUID();
            accumulatedContent = '';
            return;
          }

          if (data.type === 'tool_end' || data.type === 'tool_error') {
            const queue = pendingToolMessages.get(data.name) || [];
            const toolMessageId = queue.shift();
            pendingToolMessages.set(data.name, queue);
            if (toolMessageId) {
              const isEnd = data.type === 'tool_end';
              
              const currentMsg = get().messages.find(m => m.id === toolMessageId);
              let parsedContent: any = {};
              if (currentMsg) {
                try {
                  parsedContent = JSON.parse(currentMsg.content);
                } catch (e) {
                  parsedContent = { type: 'tool', name: data.name };
                }
              } else {
                parsedContent = { type: 'tool', name: data.name };
              }

              const newContentObj = {
                ...parsedContent,
                status: isEnd ? 'success' : 'error',
                output: isEnd ? data.output : undefined,
                error: !isEnd ? data.error : undefined,
              };

              const updatedContent = JSON.stringify(newContentObj);

              set((state) => ({
                messages: state.messages.map((m) =>
                  m.id === toolMessageId ? { ...m, content: updatedContent } : m
                ),
              }));

              const savedMsg = {
                id: toolMessageId,
                session_id: activeSessionId!,
                role: 'system' as const,
                content: updatedContent,
                created_at: currentMsg?.created_at || Date.now(),
                tokens: 0,
              };

              window.electronAPI.db.saveMessage(savedMsg).catch((err) => {
                console.error('Failed to save tool output to db:', err);
              });
            }
            return;
          }

          if (data.type === 'message_done') {
            cleanup();
            try {
              if (accumulatedContent.trim()) {
                const assistantTokens = estimateTokens(accumulatedContent);
                const finalAssistantMsg = {
                  id: currentAssistantMsgId,
                  session_id: activeSessionId!,
                  role: 'assistant' as const,
                  content: accumulatedContent,
                  tokens: assistantTokens,
                };

                await window.electronAPI.db.saveMessage(finalAssistantMsg);
                
                set((state) => ({
                  messages: state.messages
                    .map((m) =>
                      m.id === currentAssistantMsgId ? { ...m, tokens: assistantTokens } : m
                    )
                    .filter((m) => !(m.role === 'assistant' && m.content === '')),
                  isStreaming: false,
                  streamingMessageId: null,
                }));
              } else {
                set((state) => ({
                  messages: state.messages.filter((m) => !(m.role === 'assistant' && m.content === '')),
                  isStreaming: false,
                  streamingMessageId: null,
                }));
              }
              resolve();
            } catch (err: any) {
              console.error('Failed to save message or complete stream:', err);
              set((state) => ({
                messages: state.messages.filter((m) => !(m.role === 'assistant' && m.content === '')),
                isStreaming: false,
                streamingMessageId: null,
                error: err.message || '保存回复消息失败',
              }));
              reject(err);
            }
            return;
          }

          if (data.type === 'runtime_error') {
            cleanup();
            const toolMsgIds = new Set([...pendingToolMessages.values()].flat());
            set((state) => ({
              messages: state.messages.filter(
                (m) => m.id !== assistantMsgId && m.id !== currentAssistantMsgId && !toolMsgIds.has(m.id) && !(m.role === 'assistant' && m.content === '')
              ),
              isStreaming: false,
              streamingMessageId: null,
              error: data.error || '对话请求出错',
            }));
            reject(new Error(data.error || '对话请求出错'));
          }
        });
      });

      try {
        await window.electronAPI.llm.chat(assistantMsgId, {
          projectId,
          sessionId: activeSessionId,
          overrides,
        });
        await streamPromise;
      } catch (err: any) {
        cleanup();
        // 移除未持久化的 assistant 占位和工具消息
        const toolMsgIds = new Set([...pendingToolMessages.values()].flat());
        set((state) => ({
          messages: state.messages.filter(
            (m) => m.id !== assistantMsgId && m.id !== currentAssistantMsgId && !toolMsgIds.has(m.id) && !(m.role === 'assistant' && m.content === '')
          ),
          isStreaming: false,
          streamingMessageId: null,
          error: err.message || '发送消息失败',
        }));
      }
    } catch (err: any) {
      set({
        isStreaming: false,
        streamingMessageId: null,
        error: err.message || '发送消息失败',
      });
    }
  },

  stopMessage: async () => {
    const { streamingMessageId } = get();
    if (!streamingMessageId) return;
    try {
      await window.electronAPI.llm.stopChat(streamingMessageId);
    } catch (err: any) {
      console.error('Failed to stop chat message streaming:', err);
    }
  },
  checkContextThreshold: async () => {},

  clearError: () => set({ error: null }),
}));
