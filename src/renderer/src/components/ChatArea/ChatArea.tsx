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
import { ToolMessageCard, ToolGroupCard, translateToolAction } from './ToolMessageCard';

import { MessageItem, formatHMSTime } from './MessageItem';
import { useChatScroll } from './useChatScroll';
import { TodoList } from './TodoList';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { SlashCommandPopup, SlashCommandPopupHandle } from '@/components/SlashCommand/SlashCommandPopup';
import { resolve as dispatcherResolve, dispatch as dispatcherDispatch } from '@/lib/commands/dispatcher';
import { useCommandRegistry } from '@/hooks/useCommandRegistry';

interface ChatAreaProps {
  onOpenSettings?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  taskPanelOpen?: boolean;
  onToggleTaskPanel?: () => void;
}

const FoldedBlockCard = ({ duration, items }: { duration: number; items: any[] }) => {
  const [expanded, setExpanded] = useState(false);
  const headerText = `已处理（用时 ${formatHMSTime(duration)}）`;

  return (
    <div className="mb-2.5 flex flex-col transition-all duration-200 w-full animate-slide-down">
      {/* Header */}
      <div 
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 cursor-pointer select-none text-[12px] text-[var(--color-text-secondary)] font-medium hover:text-[var(--color-text-primary)] transition-colors w-fit py-0.5"
      >
        <span className="text-[10px]">{expanded ? '▼' : '▶'}</span>
        <span>{headerText}</span>
      </div>
      
      {/* Body */}
      {expanded && (
        <div className="mt-2 ml-1.5 pl-3 border-l border-[var(--color-border)]/80 flex flex-col gap-3">
          {items.map((item) => {
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
                isLast={false}
                isStreaming={false}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

const PendingApprovalCard = ({ approval, onToggleTaskPanel }: { approval: any; onToggleTaskPanel?: () => void }) => {
  const [expanded, setExpanded] = useState(false);
  const actions = approval.actions || [];

  return (
    <div className="w-full py-1 select-none animate-slide-down">
      <div className="flex flex-col">
        {/* Header */}
        <div 
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 cursor-pointer select-none text-[11px] text-[var(--color-warning)] hover:opacity-85 transition-colors py-1 w-fit font-medium"
        >
          <span className="flex items-center justify-center shrink-0">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-warning)]" />
          </span>

          <span className="font-semibold tracking-wide">
            正在等待审批：{actions.map((act: any) => translateToolAction(act.name, act.args)).join(', ')}
          </span>

          <span className="text-[9px] opacity-60 font-mono ml-0.5">
            {expanded ? '▼' : '▶'}
          </span>
        </div>

        {/* Collapsed details */}
        {expanded && (
          <div className="mt-1.5 pl-4 pb-2 flex flex-col gap-3 border-l border-[var(--color-warning)]/20 ml-1.5 animate-slide-down">
            {actions.map((action: any, idx: number) => (
              <div key={idx} className="flex flex-col gap-1">
                <span className="text-[9px] font-bold text-[var(--color-warning)] uppercase tracking-wider">
                  等待执行 {action.name}
                </span>
                {action.args && (
                  <pre className="p-2 bg-[var(--color-bg-sidebar)]/30 border border-[var(--color-warning)]/20 rounded text-[10.5px] font-mono text-[var(--color-text-secondary)] overflow-x-auto select-text max-h-40 overflow-y-auto leading-relaxed">
                    <code>{typeof action.args === 'string' ? action.args : JSON.stringify(action.args, null, 2)}</code>
                  </pre>
                )}
              </div>
            ))}
            <button
              onClick={onToggleTaskPanel}
              className="mt-1 px-3 py-1.5 bg-[var(--color-warning)] hover:bg-[var(--color-warning)]/90 text-white rounded-lg text-xs font-semibold w-fit transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <span>立即去审批</span>
              <span>➔</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

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
    pendingApproval,
    sendMessage, selectSession, clearError, createSession, fetchSessions, stopMessage
  } = useSessionStore();
  const { providers, fetchProviders } = useLLMStore();
  const { agents, fetchAgents } = useAgentStore();

  const [inputVal, setInputVal] = useState('');
  const [welcomeModelSelectorOpen, setWelcomeModelSelectorOpen] = useState(false);
  const [composerModelSelectorOpen, setComposerModelSelectorOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [todoExpandedByPlan, setTodoExpandedByPlan] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const justFinishedComposingRef = useRef(false);
  const compositionEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slashRef = useRef<SlashCommandPopupHandle>(null);
  // Phase 7 D-14: 5-line slash sniff reads selectionStart from the textarea DOM
  // (Pitfall P7-4 — must be bound to the <textarea> JSX ref attribute).
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  const processedItems = useMemo(() => {
    const items = renderItems;

    const cleanMessageContent = (content: string): string => {
      if (!content) return '';
      let cleanContent = content;
      const thinkCount = (cleanContent.match(/<think>/g) || []).length;
      const thinkEndCount = (cleanContent.match(/<\/think>/g) || []).length;
      if (thinkEndCount > thinkCount) {
        if (thinkCount === 0) {
          cleanContent = cleanContent.replace(/<\/think>/g, '');
        } else {
          const lastIdx = cleanContent.lastIndexOf('</think>');
          if (lastIdx !== -1) {
            cleanContent = cleanContent.substring(0, lastIdx) + cleanContent.substring(lastIdx + 8);
          }
        }
      }
      return cleanContent;
    };
    
    // Divide into turns based on user messages
    const turns: Array<{
      userItem: any | null;
      responseItems: any[];
    }> = [];

    let currentTurn: { userItem: any | null; responseItems: any[] } = { userItem: null, responseItems: [] };

    items.forEach((item: any) => {
      if (item.type === 'message' && item.message.role === 'user') {
        if (currentTurn.userItem || currentTurn.responseItems.length > 0) {
          turns.push(currentTurn);
        }
        currentTurn = { userItem: item, responseItems: [] };
      } else {
        currentTurn.responseItems.push(item);
      }
    });
    if (currentTurn.userItem || currentTurn.responseItems.length > 0) {
      turns.push(currentTurn);
    }

    const finalItems: any[] = [];

    turns.forEach((turn, turnIdx) => {
      if (turn.userItem) {
        finalItems.push(turn.userItem);
      }

      const isLastTurn = turnIdx === turns.length - 1;
      const isStreamingActive = isLastTurn && isStreaming;

      if (isStreamingActive) {
        // AI is outputting: do not fold/merge items in this turn
        finalItems.push(...turn.responseItems);
      } else {
        // AI has finished outputting: fold thinking and tool items
        const responseItems = turn.responseItems;
        
        let firstThinkIdx = -1;
        let lastThinkIdx = -1;

        responseItems.forEach((item, index) => {
          if (item.type === 'message' && item.message.role === 'assistant') {
            const content = cleanMessageContent(item.message.content || '');
            if (firstThinkIdx === -1 && content.includes('<think>')) {
              firstThinkIdx = index;
            }
            if (content.includes('</think>') || content.includes('<think>')) {
              lastThinkIdx = index;
            }
          }
        });

        if (firstThinkIdx !== -1 && lastThinkIdx !== -1 && lastThinkIdx >= firstThinkIdx) {
          const preFoldItems: any[] = [];
          const foldedItems: any[] = [];
          const postFoldItems: any[] = [];

          if (lastThinkIdx === firstThinkIdx) {
            const firstItem = responseItems[firstThinkIdx];
            const firstMsgContent = cleanMessageContent(firstItem.message.content);
            const firstThinkTagIdx = firstMsgContent.indexOf('<think>');
            const lastThinkEndTagIdx = firstMsgContent.lastIndexOf('</think>');
            
            let prePart = '';
            let postPart = '';
            let thinkPart = firstMsgContent;

            if (firstThinkTagIdx !== -1) {
              prePart = firstMsgContent.substring(0, firstThinkTagIdx).trim();
              if (lastThinkEndTagIdx !== -1 && lastThinkEndTagIdx > firstThinkTagIdx) {
                thinkPart = firstMsgContent.substring(firstThinkTagIdx, lastThinkEndTagIdx + 8);
                postPart = firstMsgContent.substring(lastThinkEndTagIdx + 8).trim();
              } else {
                thinkPart = firstMsgContent.substring(firstThinkTagIdx);
              }
            }

            // 1. Items before firstThinkIdx
            for (let i = 0; i < firstThinkIdx; i++) {
              preFoldItems.push(responseItems[i]);
            }

            // 2. Pre-part
            if (prePart) {
              preFoldItems.push({
                type: 'message',
                id: `${firstItem.id}-pre`,
                message: { ...firstItem.message, id: `${firstItem.message.id}-pre`, content: prePart }
              });
            }

            // 3. Folded item (strip tags to prevent inner fold component rendering)
            foldedItems.push({
              type: 'message',
              id: `${firstItem.id}-think`,
              message: { 
                ...firstItem.message, 
                id: `${firstItem.message.id}-think`, 
                content: thinkPart.replace(/<\/?think>/g, '').trim() 
              }
            });

            // 4. Post-part
            if (postPart) {
              postFoldItems.push({
                type: 'message',
                id: `${firstItem.id}-post`,
                message: { ...firstItem.message, id: `${firstItem.message.id}-post`, content: postPart }
              });
            }
          } else {
            // firstThinkIdx < lastThinkIdx
            // 1. Items before firstThinkIdx
            for (let i = 0; i < firstThinkIdx; i++) {
              preFoldItems.push(responseItems[i]);
            }

            // 2. Process firstThinkIdx item
            const firstItem = responseItems[firstThinkIdx];
            const firstMsgContent = cleanMessageContent(firstItem.message.content);
            const firstThinkTagIdx = firstMsgContent.indexOf('<think>');
            let prePart = '';
            let firstThinkPart = firstMsgContent;
            if (firstThinkTagIdx !== -1) {
              prePart = firstMsgContent.substring(0, firstThinkTagIdx).trim();
              firstThinkPart = firstMsgContent.substring(firstThinkTagIdx);
            }

            if (prePart) {
              preFoldItems.push({
                type: 'message',
                id: `${firstItem.id}-pre`,
                message: { ...firstItem.message, id: `${firstItem.message.id}-pre`, content: prePart }
              });
            }
            
            foldedItems.push({
              type: 'message',
              id: `${firstItem.id}-think`,
              message: { 
                ...firstItem.message, 
                id: `${firstItem.message.id}-think`, 
                content: firstThinkPart.replace(/<\/?think>/g, '').trim() 
              }
            });

            // Add intermediate items
            for (let i = firstThinkIdx + 1; i < lastThinkIdx; i++) {
              const item = responseItems[i];
              if (item.type === 'message') {
                foldedItems.push({
                  ...item,
                  message: {
                    ...item.message,
                    content: cleanMessageContent(item.message.content).replace(/<\/?think>/g, '').trim()
                  }
                });
              } else {
                foldedItems.push(item);
              }
            }

            // Process last item
            const lastItem = responseItems[lastThinkIdx];
            const lastMsgContent = cleanMessageContent(lastItem.message.content);
            const lastThinkEndTagIdx = lastMsgContent.lastIndexOf('</think>');
            let postPart = '';
            let lastThinkPart = lastMsgContent;
            if (lastThinkEndTagIdx !== -1) {
              postPart = lastMsgContent.substring(lastThinkEndTagIdx + 8).trim();
              lastThinkPart = lastMsgContent.substring(0, lastThinkEndTagIdx + 8);
            }

            foldedItems.push({
              type: 'message',
              id: `${lastItem.id}-think`,
              message: { 
                ...lastItem.message, 
                id: `${lastItem.message.id}-think`, 
                content: lastThinkPart.replace(/<\/?think>/g, '').trim() 
              }
            });

            if (postPart) {
              postFoldItems.push({
                type: 'message',
                id: `${lastItem.id}-post`,
                message: { ...lastItem.message, id: `${lastItem.message.id}-post`, content: postPart }
              });
            }
          }

          // Remaining items after lastThinkIdx
          for (let i = lastThinkIdx + 1; i < responseItems.length; i++) {
            postFoldItems.push(responseItems[i]);
          }

          // Calculate duration
          const startTimestamp = responseItems[firstThinkIdx].message.created_at;
          const endTimestamp = responseItems[responseItems.length - 1].message.created_at;
          const totalSeconds = Math.max(1, Math.round((endTimestamp - startTimestamp) / 1000));

          finalItems.push(...preFoldItems);
          finalItems.push({
            type: 'folded_block',
            id: `folded-${turnIdx}`,
            duration: totalSeconds,
            foldedItems
          });
          finalItems.push(...postFoldItems);
        } else {
          // No thinking block in this turn, render all normally
          finalItems.push(...turn.responseItems);
        }
      }
    });

    if (isStreaming && pendingApproval) {
      finalItems.push({
        type: 'pending_approval_block',
        id: `pending-approval-${pendingApproval.id}`,
        approval: pendingApproval
      });
    }

    return finalItems;
  }, [renderItems, isStreaming, pendingApproval]);


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
    // Phase 7 D-14: 5-line sniff — only treat as slash command when caret is at start
    // of textarea. A mid-text slash (selectionStart > 0) is just regular text.
    if (
      inputVal.startsWith('/') &&
      textareaRef.current?.selectionStart === 0
    ) {
      const plan = dispatcherResolve(inputVal, registry.commands);
      if (plan) {
        setInputVal('');
        dispatcherDispatch(plan).catch((err) => console.error('[handleSend/slash] error:', err));
        return;
      }
      // D-15 case 3 (A7 in RESEARCH): dispatcher.resolve returned null (e.g. `/  foo`),
      // fall through to regular sendMessage path.
    }
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

  // Phase 6: registry consumer. Provides commands + fires sonner toasts.
  const registry = useCommandRegistry(
    currentProjectId,
    (activeSession as any)?.agent_id ?? null
  );

  // D-07: insert highlighted command text + trailing space, close popup, do NOT call handleSend
  // Phase 6: route through dispatcher.resolve when the command resolves to a plan
  // (Enter path). Tab / unknown commands fall back to text-insert.
  const handleSlashSelect = (cmd: string) => {
    // cmd is the full `/name` string (e.g., `/goal`).
    const plan = dispatcherResolve(cmd, registry.commands);
    if (plan) {
      setInputVal('');
      setSlashOpen(false);
      dispatcherDispatch(plan).catch((err) => console.error('[dispatcher] error:', err));
    } else {
      setInputVal(cmd + ' ');
      setSlashOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingKeyEvent(e)) return; // 允许输入法底层在合成中进行正常的字符处理
    if (slashOpen) {
      // PITFALLS P6: Backspace when only `/` remains → close popup
      if (e.key === 'Backspace' && inputVal === '/') {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
      const handled = slashRef.current?.handleKeyDown(e.nativeEvent) ?? false;
      if (handled) return;
    }
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
            {processedItems.map((item, idx) => {
              if (item.type === 'pending_approval_block') {
                return (
                  <PendingApprovalCard
                    key={item.id}
                    approval={item.approval}
                    onToggleTaskPanel={onToggleTaskPanel}
                  />
                );
              }
              if (item.type === 'folded_block') {
                return (
                  <FoldedBlockCard
                    key={item.id}
                    duration={item.duration}
                    items={item.foldedItems}
                  />
                );
              }
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
                  isLast={idx === processedItems.length - 1}
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
            <Popover open={slashOpen} onOpenChange={setSlashOpen} modal={false}>
              <PopoverAnchor asChild>
                <form onSubmit={(e) => e.preventDefault()} className="relative z-10 flex flex-col bg-[var(--color-bg-surface)] border border-[var(--color-border)] focus-within:border-[var(--color-accent)] focus-within:ring-1 focus-within:ring-[var(--color-accent)]/20 rounded-xl p-3 transition-all shadow-lg">
                  {/* Upper: Text Input Area */}
                  <textarea
                    ref={textareaRef}
                    value={inputVal}
                    onChange={(e) => {
                      const value = e.target.value;
                      setInputVal(value);
                      if (isComposingRef.current) return; // PITFALLS P13: IME composition guard
                      const shouldOpen = value.startsWith('/') && !value.includes(' ') && value.length <= 32;
                      setSlashOpen(shouldOpen);
                    }}
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
              </PopoverAnchor>
              <PopoverContent
                onOpenAutoFocus={(e) => e.preventDefault()}
                align="start"
                side="top"
                sideOffset={8}
                className="w-[var(--radix-popover-anchor-width)]"
              >
                <SlashCommandPopup
                  ref={slashRef}
                  query={inputVal.startsWith('/') ? inputVal.slice(1) : ''}
                  onSelect={handleSlashSelect}
                  onClose={() => setSlashOpen(false)}
                  commands={registry.commands}
                  hasMcpWarning={registry.warnings.some((w) => w.type === 'mcp_health_warning')}
                  mcpWarningMessage={registry.warnings.find((w) => w.type === 'mcp_health_warning')?.message}
                  loading={registry.loading}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>
    </div>
  );
}
