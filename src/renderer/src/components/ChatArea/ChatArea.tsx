import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useLLMStore } from '../../stores/llmStore';
import { 
  ArrowUp, Square, Sparkles, BookOpen, GitFork, ChevronRight, AlertCircle, X, Terminal,
  Paperclip, ChevronDown, Plus, Sliders, Layers, PanelLeft, Info, Copy, Check
} from 'lucide-react';

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <div className="border border-[var(--color-border)]/50 rounded-lg overflow-hidden font-mono text-xs bg-[var(--color-bg-sidebar)]">
      <div className="flex justify-between items-center px-4 py-1.5 bg-black/20 text-[var(--color-text-secondary)] border-b border-[var(--color-border)] select-none">
        <span className="uppercase text-xs font-bold text-[var(--color-accent)] tracking-wider">
          {lang || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className={`transition-all duration-200 text-[11px] font-medium px-2 py-0.5 rounded cursor-pointer flex items-center gap-1 active:scale-90 ${
            copied 
              ? 'text-[var(--color-success)] bg-[var(--color-success-dim)]/20' 
              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
          }`}
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-[var(--color-success)] animate-pop-in" />
              <span className="animate-pop-in">已复制</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-[var(--color-text-primary)] select-text" style={{ background: 'transparent', margin: 0 }}>
        <code style={{ background: 'transparent', padding: 0, borderRadius: 0 }}>{code}</code>
      </pre>
    </div>
  );
}

const renderInlineMarkdown = (text: string) => {
  if (!text) return null;
  const inlineRegex = /(\*\*.*?\*\*|\*.*?\*|`.*?`)/g;
  const parts = text.split(inlineRegex);
  
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-bold text-[var(--color-text-primary)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return (
        <em key={i} className="italic text-[var(--color-text-primary)]/90">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code 
          key={i} 
          className="px-1.5 py-0.5 mx-0.5 bg-[var(--color-bg-sidebar)] border border-[var(--color-border)]/50 rounded text-xs font-mono text-[var(--color-accent)]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
};

const renderMarkdownText = (text: string) => {
  if (!text) return null;
  
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  
  let currentParagraphLines: string[] = [];
  let currentListType: 'ul' | 'ol' | null = null;
  let currentListItems: { key: number; content: string; num?: number }[] = [];
  
  const flushParagraph = (key: string | number) => {
    if (currentParagraphLines.length > 0) {
      const pText = currentParagraphLines.join('\n');
      elements.push(
        <p key={`p-${key}`} className="whitespace-pre-wrap leading-relaxed select-text text-sm my-1 text-[var(--color-text-primary)]">
          {renderInlineMarkdown(pText)}
        </p>
      );
      currentParagraphLines = [];
    }
  };

  const flushList = (key: string | number) => {
    if (currentListType && currentListItems.length > 0) {
      if (currentListType === 'ul') {
        elements.push(
          <ul key={`ul-${key}`} className="list-disc pl-5 my-1 flex flex-col gap-1">
            {currentListItems.map((item) => (
              <li key={`li-${item.key}`} className="text-sm leading-relaxed text-[var(--color-text-primary)]">
                {renderInlineMarkdown(item.content)}
              </li>
            ))}
          </ul>
        );
      } else if (currentListType === 'ol') {
        const startNum = currentListItems[0].num ?? 1;
        elements.push(
          <ol key={`ol-${key}`} start={startNum} className="list-decimal pl-5 my-1 flex flex-col gap-1">
            {currentListItems.map((item) => (
              <li key={`li-${item.key}`} className="text-sm leading-relaxed text-[var(--color-text-primary)]">
                {renderInlineMarkdown(item.content)}
              </li>
            ))}
          </ol>
        );
      }
      currentListItems = [];
      currentListType = null;
    }
  };

  const flushAll = (key: string | number) => {
    flushParagraph(key);
    flushList(key);
  };
  
  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    
    // 1. 匹配标题
    if (trimmedLine.startsWith('# ')) {
      flushAll(index);
      elements.push(
        <h1 key={`h1-${index}`} className="text-xl font-bold mt-4 mb-2 text-[var(--color-text-primary)]">
          {renderInlineMarkdown(trimmedLine.slice(2))}
        </h1>
      );
    } else if (trimmedLine.startsWith('## ')) {
      flushAll(index);
      elements.push(
        <h2 key={`h2-${index}`} className="text-lg font-semibold mt-3.5 mb-2 text-[var(--color-text-primary)]">
          {renderInlineMarkdown(trimmedLine.slice(3))}
        </h2>
      );
    } else if (trimmedLine.startsWith('### ')) {
      flushAll(index);
      elements.push(
        <h3 key={`h3-${index}`} className="text-base font-semibold mt-3 mb-1.5 text-[var(--color-text-primary)]">
          {renderInlineMarkdown(trimmedLine.slice(4))}
        </h3>
      );
    } else if (trimmedLine.startsWith('#### ')) {
      flushAll(index);
      elements.push(
        <h4 key={`h4-${index}`} className="text-sm font-semibold mt-2.5 mb-1 text-[var(--color-text-primary)]">
          {renderInlineMarkdown(trimmedLine.slice(5))}
        </h4>
      );
    }
    // 2. 匹配无序列表项
    else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
      if (currentListType !== 'ul') {
        flushAll(index);
        currentListType = 'ul';
      }
      currentListItems.push({
        key: index,
        content: trimmedLine.slice(2)
      });
    }
    // 3. 匹配有序列表项
    else if (/^\d+\.\s/.test(trimmedLine)) {
      const match = trimmedLine.match(/^(\d+)\.\s(.*)/);
      const num = match ? parseInt(match[1]) : 1;
      const content = match ? match[2] : trimmedLine.slice(trimmedLine.indexOf('.') + 1).trim();
      
      if (currentListType !== 'ol') {
        flushAll(index);
        currentListType = 'ol';
      }
      currentListItems.push({
        key: index,
        content,
        num
      });
    }
    // 4. 普通行
    else {
      if (trimmedLine === '') {
        flushAll(index);
      } else {
        if (currentListType) {
          flushList(index);
        }
        currentParagraphLines.push(line);
      }
    }
  });
  
  flushAll('final');
  
  return <div className="flex flex-col gap-1">{elements}</div>;
};

