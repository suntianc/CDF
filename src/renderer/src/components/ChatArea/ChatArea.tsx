import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useLLMStore } from '../../stores/llmStore';
import { useAgentStore } from '../../stores/agentStore';
import { 
  ArrowUp, Square, Sparkles, AlertCircle, X, Terminal,
  Paperclip, ChevronDown, Plus, Sliders, Layers, PanelLeft, Info, Copy, Check,
  ChevronUp, Brain, Loader2
} from 'lucide-react';
import { ToolMessageCard, ToolGroupCard } from './ToolMessageCard';

import { MessageItem } from './MessageItem';
import { useChatScroll } from './useChatScroll';
import { TodoList } from './TodoList';

interface ChatAreaProps {
  onOpenSettings?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  taskPanelOpen?: boolean;
  onToggleTaskPanel?: () => void;
}

export function ChatArea({ 
  onOpenSettings, 
  sidebarCollapsed, 
  onToggleSidebar,
  taskPanelOpen,
  onToggleTaskPanel 
}: ChatAreaProps) {
  const { currentProjectId, projects, setProjects, setCurrentProject } = useProjectStore();
  const { 
    sessions, activeSessionId, messages, isStreaming, streamingMessageId, activeRunId, error, todos,
    sendMessage, selectSession, clearError, createSession, fetchSessions, stopMessage
  } = useSessionStore();
  const { providers, fetchProviders } = useLLMStore();
  const { agents, fetchAgents } = useAgentStore();

  const [inputVal, setInputVal] = useState('');
  const [welcomeModelSelectorOpen, setWelcomeModelSelectorOpen] = useState(false);
  const [composerModelSelectorOpen, setComposerModelSelectorOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [todoExpandedByPlan, setTodoExpandedByPlan] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const justFinishedComposingRef = useRef(false);
  const compositionEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousSessionIdRef = useRef<string | null>(null);
  const previousHasActivePlanRef = useRef(false);

  const { handleScroll } = useChatScroll({
    scrollContainerRef,
    messages,
    activeSessionId,
    isStreaming,
  });

  const hasTodos = todos.length > 0;
  const allTodosCompleted = hasTodos && todos.every((todo) => todo.status === 'completed');
  const hasActiveTodos = hasTodos && todos.some((todo) => todo.status !== 'completed');
  const hasActivePlan = isStreaming && hasActiveTodos;
  const shouldShowTodos = hasActivePlan;
  const todoPlanKey = activeSessionId && hasActivePlan
    ? `${activeSessionId}:${streamingMessageId || activeRunId || 'pending'}`
    : null;
  const todoExpanded = todoPlanKey ? todoExpandedByPlan[todoPlanKey] ?? false : false;

  const toggleTodoExpanded = () => {
    if (!todoPlanKey) return;
    setTodoExpandedByPlan((prev) => ({
      ...prev,
      [todoPlanKey]: !(prev[todoPlanKey] ?? false),
    }));
  };

  useEffect(() => {
    const previousSessionId = previousSessionIdRef.current;
    const stayedInSameSession = previousSessionId === activeSessionId;
    const planStartedInCurrentSession = Boolean(todoPlanKey && stayedInSameSession && !previousHasActivePlanRef.current);

    if (planStartedInCurrentSession) {
      setTodoExpandedByPlan((prev) => (
        prev[todoPlanKey] === undefined ? { ...prev, [todoPlanKey]: true } : prev
      ));
    }

    previousSessionIdRef.current = activeSessionId;
    previousHasActivePlanRef.current = hasActivePlan;
  }, [activeSessionId, hasActivePlan, todoPlanKey]);

  useEffect(() => {
    if (!allTodosCompleted) {
      return;
    }

    const timer = setTimeout(() => {
      // Clear todos directly in the store when automatically closing the completed todo list
      useSessionStore.setState({ todos: [] });
    }, 2000);
    return () => clearTimeout(timer);
  }, [allTodosCompleted, todos]);

  // Defensive mount-time isStreaming reset to prevent stuck loading states
  useEffect(() => {
    useSessionStore.setState({ isStreaming: false, streamingMessageId: null });
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    return () => {
      if (compositionEndTimerRef.current) {
        clearTimeout(compositionEndTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!currentProjectId) return;
    fetchAgents(currentProjectId);
  }, [currentProjectId, fetchAgents]);

  useEffect(() => {
    const handleOutsideClick = () => {
      setWelcomeModelSelectorOpen(false);
      setComposerModelSelectorOpen(false);
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

  // 聚合相邻的工具系统消息（连续工具调用折叠合并逻辑）
  const renderItems = useMemo(() => {
    const items: Array<
      | { type: 'message'; id: string; message: any }
      | { type: 'tool_group'; id: string; tools: any[] }
    > = [];
    
    let currentGroup: any[] = [];
    let currentGroupStartId: string | null = null;

    (messages || []).forEach((message) => {
      let isTool = false;
      if (message.role === 'system') {
        try {
          const parsed = JSON.parse(message.content);
          if (parsed && parsed.type === 'tool') {
            isTool = true;
          }
        } catch (e) {
          // 不是 JSON 格式的工具消息
        }
      }

      if (isTool) {
        if (currentGroup.length === 0) {
          currentGroupStartId = message.id;
        }
        currentGroup.push(message);
      } else {
        if (currentGroup.length > 0) {
          items.push({
            type: 'tool_group',
            id: currentGroupStartId || `tool-group-${message.id}`,
            tools: currentGroup
          });
          currentGroup = [];
          currentGroupStartId = null;
        }
        items.push({
          type: 'message',
          id: message.id,
          message
        });
      }
    });

    if (currentGroup.length > 0) {
      items.push({
        type: 'tool_group',
        id: currentGroupStartId || 'tool-group-end',
        tools: currentGroup
      });
    }

    return items;
  }, [messages]);


  const defaultAgent = useMemo(() => {
    return agents.find((agent) => agent.project_id === currentProjectId && agent.is_default === 1) || null;
  }, [agents, currentProjectId]);

  const activeSessionAgent = useMemo(() => {
    return agents.find((agent) => agent.id === activeSession?.agent_id) || defaultAgent;
  }, [activeSession?.agent_id, agents, defaultAgent]);

  const masterProvider = useMemo(() => {
    const baseAgent = activeSession ? activeSessionAgent : defaultAgent;
    return providers.find((provider) => provider.id === baseAgent?.provider_id) || null;
  }, [activeSession, activeSessionAgent, defaultAgent, providers]);

  const selectedProvider = useMemo(() => {
    return providers.find((provider) => provider.id === selectedProviderId) || null;
  }, [providers, selectedProviderId]);

  const selectedProviderModels = useMemo(() => {
    if (!selectedProvider) return [];
    const models = [selectedProvider.default_model, ...(selectedProvider.models || [])].filter(Boolean);
    return Array.from(new Set(models));
  }, [selectedProvider]);

  useEffect(() => {
    if (!selectedProvider) {
      if (selectedModel) setSelectedModel('');
      return;
    }

    if (!selectedProviderModels.includes(selectedModel)) {
      setSelectedModel(selectedProviderModels[0] || '');
    }
  }, [selectedModel, selectedProvider, selectedProviderModels]);

  const getProviderModels = (provider: { default_model: string; models?: string[] }) => {
    const models = [provider.default_model, ...(provider.models || [])].filter(Boolean);
    return Array.from(new Set(models));
  };

  const currentProvider = selectedProvider || masterProvider;
  const currentModel = selectedModel || masterProvider?.default_model || '';
  const currentModelLabel = currentProvider
    ? `${currentProvider.name} • ${currentModel || currentProvider.default_model}`
    : '选择模型';
  const activeAgentLabel = activeSessionAgent
    ? `${activeSessionAgent.name} · ${activeSessionAgent.mcpServerIds?.length || 0} MCP · ${activeSessionAgent.skillNames?.length || 0} Skills`
    : '未绑定 Agent';

  const handleSelectModel = (providerId: string, modelName: string) => {
    setSelectedProviderId(providerId);
    setSelectedModel(modelName);
    setWelcomeModelSelectorOpen(false);
    setComposerModelSelectorOpen(false);
  };





  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputVal.trim() || !currentProjectId || isStreaming) return;

    const value = inputVal;
    setInputVal('');

    await sendMessage(currentProjectId, value, {
      providerId: selectedProviderId || undefined,
      model: selectedModel || undefined,
    });
  };

  const handleCompositionStart = () => {
    if (compositionEndTimerRef.current) {
      clearTimeout(compositionEndTimerRef.current);
      compositionEndTimerRef.current = null;
    }
    isComposingRef.current = true;
    justFinishedComposingRef.current = false;
  };

  const handleCompositionEnd = () => {
    isComposingRef.current = false;
    justFinishedComposingRef.current = true;
    if (compositionEndTimerRef.current) {
      clearTimeout(compositionEndTimerRef.current);
    }
    compositionEndTimerRef.current = setTimeout(() => {
      justFinishedComposingRef.current = false;
      compositionEndTimerRef.current = null;
    }, 200);
  };

  const consumeJustFinishedComposing = () => {
    justFinishedComposingRef.current = false;
    if (compositionEndTimerRef.current) {
      clearTimeout(compositionEndTimerRef.current);
      compositionEndTimerRef.current = null;
    }
  };

  const isComposingKeyEvent = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const nativeEvent = e.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number; which?: number };
    return isComposingRef.current || e.isComposing || nativeEvent.isComposing || nativeEvent.keyCode === 229 || nativeEvent.which === 229;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingKeyEvent(e)) return; // 允许输入法底层在合成中进行正常的字符处理
    if (e.key === 'Enter' && !e.shiftKey) {
      if (justFinishedComposingRef.current) {
        consumeJustFinishedComposing();
        e.preventDefault(); // 阻止输入法合成结束瞬间产生的回车事件冒泡提交易引发误发
        return;
      }
      if (isStreaming) {
        // 如果正在生成回复，回车只执行普通换行，不阻止默认行为也不发送
        return;
      }
      e.preventDefault();
      handleSend();
    }
  };

  const handleWelcomeSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputVal.trim() || isStreaming) return;

    let projectId = currentProjectId || 'default-project';
    try {
      // Create new session
      const sessionName = inputVal.trim().slice(0, 15) || '新会话';
      const newSession = await createSession(projectId, sessionName);
      await selectSession(newSession.id);
      await fetchSessions(projectId); // Move before selectSession or await it

      const promptText = inputVal;
      setInputVal('');
      
      // Send message
      await sendMessage(projectId, promptText, {
        providerId: selectedProviderId || undefined,
        model: selectedModel || undefined,
      });
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

  // Old renderMessageContent removed. MessageItem is now declared at module scope.

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--color-bg-app)] overflow-hidden relative">
      {/* Onboarding / Welcome view */}
      <main
        className={`absolute inset-0 flex flex-col items-center justify-center p-6 bg-[var(--bg-app)] overflow-hidden transition-all duration-300 ease-in-out ${
          !activeSessionId
            ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto z-10'
            : 'opacity-0 translate-y-4 scale-95 pointer-events-none z-0'
        }`}
      >

        <div className="center-bg-glow" />
        
        <div className="max-w-[640px] w-full flex flex-col items-center gap-6 z-10">
          <h1 className="center-headline">
            {currentProjectId && currentProjectId !== 'default-project' ? (
              <>现在让它们<span>动起来</span>？</>
            ) : (
              <>我们现在做些<span>什么</span>？</>
            )}
          </h1>
          <p className="center-subline">
            {currentProjectId 
              ? (currentProjectId === 'default-project'
                  ? '临时会话模式 · 请输入以开启对话'
                  : `项目已加载：${currentProjectName} · 请输入以开启对话`)
              : '选择左侧的项目或开始一个新对话，CDF 已经准备就绪'}
          </p>

          {/* Error Banner on Welcome Page */}
          {error && (
            <div className="w-full p-3 rounded-lg bg-[var(--color-danger-dim)] text-[var(--color-danger)] text-xs flex items-center justify-between border border-[var(--color-danger)]/20 animate-fade-in shadow-sm">
              <div className="flex-1 font-medium">{error}</div>
              <button
                onClick={clearError}
                className="p-1 rounded hover:bg-black/10 text-[var(--color-danger)] shrink-0 transition-colors cursor-pointer"
                aria-label="关闭错误提示"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="dialog-box">
            <textarea
              className="dialog-input animate-fade-in"
              placeholder="给 CDF 下达指令，或者问点什么……"
              rows={1}
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              onKeyDown={(e) => {
                if (isComposingKeyEvent(e)) return; // 允许输入法底层在合成中进行正常的字符处理
                if (e.key === 'Enter' && !e.shiftKey) {
                  if (justFinishedComposingRef.current) {
                    consumeJustFinishedComposing();
                    e.preventDefault(); // 阻止输入法合成结束瞬间产生的回车事件冒泡提交易引发误发
                    return;
                  }
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
                  className={`model-selector ${welcomeModelSelectorOpen ? 'open' : ''}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    onClick={() => setWelcomeModelSelectorOpen(!welcomeModelSelectorOpen)}
                    className="model-selector-trigger"
                  >
                    <span className="model-selector-label">
                      {currentModelLabel}
                    </span>
                    <ChevronDown className="model-chevron w-3.5 h-3.5" />
                  </div>
                  <div className="model-dropdown">
                    {providers.length === 0 ? (
                      <div 
                        onClick={() => {
                          setWelcomeModelSelectorOpen(false);
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
                          {getProviderModels(p).map((m) => (
                            <div
                              key={m}
                              className={`model-select-option ${
                                (selectedProviderId === p.id && selectedModel === m) ||
                                (!selectedProviderId && !selectedModel && masterProvider?.id === p.id && masterProvider?.default_model === m)
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
                aria-label="发送消息"
              >
                <ArrowUp className="w-4.5 h-4.5" />
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

      {/* Main Chat Workspace */}
      <div 
        className={`absolute inset-0 flex flex-col bg-[var(--color-bg-app)] overflow-hidden transition-all duration-300 ease-in-out ${
          activeSessionId 
            ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto z-10' 
            : 'opacity-0 -translate-y-4 scale-105 pointer-events-none z-0'
        }`}
      >
        {/* Chat Header */}
        <header className="main-topbar">

          <div className="main-topbar-left" />
          
          {/* Right Header Toolbar */}
          <div className="main-topbar-right flex items-center gap-2 ml-auto no-drag">
            <button
              onClick={onToggleTaskPanel}
              className={`w-6 h-6 flex items-center justify-center cursor-pointer rounded-md transition-all ${
                taskPanelOpen 
                  ? 'text-[var(--color-accent)]' 
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
              }`}
              title={taskPanelOpen ? "隐藏任务展板" : "显示任务展板"}
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        {/* Messages Viewport */}
        <div className="flex-1 relative overflow-hidden">
          <div 
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="messages absolute inset-0 overflow-y-auto" 
            style={{ paddingBottom: '180px' }}
          >
            {/* Messages List */}
            {renderItems.map((item, idx) => {
              if (item.type === 'tool_group') {
                return (
                  <ToolGroupCard
                    key={item.id}
                    tools={item.tools}
                  />
                );
              }
              return (
                <MessageItem
                  key={item.id}
                  message={item.message}
                  isLast={idx === renderItems.length - 1}
                  isStreaming={isStreaming}
                />
              );
            })}

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
                  aria-label="关闭错误提示"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Composer Panel */}
        <div className="absolute bottom-0 left-0 right-0 px-6 pb-6 pt-12 z-10 pointer-events-none">
          {/* Background gradient overlay with fixed height to prevent compression when todo list collapses */}
          <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-[var(--color-bg-app)] via-[var(--color-bg-app)]/85 to-transparent z-0 pointer-events-none" />
          <div className="relative z-10 w-full max-w-[760px] mx-auto flex flex-col gap-3 pointer-events-auto">
            {shouldShowTodos && (
              <TodoList
                todos={todos}
                isExpanded={todoExpanded}
                onToggleExpanded={toggleTodoExpanded}
              />
            )}
            <form onSubmit={(e) => e.preventDefault()} className="relative z-10 flex flex-col bg-[var(--color-bg-surface)] border border-[var(--color-border)] focus-within:border-[var(--color-accent)] focus-within:ring-1 focus-within:ring-[var(--color-accent)]/20 rounded-xl p-3 transition-all shadow-lg">
              {/* Upper: Text Input Area */}
              <textarea
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                onKeyDown={handleKeyDown}
                placeholder="给 Master Agent 发送消息..."
                rows={2}
                className="w-full bg-transparent text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none resize-none text-sm min-h-[56px] max-h-40 py-1"
              />
              
              {/* Lower: Toolbar Row */}
              <div className="flex justify-between items-center border-t border-[var(--color-border)]/30 pt-2.5 mt-1">
                <div className="flex items-center gap-1.5">
                  <div 
                    className={`model-selector ${composerModelSelectorOpen ? 'open' : ''}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div
                      onClick={() => setComposerModelSelectorOpen(!composerModelSelectorOpen)}
                      className="model-selector-trigger"
                    >
                      <span className="model-selector-label truncate max-w-[150px]">
                        {currentModelLabel}
                      </span>
                      <ChevronDown className="model-chevron w-3.5 h-3.5" />
                    </div>
                    <div className="model-dropdown" style={{ left: 0, bottom: 'calc(100% + 8px)' }}>
                      {providers.length === 0 ? (
                        <div 
                          onClick={() => {
                            setComposerModelSelectorOpen(false);
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
                            {getProviderModels(p).map((m) => (
                              <div
                                key={m}
                                className={`model-select-option ${
                                  (selectedProviderId === p.id && selectedModel === m) ||
                                  (!selectedProviderId && !selectedModel && masterProvider?.id === p.id && masterProvider?.default_model === m)
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

                <div>
                  {isStreaming ? (
                    <button
                      type="button"
                      onClick={stopMessage}
                      className="p-2 rounded-lg bg-[var(--color-danger-dim)] hover:bg-[var(--color-danger)] hover:text-white text-[var(--color-danger)] transition-all flex items-center justify-center cursor-pointer"
                      title="停止生成"
                      aria-label="停止生成"
                    >
                      <Square className="w-4 h-4 fill-current" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSend()}
                      disabled={!inputVal.trim() || isStreaming}
                      className="p-2 rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-hover)] disabled:text-[var(--color-text-muted)] text-white transition-all shadow-md flex items-center justify-center cursor-pointer"
                      aria-label="发送消息"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
