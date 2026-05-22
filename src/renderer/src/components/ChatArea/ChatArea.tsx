import { useState, useEffect, useRef, useMemo } from 'react';
import { useExternalStoreRuntime, AssistantRuntimeProvider } from '@assistant-ui/react';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useLLMStore } from '../../stores/llmStore';
import { 
  Send, Square, Sparkles, BookOpen, GitFork, ChevronRight, AlertCircle, X, Terminal,
  Paperclip, ChevronDown, Plus, Sliders, Layers
} from 'lucide-react';

interface ChatAreaProps {
  onOpenSettings?: () => void;
}

export function ChatArea({ onOpenSettings }: ChatAreaProps) {
  const { currentProjectId, projects, setProjects, setCurrentProject } = useProjectStore();
  const { 
    sessions, activeSessionId, messages, isStreaming, error, 
    sendMessage, selectSession, clearError, createSession, fetchSessions
  } = useSessionStore();
  const { providers, activeProvider, fetchProviders, saveProvider, setActiveProvider } = useLLMStore();

  const [inputVal, setInputVal] = useState('');
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize LLM providers to check active provider
  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  // Click outside listener for model selector
  useEffect(() => {
    const handleOutsideClick = () => {
      setModelSelectorOpen(false);
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  // Find active project name & active session
  const currentProjectName = useMemo(() => {
    return projects.find(p => p.id === currentProjectId)?.name || '未知项目';
  }, [currentProjectId, projects]);

  const activeSession = useMemo(() => {
    return sessions.find(s => s.id === activeSessionId) || null;
  }, [activeSessionId, sessions]);

  // Auto scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  // Convert our custom messages to assistant-ui representation
  const threadMessages = useMemo(() => {
    return messages.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant' | 'system',
      content: [{ type: 'text' as const, text: m.content }],
    }));
  }, [messages]);

  // Initialize the external store runtime for assistant-ui integration
  const runtime = useExternalStoreRuntime({
    messages: threadMessages,
    onNew: async (msg) => {
      const text = msg.content.filter(c => c.type === 'text').map(c => c.text).join('');
      if (currentProjectId) {
        await sendMessage(currentProjectId, text);
      }
    }
  });

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputVal.trim() || !currentProjectId || isStreaming) return;

    const value = inputVal;
    setInputVal('');
    await sendMessage(currentProjectId, value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleWelcomeSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputVal.trim() || isStreaming) return;

    let projectId = currentProjectId;
    try {
      if (!projectId) {
        const path = await window.electronAPI.db.selectDirectory();
        if (!path) return;
        const name = path.split('/').pop() || '新项目';
        const project = await window.electronAPI.db.createProject(name, path);
        setProjects([...projects, project]);
        setCurrentProject(project.id);
        projectId = project.id;
        await fetchSessions(project.id);
      }

      // Create new session
      const sessionName = inputVal.trim().slice(0, 15) || '新会话';
      const newSession = await createSession(projectId, sessionName);
      await selectSession(newSession.id);
      await fetchSessions(project.id); // Move before selectSession or await it

      const promptText = inputVal;
      setInputVal('');
      
      // Send message
      await sendMessage(projectId, promptText);
    } catch (err) {
      console.error('Failed to send from welcome:', err);
    }
  };

  const handleCreateProject = async () => {
    try {
      const path = await window.electronAPI.db.selectDirectory();
      if (path) {
        const name = path.split('/').pop() || '新项目';
        const project = await window.electronAPI.db.createProject(name, path);
        setProjects([...projects, project]);
        setCurrentProject(project.id);
        await fetchSessions(project.id);
      }
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  };

  const handleSelectModel = async (providerId: string, modelName: string) => {
    const provider = providers.find(p => p.id === providerId);
    if (!provider) return;
    
    const updated = {
      ...provider,
      default_model: modelName
    };
    await saveProvider(updated);
    await setActiveProvider(providerId);
    setModelSelectorOpen(false);
  };

  const getProviderModels = (provider: any) => {
    if (provider.models && provider.models.length > 0) {
      return provider.models;
    }
    if (provider.provider_type === 'openai') {
      return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];
    }
    if (provider.provider_type === 'anthropic') {
      return ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'];
    }
    if (provider.provider_type === 'ollama') {
      return ['llama3', 'llama3.1', 'codellama', 'mistral'];
    }
    return [provider.default_model];
  };

  // Helper to parse and render code blocks inside dialogue bubbles
  const renderMessageContent = (content: string) => {
    if (!content) return null;
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map((part, index) => {
      if (part.startsWith('```')) {
        const match = part.match(/```(\w*)\n([\s\S]*?)```/);
        const lang = match ? match[1] : '';
        const code = match ? match[2] : part.slice(3, -3);
        return (
          <div key={index} className="my-3 border border-[var(--color-border)] rounded-lg overflow-hidden font-mono text-xs bg-[var(--color-bg-sidebar)] shadow-md">
            <div className="flex justify-between items-center px-4 py-1.5 bg-black/20 text-[var(--color-text-secondary)] border-b border-[var(--color-border)] select-none">
              <span className="uppercase text-xs font-bold text-[var(--color-accent)] tracking-wider">
                {lang || 'code'}
              </span>
              <button
                onClick={() => navigator.clipboard.writeText(code)}
                className="hover:text-[var(--color-text-primary)] transition-colors text-xs font-medium px-1.5 py-0.5 rounded hover:bg-[var(--color-bg-hover)]"
              >
                复制
              </button>
            </div>
            <pre className="p-4 overflow-x-auto text-[var(--color-text-primary)] select-text">
              <code>{code}</code>
            </pre>
          </div>
        );
      }
      return (
        <p key={index} className="whitespace-pre-wrap leading-relaxed select-text text-sm">
          {part}
        </p>
      );
    });
  };

  // 1. Onboarding / Welcome view (if no session is active)
  if (!activeSessionId) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center p-6 relative bg-[var(--bg-app)] overflow-hidden">
        <div className="center-bg-glow" />
        
        <div className="max-w-[640px] w-full flex flex-col items-center gap-6 z-10">
          <h1 className="center-headline">现在让它们<span>动起来</span>？</h1>
          <p className="center-subline">
            {currentProjectId 
              ? `项目已加载：${currentProjectName} · 请输入以开启对话` 
              : '选择左侧的项目或开始一个新对话，CDF 已经准备就绪'}
          </p>

          <div className="dialog-box">
            <textarea
              className="dialog-input animate-fade-in"
              placeholder="给 CDF 下达指令，或者问点什么……"
              rows={1}
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleWelcomeSend();
                }
              }}
            />
            <div className="dialog-bottom">
              <div className="dialog-bottom-left">
                <button type="button" className="dialog-btn" title="添加附件" aria-label="添加附件">
                  <Paperclip className="w-4 h-4" />
                </button>
                
                <div 
                  className={`model-selector ${modelSelectorOpen ? 'open' : ''}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    onClick={() => setModelSelectorOpen(!modelSelectorOpen)}
                    className="model-selector-trigger"
                  >
                    <span className="model-selector-label">
                      {activeProvider ? `${activeProvider.name} • ${activeProvider.default_model}` : '选择模型'}
                    </span>
                    <ChevronDown className="model-chevron w-3.5 h-3.5" />
                  </div>
                  <div className="model-dropdown">
                    {providers.length === 0 ? (
                      <div 
                        onClick={() => {
                          setModelSelectorOpen(false);
                          onOpenSettings?.();
                        }}
                        className="model-select-option text-[var(--color-text-muted)] italic cursor-pointer text-center py-2"
                      >
                        暂无可用提供商，点击去配置
                      </div>
                    ) : (
                      providers.map((p) => (
                        <div key={p.id} className="model-group">
                          <div className="model-group-name">{p.name}</div>
                          {getProviderModels(p).map((m: string) => (
                            <div
                              key={m}
                              className={`model-select-option ${
                                activeProvider?.id === p.id && activeProvider?.default_model === m
                                  ? 'selected'
                                  : ''
                              }`}
                              onClick={() => handleSelectModel(p.id, m)}
                            >
                              {m}
                            </div>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleWelcomeSend()}
                disabled={!inputVal.trim() || isStreaming}
                className="dialog-btn send"
                title="发送"
              >
                <Send className="w-4.5 h-4.5" />
              </button>
              <span className="sr-only">发送消息</span>
            </div>
          </div>

          <div className="feature-rows">
            <div className="feature-card" onClick={handleCreateProject}>
              <div className="feature-card-icon">
                <Plus className="w-4 h-4" />
              </div>
              <div className="feature-card-title">创建项目</div>
              <div className="feature-card-desc">导入代码仓库或新建空白项目</div>
            </div>
            
            <div className="feature-card" onClick={() => onOpenSettings?.()}>
              <div className="feature-card-icon">
                <Sliders className="w-4 h-4" />
              </div>
              <div className="feature-card-title">配置 Skills</div>
              <div className="feature-card-desc">安装和启用智能体能力模块</div>
            </div>

            <div className="feature-card" onClick={() => onOpenSettings?.()}>
              <div className="feature-card-icon">
                <Layers className="w-4 h-4" />
              </div>
              <div className="feature-card-title">连接 MCP</div>
              <div className="feature-card-desc">配置数据源和外部工具集成</div>
            </div>
          </div>

          <div className="dialog-footer">
            <span className="dialog-footer-hint">
              按下 <kbd>Enter</kbd> 发送 · <kbd>Shift+Enter</kbd> 换行
            </span>
          </div>
        </div>
      </main>
    );
  }

  // 2. Active chat view
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex-1 flex flex-col h-full bg-[var(--color-bg-app)] overflow-hidden relative">
        
        {/* Chat Header */}
        <header className="main-topbar">
          <div className="main-topbar-left">
            <h1>{activeSession.name}</h1>
            <span className="project-badge">{currentProjectName}</span>
          </div>

          <div className="main-topbar-actions">
            {activeProvider ? (
              <button 
                onClick={onOpenSettings}
                className="topbar-btn"
                title="点击配置 LLM"
              >
                <Sparkles className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                <span>{activeProvider.name} • {activeProvider.default_model}</span>
              </button>
            ) : (
              <button 
                onClick={onOpenSettings}
                className="topbar-btn text-[var(--color-warning)] bg-[var(--color-warning-dim)] border border-[var(--color-warning)]/20"
                title="点击进行 LLM 配置"
              >
                <AlertCircle className="w-3.5 h-3.5 text-[var(--color-warning)]" />
                <span>未配置模型，点击配置</span>
              </button>
            )}
          </div>
        </header>

        {/* Messages Viewport */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="messages flex-1 overflow-y-auto">
            {/* Cascade Summary Box if available */}
            {activeSession?.summary && (
              <div className="mb-6 p-4 rounded-xl border border-[var(--color-accent)]/20 bg-gradient-to-br from-[var(--color-accent-dim)] to-transparent relative overflow-hidden flex flex-col gap-2 shadow-sm">
                <div className="absolute top-0 right-0 p-3 opacity-5 select-none pointer-events-none">
                  <BookOpen className="w-20 h-20 text-[var(--color-accent)]" />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-[var(--color-accent)] font-semibold">
                    <GitFork className="w-3.5 h-3.5" />
                    <span>前序会话级联摘要</span>
                  </div>
                  {activeSession.parent_session_id && (
                    <button
                      onClick={() => selectSession(activeSession.parent_session_id!)}
                      className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] font-medium flex items-center gap-0.5 transition-all"
                    >
                      <span>回溯父会话历史</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed italic border-l-2 border-[var(--color-accent)]/30 pl-3">
                  "{activeSession.summary}"
                </p>
              </div>
            )}

            {/* Messages List */}
            {messages.map((message) => (
              <div 
                key={message.id}
                className={`message ${message.role === 'user' ? 'user' : 'assistant'}`}
              >
                <div className="message-bubble">
                  {renderMessageContent(message.content)}
                  <div className="message-time">
                    {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {message.tokens && message.tokens > 0 ? ` · ${message.tokens} tokens` : ''}
                  </div>
                </div>
              </div>
            ))}

            {/* Typing Indicator while streaming empty block */}
            {isStreaming && messages.length > 0 && messages[messages.length - 1].content === '' && (
              <div className="message assistant animate-pulse">
                <div className="message-bubble">
                  <div className="flex items-center gap-1 py-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            {/* Error Banner */}
            {error && (
              <div className="p-3 bg-[var(--color-danger-dim)] border border-[var(--color-danger)]/20 rounded-xl flex items-start gap-2.5 text-xs text-[var(--color-danger)] shadow-sm animate-shake">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="flex-1">{error}</div>
                <button 
                  onClick={clearError}
                  className="p-0.5 rounded hover:bg-white/10 text-[var(--color-danger)]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Composer Panel */}
        <div className="p-4 border-t border-[var(--color-border)] bg-[var(--color-bg-app)] shrink-0 z-10">
          <form onSubmit={handleSend} className="flex gap-2 bg-[var(--color-bg-surface)] border border-[var(--color-border)] focus-within:border-[var(--color-accent)] focus-within:ring-1 focus-within:ring-[var(--color-accent)]/20 rounded-xl px-4 py-3 transition-all shadow-sm">
            <textarea
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={activeProvider ? "给 Master Agent 发送消息..." : "请先配置模型提供商以开启对话..."}
              disabled={!activeProvider || isStreaming}
              rows={1}
              className="flex-1 bg-transparent text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none resize-none text-sm self-center min-h-5 max-h-28"
            />
            {isStreaming ? (
              <button
                type="button"
                className="p-2.5 rounded-lg bg-[var(--color-danger-dim)] hover:bg-[var(--color-danger)] hover:text-white text-[var(--color-danger)] transition-all self-center"
                title="停止生成 (暂未支持)"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!activeProvider || !inputVal.trim() || isStreaming}
                className="p-2.5 rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-hover)] disabled:text-[var(--color-text-muted)] text-white transition-all shadow-md self-center flex items-center justify-center"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </form>
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}
