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

  let inTable = false;
  let tableHeaders: string[] = [];
  let tableRows: string[][] = [];
  let tableAlignments: ('left' | 'center' | 'right')[] = [];
  
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

  const flushTable = (key: string | number) => {
    if (inTable && tableHeaders.length > 0) {
      elements.push(
        <div key={`table-wrapper-${key}`} className="overflow-x-auto my-3 border border-[var(--color-border)]/40 rounded-lg max-w-full shadow-sm">
          <table className="min-w-full divide-y divide-[var(--color-border)]/40 text-xs font-sans select-text border-collapse">
            <thead className="bg-[var(--color-bg-active)]/20 text-[var(--color-text-secondary)] font-semibold border-b border-[var(--color-border)]/30">
              <tr>
                {tableHeaders.map((header, i) => {
                  const align = tableAlignments[i] || 'left';
                  return (
                     <th 
                       key={`th-${i}`} 
                       className={`px-4 py-2.5 text-${align} border-r border-[var(--color-border)]/15 last:border-r-0 font-bold uppercase tracking-wider`}
                     >
                       {renderInlineMarkdown(header)}
                     </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]/15 bg-transparent text-[var(--color-text-primary)]">
              {tableRows.map((row, rIndex) => (
                <tr 
                  key={`tr-${rIndex}`} 
                  className="hover:bg-[var(--color-bg-hover)]/20 transition-colors odd:bg-[var(--color-bg-sidebar)]/10"
                >
                  {row.map((cell, cIndex) => {
                    const align = tableAlignments[cIndex] || 'left';
                    return (
                      <td 
                        key={`td-${cIndex}`} 
                        className={`px-4 py-2 text-${align} border-r border-[var(--color-border)]/15 last:border-r-0 whitespace-pre-wrap leading-relaxed`}
                      >
                        {renderInlineMarkdown(cell)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableHeaders = [];
      tableRows = [];
      tableAlignments = [];
      inTable = false;
    }
  };

  const flushAll = (key: string | number) => {
    flushParagraph(key);
    flushList(key);
    flushTable(key);
  };
  
  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    
    // Check if it's a table row
    const isTableRow = trimmedLine.startsWith('|') && trimmedLine.endsWith('|') && trimmedLine.length > 2;
    
    if (isTableRow) {
      const cells = trimmedLine.slice(1, -1).split('|').map(c => c.trim());
      const isDivider = cells.every(cell => /^[:\s-]*$/.test(cell) && cell.includes('-'));
      
      if (isDivider) {
        if (inTable) {
          tableAlignments = cells.map(cell => {
            const clean = cell.trim();
            if (clean.startsWith(':') && clean.endsWith(':')) return 'center';
            if (clean.endsWith(':')) return 'right';
            return 'left';
          });
        }
        return;
      }
      
      if (!inTable) {
        flushAll(index);
        inTable = true;
        tableHeaders = cells;
      } else {
        tableRows.push(cells);
      }
      return;
    }
    
    // If not in table row, but we were parsing a table, flush it
    if (inTable) {
      flushTable(index);
    }
    
    // 1. 匹配标题
    if (trimmedLine.startsWith('# ')) {
      const isFirst = elements.length === 0 && currentParagraphLines.length === 0 && !currentListType && !inTable;
      flushAll(index);
      elements.push(
        <h1 key={`h1-${index}`} className={`text-xl font-bold ${isFirst ? 'mt-1' : 'mt-4'} mb-2 text-[var(--color-text-primary)]`}>
          {renderInlineMarkdown(trimmedLine.slice(2))}
        </h1>
      );
    } else if (trimmedLine.startsWith('## ')) {
      const isFirst = elements.length === 0 && currentParagraphLines.length === 0 && !currentListType && !inTable;
      flushAll(index);
      elements.push(
        <h2 key={`h2-${index}`} className={`text-lg font-semibold ${isFirst ? 'mt-1' : 'mt-3.5'} mb-2 text-[var(--color-text-primary)]`}>
          {renderInlineMarkdown(trimmedLine.slice(3))}
        </h2>
      );
    } else if (trimmedLine.startsWith('### ')) {
      const isFirst = elements.length === 0 && currentParagraphLines.length === 0 && !currentListType && !inTable;
      flushAll(index);
      elements.push(
        <h3 key={`h3-${index}`} className={`text-base font-semibold ${isFirst ? 'mt-1' : 'mt-3'} mb-1.5 text-[var(--color-text-primary)]`}>
          {renderInlineMarkdown(trimmedLine.slice(4))}
        </h3>
      );
    } else if (trimmedLine.startsWith('#### ')) {
      const isFirst = elements.length === 0 && currentParagraphLines.length === 0 && !currentListType && !inTable;
      flushAll(index);
      elements.push(
        <h4 key={`h4-${index}`} className={`text-sm font-semibold ${isFirst ? 'mt-1' : 'mt-2.5'} mb-1 text-[var(--color-text-primary)]`}>
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
    // 4. 匹配水平分割线
    else if (/^[-\*_]{3,}$/.test(trimmedLine)) {
      flushAll(index);
      elements.push(
        <hr key={`hr-${index}`} className="my-4 border-t border-[var(--color-border)]/60" />
      );
    }
    // 5. 普通行
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

const formatDuration = (seconds: number): string => {
  if (seconds < 60) {
    return `${seconds} 秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes} 分 ${remainingSeconds} 秒` : `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours} 小时 ${remainingMinutes} 分` : `${hours} 小时`;
};

const MessageItem = memo(({ message, isLast, isStreaming }: { message: any; isLast: boolean; isStreaming: boolean }) => {
  const isFinished = useMemo(() => message.content.includes('</think>'), [message.content]);
  
  // 刚刚生成的消息（2分钟以内创建），在流式或刚结束时默认保持展开，防止意外重装折叠
  const isRecent = useMemo(() => {
    return (Date.now() - message.created_at) < 120 * 1000;
  }, [message.created_at]);

  const [thinkExpanded, setThinkExpanded] = useState(() => {
    if (isRecent) return true;
    return !isFinished;
  });

  // 计时的 React 状态
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [finalDuration, setFinalDuration] = useState<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isFinished && isLast && isStreaming) {
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now();
      }
      const interval = setInterval(() => {
        const delta = Math.round((Date.now() - startTimeRef.current!) / 1000);
        setElapsedSeconds(delta);
      }, 500);
      return () => clearInterval(interval);
    } else {
      startTimeRef.current = null;
    }
    return undefined;
  }, [isFinished, isLast, isStreaming]);

  useEffect(() => {
    if (isFinished && elapsedSeconds > 0 && finalDuration === null) {
      setFinalDuration(elapsedSeconds);
    }
  }, [isFinished, elapsedSeconds, finalDuration]);

  // Helper to parse tool JSON
  const toolInfo = useMemo(() => {
    if (message.role !== 'system') return null;
    try {
      const parsed = JSON.parse(message.content);
      if (parsed && parsed.type === 'tool') {
        return parsed;
      }
    } catch (e) {
      // Not a JSON tool message, treat as regular system message
    }
    return null;
  }, [message.content, message.role]);

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
      const finished = content.includes('</think>');

      const getThinkingTime = () => {
        if (!finished) {
          return elapsedSeconds;
        }
        if (finalDuration !== null) {
          return finalDuration;
        }
        // 历史消息估算（每个字符大概 18-20 毫秒生成速度）
        return Math.max(1, Math.round(thinkContent.length / 18));
      };

      const currentSeconds = getThinkingTime();
      const headerText = finished 
        ? `已思考 (用时 ${formatDuration(currentSeconds)})` 
        : `思考中 (已用时 ${formatDuration(elapsedSeconds)})...`;

      return (
        <div className="mb-2.5 flex flex-col transition-all duration-200">
          {/* Thinking Header (Flat Text style) */}
          <div 
            onClick={() => setThinkExpanded(!thinkExpanded)}
            className="flex items-center gap-1.5 cursor-pointer select-none text-[12px] text-[var(--color-text-secondary)] font-medium hover:text-[var(--color-text-primary)] transition-colors w-fit py-0.5"
          >
            <span>{thinkExpanded ? '▼' : '▶'}</span>
            <span>{headerText}</span>
          </div>
          
          {/* Thinking Body (Flat sidebar line style) */}
          {thinkExpanded && (
            <div className="mt-1 ml-1.5 pl-3 border-l border-[var(--color-border)]/80 text-[12.5px] text-[var(--color-text-secondary)] select-text whitespace-pre-wrap leading-relaxed font-normal animate-slide-down">
              {thinkContent}
              {!finished && (
                <span className="inline-block w-1 h-3 ml-0.5 bg-[var(--color-text-muted)]/70 animate-pulse vertical-middle" />
              )}
            </div>
          )}
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

  if (toolInfo) {
    return <ToolMessageCard toolInfo={toolInfo} createdAt={message.created_at} />;
  }

  return (
    <div className={`message ${message.role === 'user' ? 'user' : 'assistant'}`}>
      <div className="message-bubble animate-pop-in">
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
  const { providers, fetchProviders } = useLLMStore();
  const { agents, fetchAgents } = useAgentStore();

  const [inputVal, setInputVal] = useState('');
  const [welcomeModelSelectorOpen, setWelcomeModelSelectorOpen] = useState(false);
  const [composerModelSelectorOpen, setComposerModelSelectorOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Defensive mount-time isStreaming reset to prevent stuck loading states
  useEffect(() => {
    useSessionStore.setState({ isStreaming: false, streamingMessageId: null });
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

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

  // Auto scroll to bottom on new message
  const lastMessageContent = messages.length > 0 ? messages[messages.length - 1].content : '';
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : '';

  useEffect(() => {
    if (!messagesEndRef.current) return;
    if (isStreaming) {
      // 流式输入过程中，使用 auto 避免平滑动画打断导致的重绘抖动
      messagesEndRef.current.scrollIntoView({ behavior: 'auto' });
    } else {
      // 流式结束或新发送时，使用 smooth 优雅归位
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lastMessageContent, isStreaming, lastMessageId]);



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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.isComposing) return; // 拦截输入法确认时的回车事件
    if (e.key === 'Enter' && !e.shiftKey) {
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
              onKeyDown={(e) => {
                if (e.isComposing) return; // 拦截输入法确认时的回车事件
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
          <div className="messages absolute inset-0 overflow-y-auto" style={{ paddingBottom: '180px' }}>
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
        <div className="absolute bottom-0 left-0 right-0 px-6 pb-6 pt-12 bg-gradient-to-t from-[var(--color-bg-app)] via-[var(--color-bg-app)]/95 to-transparent z-10 pointer-events-none">
          <form onSubmit={handleSend} className="max-w-[760px] mx-auto flex flex-col bg-[var(--color-bg-surface)] border border-[var(--color-border)] focus-within:border-[var(--color-accent)] focus-within:ring-1 focus-within:ring-[var(--color-accent)]/20 rounded-xl p-3 transition-all shadow-lg pointer-events-auto">
            {/* Upper: Text Input Area */}
            <textarea
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
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
                    type="submit"
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
  );
}
