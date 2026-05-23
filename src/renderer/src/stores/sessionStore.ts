import { create } from 'zustand';
import { Message, Session } from '../../../shared/types';
import { useLLMStore } from './llmStore';

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
  sendMessage: (projectId: string, content: string) => Promise<void>;
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

  sendMessage: async (projectId: string, content: string) => {
    const { activeSessionId, isStreaming } = get();
    if (!activeSessionId || isStreaming) return;

    const activeProvider = useLLMStore.getState().activeProvider;
    if (!activeProvider) {
      set({ error: '请先在模型设置中配置并激活一个大语言模型提供商。' });
      return;
    }

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

      // Assemble LLM Context Payload
      const activeSession = get().sessions.find((s) => s.id === activeSessionId);
      const llmMessages: { role: string; content: string }[] = [];

      if (activeSession?.summary) {
        llmMessages.push({
          role: 'system',
          content: `系统提示：由于前序对话长度已达到上下文限制，系统已自动级联。以下是前序对话的摘要总结，请在此背景上下文中继续与用户对话：\n"""\n${activeSession.summary}\n"""`,
        });
      }

      // Add actual conversation history (excluding the new assistant placeholder)
      const currentHistory = get().messages.filter((m) => m.id !== assistantMsgId);
      llmMessages.push(...currentHistory.map((m) => ({ role: m.role, content: m.content })));

      let accumulatedContent = '';
      let cleanup = () => {};
      const streamPromise = new Promise<void>((resolve, reject) => {
        cleanup = window.electronAPI.llm.onChunk(assistantMsgId, async (_event, data) => {
          if (data.type === 'chunk' && data.text) {
            accumulatedContent += data.text;
            set((state) => ({
              messages: state.messages.map((m) =>
                m.id === assistantMsgId ? { ...m, content: accumulatedContent } : m
              ),
            }));
            return;
          }

          if (data.type === 'done') {
            cleanup();
            try {
              const assistantTokens = estimateTokens(accumulatedContent);
              const finalAssistantMsg = {
                id: assistantMsgId,
                session_id: activeSessionId,
                role: 'assistant',
                content: accumulatedContent,
                tokens: assistantTokens,
              };

              // Persist Assistant message in SQLite
              await window.electronAPI.db.saveMessage(finalAssistantMsg);
              set((state) => ({
                messages: state.messages.map((m) =>
                  m.id === assistantMsgId ? { ...m, tokens: assistantTokens } : m
                ),
                isStreaming: false,
                streamingMessageId: null,
              }));

              // Check context window usage threshold (85%)
              await get().checkContextThreshold(projectId);
              resolve();
            } catch (err: any) {
              console.error('Failed to save message or complete stream:', err);
              set({
                isStreaming: false,
                streamingMessageId: null,
                error: err.message || '保存回复消息失败',
              });
              reject(err);
            }
            return;
          }

          if (data.type === 'error') {
            cleanup();
            const streamError = new Error(data.error || '对话请求出错');
            set({
              isStreaming: false,
              streamingMessageId: null,
              error: streamError.message,
            });
            reject(streamError);
          }
        });
      });

      try {
        await window.electronAPI.llm.chat(assistantMsgId, {
          providerId: activeProvider.id,
          model: activeProvider.default_model,
          messages: llmMessages,
        });
        await streamPromise;
      } catch (err: any) {
        cleanup();
        set({
          isStreaming: false,
          streamingMessageId: null,
          error: err.message || '发送消息失败',
        });
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

  checkContextThreshold: async (projectId: string) => {
    const { activeSessionId, messages } = get();
    if (!activeSessionId) return;

    const activeProvider = useLLMStore.getState().activeProvider;
    if (!activeProvider) return;

    const contextLimit = activeProvider.context_limit || 8192;
    const totalTokens = messages.reduce((sum, m) => sum + (m.tokens || 0), 0);

    if (totalTokens >= contextLimit * 0.85) {
      console.log(`Context limit threshold reached (${totalTokens}/${contextLimit}). Triggering silent auto-summarization...`);
      
      const activeSession = get().sessions.find((s) => s.id === activeSessionId);
      if (!activeSession) return;

      // Request LLM for summary
      const summarizationMessages = messages.map((m) => ({ role: m.role, content: m.content }));
      summarizationMessages.push({
        role: 'user',
        content: '请简要总结我们之前的所有对话内容，提炼核心要点与当前的状态，以作后续对话的上下文参考。字数控制在 200 字以内。必须仅回复总结正文，不要包含任何前导词或说明。',
      });

      const summarizeRequestId = window.crypto.randomUUID();
      let summaryText = '';

      try {
        await window.electronAPI.llm.chat(summarizeRequestId, {
          providerId: activeProvider.id,
          model: activeProvider.default_model,
          messages: summarizationMessages,
        });

        await new Promise<void>((resolve, reject) => {
          const cleanup = window.electronAPI.llm.onChunk(summarizeRequestId, (_event, data) => {
            if (data.type === 'chunk' && data.text) {
              summaryText += data.text;
            } else if (data.type === 'done') {
              cleanup();
              resolve();
            } else if (data.type === 'error') {
              cleanup();
              reject(new Error(data.error || 'Failed to summarize'));
            }
          });
        });

        const childSessionName = `${activeSession.name} (续)`;
        const newSession = await window.electronAPI.db.createSession(
          projectId,
          childSessionName,
          activeSessionId,
          summaryText
        );

        // Switch to the newly created cascade session
        await get().fetchSessions(projectId);
        await get().selectSession(newSession.id);
        
        console.log('Successfully cascaded to child session:', newSession.id);
      } catch (err: any) {
        console.error('Failed to auto-summarize:', err);
        set({ error: `级联总结自动触发失败: ${err.message}` });
      }
    }
  },

  clearError: () => set({ error: null }),
}));