const MessageItem = memo(({ message, isLast, isStreaming }: { message: any; isLast: boolean; isStreaming: boolean }) => {
  const renderMessageContent = (content: string) => {
    if (!content) return null;

    let thinkContent = '';
    let mainContent = content;
    const thinkStartIdx = content.indexOf('<think>');

    if (thinkStartIdx !== -1) {
      const thinkEndIdx = content.indexOf('</think>');
      if (thinkEndIdx !== -1) {
        thinkContent = content.substring(thinkStartIdx + 7, thinkEndIdx).trim();
        mainContent = (content.substring(0, thinkStartIdx) + content.substring(thinkEndIdx + 8)).trim();
      } else {
        thinkContent = content.substring(thinkStartIdx + 7).trim();
        mainContent = content.substring(0, thinkStartIdx).trim();
      }
    }

    const renderThink = () => {
      if (!thinkContent) return null;
      const isFinished = content.includes('</think>');
      return (
        <div className="mb-3 border-l-2 border-[var(--color-accent)]/30 bg-black/5 dark:bg-white/5 rounded-r-md px-3.5 py-2 text-xs text-[var(--color-text-secondary)] italic select-text">
          <div className="flex items-center gap-1.5 text-[var(--color-accent)] font-semibold not-italic mb-1.5 select-none text-[11px] uppercase tracking-wider">
            <Sparkles className={`w-3.5 h-3.5 ${!isFinished ? 'animate-pulse' : ''}`} />
            <span>{isFinished ? '深度思考已完成' : '正在思考中...'}</span>
          </div>
          <div className="whitespace-pre-wrap leading-relaxed">
            {thinkContent}
          </div>
        </div>
      );
    };

    const renderMain = (text: string) => {
      if (!text) return null;
      const parts = text.split(/(```[\s\S]*?```)/g);
      return parts.map((part, index) => {
        if (part.startsWith('```')) {
          const match = part.match(/```(\w*)\n([\s\S]*?)```/);
          const lang = match ? match[1] : '';
          const code = match ? match[2] : part.slice(3, -3);
          return <CodeBlock lang={lang} code={code} key={index} />;
        }
        if (!part.trim()) return null;
        return (
          <div key={index} className="w-full">
            {renderMarkdownText(part)}
          </div>
        );
      });
    };

    return (
      <div className="flex flex-col gap-3">
        {renderThink()}
        {renderMain(mainContent)}
      </div>
    );
  };

  return (
    <div className={`message ${message.role === 'user' ? 'user' : 'assistant'}`}>
      <div className="message-bubble">
        {renderMessageContent(message.content)}
        <div className="message-time">
          {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {message.tokens && message.tokens > 0 ? ` · ${message.tokens} tokens` : ''}
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.message.content === nextProps.message.content &&
         prevProps.message.tokens === nextProps.message.tokens &&
         prevProps.isLast === nextProps.isLast &&
         prevProps.isStreaming === nextProps.isStreaming;
});

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
    sessions, activeSessionId, messages, isStreaming, error, 
    sendMessage, selectSession, clearError, createSession, fetchSessions, stopMessage
  } = useSessionStore();
  const { providers, activeProvider, fetchProviders, saveProvider, setActiveProvider } = useLLMStore();

  const [inputVal, setInputVal] = useState('');
  const [welcomeModelSelectorOpen, setWelcomeModelSelectorOpen] = useState(false);
  const [composerModelSelectorOpen, setComposerModelSelectorOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize LLM providers to check active provider
  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  // Click outside listener for model selectors
  useEffect(() => {
    const handleOutsideClick = () => {
      setWelcomeModelSelectorOpen(false);
      setComposerModelSelectorOpen(false);
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  // Defensive mount-time isStreaming reset to prevent stuck loading states
  useEffect(() => {
    useSessionStore.setState({ isStreaming: false, streamingMessageId: null });
  }, []);

  // Find active project name & active session
  const currentProjectName = useMemo(() => {
    return projects.find(p => p.id === currentProjectId)?.name || '未知项目';
  }, [currentProjectId, projects]);

  const activeSession = useMemo(() => {
    return sessions.find(s => s.id === activeSessionId) || null;
  }, [activeSessionId, sessions]);

  console.log('ChatArea rendering state:', { activeSessionId, isStreaming, inputVal: `"${inputVal}"`, currentProjectId });

  // Auto scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);



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
    setWelcomeModelSelectorOpen(false);
    setComposerModelSelectorOpen(false);
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
        {sidebarCollapsed && (
          <button
            onClick={onToggleSidebar}
            className="absolute top-[6px] left-[78px] w-6 h-6 flex items-center justify-center cursor-pointer z-50 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] rounded-full transition-all opacity-60 hover:opacity-100 no-drag relative after:absolute after:inset-[-8px] after:content-['']"
            title="展开侧边栏"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}
        <div className="center-bg-glow" />
        
        <div className="max-w-[640px] w-full flex flex-col items-center gap-6 z-10">
          <h1 className="center-headline">现在让它们<span>动起来</span>？</h1>
          <p className="center-subline">
            {currentProjectId 
              ? `项目已加载：${currentProjectName} · 请输入以开启对话` 
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
                  className={`model-selector ${welcomeModelSelectorOpen ? 'open' : ''}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    onClick={() => setWelcomeModelSelectorOpen(!welcomeModelSelectorOpen)}
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
          {sidebarCollapsed && (
            <button
              onClick={onToggleSidebar}
              className="absolute top-[6px] left-[78px] w-6 h-6 flex items-center justify-center cursor-pointer z-50 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] rounded-full transition-all opacity-60 hover:opacity-100 no-drag relative after:absolute after:inset-[-8px] after:content-['']"
              title="展开侧边栏"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          )}
          <div className="main-topbar-left">
            <h1>{activeSession?.name || ''}</h1>
          </div>
          
          {/* Right Header Toolbar */}
          <div className="main-topbar-right flex items-center gap-2 ml-auto no-drag">
            <button
              onClick={onToggleTaskPanel}
              className={`w-8 h-8 flex items-center justify-center cursor-pointer rounded-lg transition-all text-[var(--color-text-muted)] ${
                taskPanelOpen 
                  ? 'bg-[var(--color-bg-active)] border border-[var(--color-border)] shadow-sm' 
                  : 'hover:bg-[var(--color-bg-hover)]'
              }`}
              title={taskPanelOpen ? "隐藏任务展板" : "显示任务展板"}
            >
              <Info className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Messages Viewport */}
        <div className="flex-1 relative overflow-hidden">
          <div className="messages absolute inset-0 overflow-y-auto" style={{ paddingBottom: '180px' }}>
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
                  {activeSession?.parent_session_id && (
                    <button
                      onClick={() => activeSession?.parent_session_id && selectSession(activeSession.parent_session_id)}
                      className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] font-medium flex items-center gap-0.5 transition-all"
                    >
                      <span>回溯父会话历史</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed italic border-l-2 border-[var(--color-accent)]/30 pl-3">
                  "{activeSession?.summary}"
                </p>
              </div>
            )}

            {/* Messages List */}
            {(messages || []).map((message, idx) => (
              <MessageItem
                key={message.id}
                message={message}
                isLast={idx === messages.length - 1}
                isStreaming={isStreaming}
              />
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
        <div className="absolute bottom-0 left-0 right-0 px-6 pb-6 pt-12 bg-gradient-to-t from-[var(--color-bg-app)] via-[var(--color-bg-app)]/95 to-transparent z-10 pointer-events-none">
          <form onSubmit={handleSend} className="max-w-[760px] mx-auto flex flex-col bg-[var(--color-bg-surface)] border border-[var(--color-border)] focus-within:border-[var(--color-accent)] focus-within:ring-1 focus-within:ring-[var(--color-accent)]/20 rounded-xl p-3 transition-all shadow-lg pointer-events-auto">
            {/* Upper: Text Input Area */}
            <textarea
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={activeProvider ? "给 Master Agent 发送消息..." : "请先配置模型提供商以开启对话..."}
              disabled={!activeProvider || isStreaming}
              rows={2}
              className="w-full bg-transparent text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none resize-none text-sm min-h-[56px] max-h-40 py-1"
            />
            
            {/* Lower: Toolbar Row */}
            <div className="flex justify-between items-center border-t border-[var(--color-border)]/30 pt-2.5 mt-1">
              <div className="flex items-center gap-1.5">
                {activeProvider && (
                  <div 
                    className={`model-selector ${composerModelSelectorOpen ? 'open' : ''}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div
                      onClick={() => setComposerModelSelectorOpen(!composerModelSelectorOpen)}
                      className="model-selector-trigger"
                    >
                      <span className="model-selector-label truncate max-w-[150px]">
                        {activeProvider.name} • {activeProvider.default_model}
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
                )}
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
                    type="submit"
                    disabled={!activeProvider || !inputVal.trim() || isStreaming}
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
  );
}
