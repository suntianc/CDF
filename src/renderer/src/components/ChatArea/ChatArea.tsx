import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { useTranslation, Trans } from 'react-i18next';
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
import { SlashToken } from '@/components/SlashCommand/SlashToken';
import { parseInputToTokens } from '@/lib/commands/parseInputToTokens';
import { AtToken } from '@/components/AtMention/AtToken';
import { AtMentionPopup, AtMentionPopupHandle } from '@/components/AtMention/AtMentionPopup';
import { useAtMentionStore } from '@/stores/atMentionStore';
import { parseAtTokens } from '@/lib/commands/pathUtils';
import { GoalSystemBubble } from './GoalSystemBubble';
import { useGoalJudgeStatus } from '../../hooks/useGoalJudge';
import { ContextButton } from '@/components/Composer/ContextButton';

interface ChatAreaProps {
  onOpenSettings?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  taskPanelOpen?: boolean;
  onToggleTaskPanel?: () => void;
  onOpenTaskPanel?: () => void;
}

const FoldedBlockCard = ({ duration, items }: { duration: number; items: any[] }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const headerText = t('chat.processedDuration', { duration: formatHMSTime(duration) });

  return (
    <div className="mb-2.5 flex flex-col transition-all duration-200 w-full animate-slide-down">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 cursor-pointer select-none text-[12px] text-[var(--color-text-secondary)] font-medium hover:text-[var(--color-text-primary)] transition-colors w-fit py-0.5"
      >
        <span aria-hidden="true" className="text-[10px]">{expanded ? '▼' : '▶'}</span>
        <span>{headerText}</span>
      </button>
      
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
            if (item.type === 'message' && item.message) {
              return (
                <MessageItem
                  key={item.id}
                  message={item.message}
                  isLast={false}
                  isStreaming={false}
                />
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
};

const PendingApprovalCard = ({ approval, onOpenTaskPanel }: { approval: any; onOpenTaskPanel?: () => void }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const actions = approval.actions || [];

  return (
    <div className="w-full py-1 select-none animate-slide-down">
      <div className="flex flex-col">
        {/* Header */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex items-center gap-2 cursor-pointer select-none text-[11px] text-[var(--color-warning)] hover:opacity-85 transition-colors py-1 w-fit font-medium"
        >
          <span aria-hidden="true" className="flex items-center justify-center shrink-0">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-warning)]" />
          </span>

          <span className="font-semibold tracking-wide">
            {t('chat.awaitingApproval')}{actions.map((act: any) => translateToolAction(act.name, act.args, t)).join(', ')}
          </span>

          <span aria-hidden="true" className="text-[9px] opacity-60 font-mono ml-0.5">
            {expanded ? '▼' : '▶'}
          </span>
        </button>

        {/* Collapsed details */}
        {expanded && (
          <div className="mt-1.5 pl-4 pb-2 flex flex-col gap-3 border-l border-[var(--color-warning)]/20 ml-1.5 animate-slide-down">
            {actions.map((action: any, idx: number) => (
              <div key={idx} className="flex flex-col gap-1">
                <span className="text-[10px] font-medium text-[var(--color-warning)]">
                  {t('chat.pendingExecute', { name: action.name })}
                </span>
                {action.args && (
                  <pre className="p-2 bg-[var(--color-bg-sunken)] border border-[var(--color-border)] rounded text-[10.5px] font-mono text-[var(--color-text-secondary)] overflow-x-auto select-text max-h-40 overflow-y-auto leading-relaxed">
                    <code>{typeof action.args === 'string' ? action.args : JSON.stringify(action.args, null, 2)}</code>
                  </pre>
                )}
              </div>
            ))}
            <button
              onClick={onOpenTaskPanel}
              className="mt-1 px-3 py-1.5 bg-[var(--color-warning)] hover:bg-[var(--color-warning)]/90 text-[var(--color-text-inverse)] rounded-lg text-xs font-semibold w-fit transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <span>{t('chat.goApproveNow')}</span>
              <span>➔</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};


interface LeadingToken {
  type: 'slash' | 'at';
  name: string;
  raw: string;
  source?: 'system' | 'mcp' | 'skill';
  kind?: 'file' | 'dir';
}

function parseLeadingTokens(text: string, commands: any[]): { tokens: LeadingToken[]; tail: string } {
  const tokens: LeadingToken[] = [];
  let remaining = text;

  // 1. Parse optional leading slash command
  if (remaining.startsWith('/')) {
    const match = remaining.match(/^\/([\w-]+)/);
    if (match) {
      const name = match[1];
      const cmd = commands.find((c) => c.name === name);
      if (cmd) {
        tokens.push({
          type: 'slash',
          name: cmd.name,
          raw: '/' + cmd.name,
          source: cmd.source,
        });
        remaining = remaining.slice(cmd.name.length + 1);
        if (remaining.startsWith(' ')) {
          remaining = remaining.slice(1);
        }
      }
    }
  }

  // 2. Parse consecutive leading at-tokens
  while (true) {
    const match = remaining.match(/^@([\w./-]+)(?=\s)/);
    if (match) {
      const pathText = match[1];
      tokens.push({
        type: 'at',
        name: pathText,
        raw: '@' + pathText,
        kind: pathText.endsWith('/') ? 'dir' : 'file',
      });
      remaining = remaining.slice(pathText.length + 1);
      if (remaining.startsWith(' ')) {
        remaining = remaining.slice(1);
      }
    } else {
      break;
    }
  }

  return { tokens, tail: remaining };
}

export function ChatArea({
  onOpenSettings,
  sidebarCollapsed,
  onToggleSidebar,
  taskPanelOpen,
  onToggleTaskPanel,
  onOpenTaskPanel
}: ChatAreaProps) {
  const { t } = useTranslation();
  const { currentProjectId, projects, setProjects, setCurrentProject } = useProjectStore();
  const { 
    sessions, activeSessionId, messages, isStreaming, streamingMessageId, activeRunId, error, todos,
    pendingApproval,
    sendMessage, selectSession, clearError, createSession, fetchSessions, stopMessage
  } = useSessionStore();
  const { providers, fetchProviders } = useLLMStore();
  const { agents, fetchAgents } = useAgentStore();
  const { status: goalStatus, goal: activeGoal } = useGoalJudgeStatus(activeSessionId || '');
  const hasActiveGoal = !!(activeSessionId && goalStatus && activeGoal);

  const [inputVal, setInputVal] = useState('');
  const [welcomeModelSelectorOpen, setWelcomeModelSelectorOpen] = useState(false);
  const [composerModelSelectorOpen, setComposerModelSelectorOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const sessionModelOverrides = useSessionStore((state) => state.sessionModelOverrides) || {};
  const override = activeSessionId ? sessionModelOverrides[activeSessionId] : (sessionModelOverrides[''] || null);
  const selectedProviderId = override?.providerId || '';
  const selectedModel = override?.model || '';
  const [todoExpandedByPlan, setTodoExpandedByPlan] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const justFinishedComposingRef = useRef(false);
  const compositionEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slashRef = useRef<SlashCommandPopupHandle>(null);
  // Phase 08.3 fix #3: wire atRef so the AtMentionPopup can claim ↑↓ Enter
  // Tab Escape keystrokes from the textarea. Mirrors the slashRef pattern.
  const atRef = useRef<AtMentionPopupHandle>(null);
  // Phase 7 D-14: 5-line slash sniff reads selectionStart from the textarea DOM
  // (Pitfall P7-4 — must be bound to the <textarea> JSX ref attribute).
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previousSessionIdRef = useRef<string | null>(null);

  const isAtMentionOpen = useAtMentionStore((s) => s.isOpen);
  const atMentionQuery = useAtMentionStore((s) => s.query);
  const atMentionCandidates = useAtMentionStore((s) => s.candidates);
  const atMentionTruncated = useAtMentionStore((s) => s.truncated);
  const atMentionLoading = useAtMentionStore((s) => s.loading);
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
  // Only reset if we are not actively streaming or waiting for approval to avoid breaking state when switching views
  useEffect(() => {
    const { isStreaming, pendingApproval } = useSessionStore.getState();
    if (!isStreaming && !pendingApproval) {
      useSessionStore.setState({ isStreaming: false, streamingMessageId: null });
    }
  }, []);

  // Clear input when active session changes to prevent drafts/capsules from being carried over
  useEffect(() => {
    setInputVal('');
    setSlashOpen(false);
  }, [activeSessionId]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  // Phase 08.3 E-02: subscribe to atMentionStore and fetch candidates on popup open.
  // Only one IPC call per open (false→true transition), not per keystroke.
  // B-01: if no active project, close the popup immediately.
  // Phase 08.3 fix #4: monotonic request-id guards against out-of-order
  // IPC resolutions. Without this, an in-flight IPC for a stale `@query`
  // could resolve AFTER a subsequent close+open, overwriting the fresh
  // candidates with the old query's results.
  const atIpcRequestIdRef = useRef(0);
  useEffect(() => {
    const unsubscribe = useAtMentionStore.subscribe((state, prev) => {
      // Phase 08.3 codex P2: on `isOpen` true→false, bump the request id
      // so any in-flight IPC whose `.then` resolves after the close
      // becomes stale and is dropped by the guard below. Without this,
      // closing the popup while IPC is in flight would let the late
      // `.then` resurrect the 5000-path array in the store — violating
      // E-02's "close releases candidates" invariant.
      if (prev.isOpen && !state.isOpen) {
        atIpcRequestIdRef.current++;
        return;
      }
      if (state.isOpen && !prev.isOpen) {
        if (!currentProjectId) {
          useAtMentionStore.getState().close();
          return;
        }
        const requestId = ++atIpcRequestIdRef.current;
        useAtMentionStore.getState().setLoading(true);
        window.electronAPI.project
          .listAtMentionCandidates(currentProjectId)
          .then((result) => {
            if (atIpcRequestIdRef.current !== requestId) return; // stale
            useAtMentionStore.getState().setCandidates(result.candidates, result.truncated);
          })
          .catch((err) => {
            if (atIpcRequestIdRef.current !== requestId) return; // stale
            console.error('[at-mention] IPC failed:', err);
            useAtMentionStore.getState().setCandidates([], false);
          });
      }
    });
    return unsubscribe;
  }, [currentProjectId]);

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
    return projects.find(p => p.id === currentProjectId)?.name || t('chat.unknownProject');
  }, [currentProjectId, projects]);

  // Phase 08.3 B-01: derive the project root for at-mention enumeration.
  // Returns null when no project is active — the @ trigger MUST not open the popup in that case.
  const currentProjectRoot = useMemo(
    () => projects.find((p) => p.id === currentProjectId)?.path ?? null,
    [projects, currentProjectId]
  );

  const [welcomeText, setWelcomeText] = useState({
    headlineKey: 'chat.welcomeHeadlineIdle',
    sublineText: '',
  });

  useEffect(() => {
    if (activeSessionId) {
      return;
    }

    const timer = setTimeout(() => {
      const headlineKey = currentProjectId && currentProjectId !== 'default-project'
        ? 'chat.welcomeHeadlineActive'
        : 'chat.welcomeHeadlineIdle';
      const sublineText = currentProjectId
        ? (currentProjectId === 'default-project'
            ? t('chat.welcomeSublineTempSession')
            : t('chat.welcomeSublineProjectLoaded', { name: currentProjectName }))
        : t('chat.welcomeSublineNoProject');
      setWelcomeText({ headlineKey, sublineText });
    }, 150);

    return () => clearTimeout(timer);
  }, [activeSessionId, currentProjectId, currentProjectName, t]);

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

          // Calculate duration from message items only. `responseItems` may end
          // with a tool_group, which has no `.message` field.
          const startTimestamp = responseItems[firstThinkIdx].message.created_at;
          const lastMessageItem = [...responseItems].reverse().find((item) => item.type === 'message' && item.message);
          const endTimestamp = lastMessageItem?.message.created_at ?? startTimestamp;
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

  const getProviderModels = (provider: { id?: string; default_model: string; models?: string[] }) => {
    const models = [provider.default_model, ...(provider.models || [])].filter(Boolean);
    if (provider.id === selectedProviderId && selectedModel) {
      models.push(selectedModel);
    }
    return Array.from(new Set(models));
  };

  const selectedProviderModels = useMemo(() => {
    if (!selectedProvider) return [];
    return getProviderModels(selectedProvider);
  }, [selectedProvider, selectedProviderId, selectedModel]);

  const setSelectedModel = (modelName: string) => {
    const targetId = activeSessionId || '';
    if (!modelName || !selectedProviderId) {
      useSessionStore.getState().setSessionModelOverride(targetId, '', '');
      return;
    }
    useSessionStore.getState().setSessionModelOverride(targetId, selectedProviderId, modelName);
  };

  useEffect(() => {
    if (providers.length === 0) return;

    if (!selectedProvider) {
      if (selectedModel) setSelectedModel('');
      return;
    }

    if (!selectedProviderModels.includes(selectedModel)) {
      setSelectedModel(selectedProviderModels[0] || '');
    }
  }, [selectedModel, selectedProvider, selectedProviderModels, providers]);

  const currentProvider = selectedProvider || masterProvider;
  const currentModel = selectedModel || masterProvider?.default_model || '';
  const currentModelLabel = currentProvider
    ? `${currentProvider.name} • ${currentModel || currentProvider.default_model}`
    : t('chat.selectModel');
  const activeAgentLabel = activeSessionAgent
    ? `${activeSessionAgent.name} · ${activeSessionAgent.mcpServerIds?.length || 0} MCP · ${activeSessionAgent.skillNames?.length || 0} Skills`
    : t('chat.noAgentBound');

  const handleSelectModel = (providerId: string, modelName: string) => {
    const targetId = activeSessionId || '';
    useSessionStore.getState().setSessionModelOverride(targetId, providerId, modelName);
    setWelcomeModelSelectorOpen(false);
    setComposerModelSelectorOpen(false);
  };

  useEffect(() => {
    if (!welcomeModelSelectorOpen && !composerModelSelectorOpen) return;

    const timer = setTimeout(() => {
      document
        .querySelector('.model-selector.open .model-select-option.selected')
        ?.scrollIntoView({ block: 'nearest' });
    }, 0);

    return () => clearTimeout(timer);
  }, [welcomeModelSelectorOpen, composerModelSelectorOpen, selectedProviderId, selectedModel, providers]);





  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    // Phase 7 D-14: 5-line sniff — only treat as slash command when caret is at start
    // of textarea. A mid-text slash (selectionStart > 0) is just regular text.
    if (
      (inputVal.startsWith('/') && textareaRef.current?.selectionStart === 0) ||
      parsedToken?.token
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
  // v1.1 polish: fall back to the project's default agent when there is no
  // active session yet, so the slash popup on the WELCOME screen shows the
  // full command set (system + MCP + skills + workflows) for the default
  // agent, not just the 3 hardcoded system commands. Before this fallback
  // `agentId` was `null` on welcome → `useCommandRegistry` early-returned
  // with EMPTY_COMMANDS and the popup fell back to the system-only stub.
  const registry = useCommandRegistry(
    currentProjectId,
    (activeSession as any)?.agent_id ?? activeSessionAgent?.id ?? null
  );

  // Phase 08.1 (D-03 + SPEC R7): parse leading /cmd-name from inputVal. Used by
  // the overlay below the textarea to render a SlashToken pill in place of
  // the leading text, and by the atomic Backspace check in handleKeyDown.
  const parsedToken = useMemo(
    () => parseInputToTokens(inputVal, registry.commands),
    [inputVal, registry.commands]
  );

  // Phase 08.3 (C-02 + C-03): scan the entire inputVal for @relative/path substrings
  // so the overlay can render <AtToken> pills in place of literal @path strings.
  // Independent of parseInputToTokens (slash parser) so the two can coexist.
  const parsedAtTokens = useMemo(() => parseAtTokens(inputVal), [inputVal]);

  const { tokens: leadingTokens, tail: visibleInputTail } = useMemo(
    () => parseLeadingTokens(inputVal, registry.commands),
    [inputVal, registry.commands]
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

  // v1.1 polish: Tab key on the popup inserts the command text into the
  // textarea (with a trailing space) instead of dispatching. Lets the user
  // review/edit and add args before pressing Enter to actually send.
  // Mirrors handleSlashSelect's "no plan" branch — the popup has already
  // closed by the time this runs, so the textarea retains focus and the
  // caret lands after the inserted text.
  const handleSlashInsert = (cmd: string) => {
    setInputVal(cmd + ' ');
    setSlashOpen(false);
  };

  // Phase 08.3 fix #12+#13: shared at-mention onSelect body. Used by
  // BOTH the welcome and composer popovers so the `@query` →
  // `@relative/path ` rewrite lives in one place. (Earlier this was
  // copy-pasted in two PopoverContent bodies; the `value` ReferenceError
  // fix landed in two places because of that drift.)
  const handleAtSelect = (path: string) => {
    const cursor = useAtMentionStore.getState().cursorPos;
    const textBeforeCursor = inputVal.slice(0, cursor);
    const atCharIndex = textBeforeCursor.lastIndexOf('@');
    if (atCharIndex < 0) return;
    const newValue =
      inputVal.slice(0, atCharIndex) + '@' + path + ' ' + inputVal.slice(cursor);
    setInputVal(newValue);
    useAtMentionStore.getState().close();
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
    // Phase 08.3 fix #3: route at-mention popup keys (↑↓ Enter Tab Esc)
    // through atRef so the popup can claim them from the textarea. Mirrors
    // the slashRef pattern above. Only fires when the at-popup is open.
    if (useAtMentionStore.getState().isOpen) {
      const atHandled = atRef.current?.handleKeyDown(e.nativeEvent) ?? false;
      if (atHandled) return;
    }
    if (e.key === 'Backspace') {
      if (e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0) {
        if (leadingTokens.length > 0) {
          e.preventDefault();
          const newTokens = leadingTokens.slice(0, -1);
          const newPrefix = newTokens.map((t) => t.raw).join(' ') + (newTokens.length > 0 ? ' ' : '');
          const newTail = e.currentTarget.value;
          setInputVal(newPrefix + newTail);
          useAtMentionStore.getState().close();
          setSlashOpen(false);
          return;
        }
      }
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

    if (
      inputVal.startsWith('/') ||
      parsedToken?.token
    ) {
      const plan = dispatcherResolve(inputVal, registry.commands);
      if (plan) {
        setInputVal('');
        setSlashOpen(false);
        dispatcherDispatch(plan).catch((err) => console.error('[handleWelcomeSend/slash] error:', err));
        return;
      }
    }

    let projectId = currentProjectId || 'default-project';
    try {
      // Create new session
      const sessionName = inputVal.trim().slice(0, 15) || t('chat.newSessionFallback');
      const newSession = await createSession(projectId, sessionName);
      
      // Copy welcome override to new session
      const welcomeOverride = useSessionStore.getState().sessionModelOverrides[''];
      if (welcomeOverride) {
        useSessionStore.getState().setSessionModelOverride(
          newSession.id,
          welcomeOverride.providerId,
          welcomeOverride.model
        );
        // Clear welcome override
        useSessionStore.getState().setSessionModelOverride('', '', '');
      }

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
        const name = path.split('/').pop() || t('chat.newProjectFallback');
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
        className={`absolute inset-0 flex flex-col items-center justify-center p-6 bg-[var(--color-bg-app)] overflow-hidden transition-all duration-300 ease-in-out ${
          !activeSessionId
            ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto z-10'
            : 'opacity-0 translate-y-4 scale-95 pointer-events-none z-0'
        }`}
      >

        <div className="center-bg-glow" />
        
        <div className="max-w-[640px] w-full flex flex-col items-center gap-6 z-10">
          <h1 className="center-headline">
            <Trans
              i18nKey={welcomeText.headlineKey}
              components={{ span: <span /> }}
            />
          </h1>
          <p className="center-subline">
            {welcomeText.sublineText}
          </p>

          {/* Error Banner on Welcome Page */}
          {error && (
            <div role="alert" aria-live="assertive" className="w-full p-3 rounded-lg bg-[var(--color-danger-dim)] text-[var(--color-danger)] text-xs flex items-start gap-2 border border-[var(--color-danger)]/20 animate-fade-in shadow-sm">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">{error.message}</div>
                {error.recoverableActions && error.recoverableActions.length > 0 && (
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {error.recoverableActions.map((a) => (
                      <button key={a.label} type="button" onClick={() => { a.action(); clearError(); }} className="text-[var(--color-danger)] underline underline-offset-2 hover:no-underline font-medium cursor-pointer">
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={clearError}
                className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-danger)] shrink-0 transition-colors cursor-pointer"
                aria-label={t('chat.dismissError')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="dialog-box">
            {/* Welcome popover. `open` is gated on `!activeSessionId` so the
                slash popup is mutually exclusive with the composer popover:
                both `<Popover open={slashOpen}>` instances would otherwise
                render simultaneously because the welcome textarea AND the
                composer textarea are both in the DOM on the welcome screen. */}
            <Popover
              open={(slashOpen || isAtMentionOpen) && !activeSessionId}
              onOpenChange={(open) => {
                if (!open) {
                  setSlashOpen(false);
                  useAtMentionStore.getState().close();
                }
              }}
              modal={false}
            >
              <PopoverAnchor asChild>
                <div className="flex flex-wrap items-start gap-1.5 w-full relative z-0" style={{ fontSize: '15px' }}>
                  {leadingTokens.map((t, idx) => (
                    <div key={idx} className="flex-shrink-0 pt-[5px]">
                      {t.type === 'slash' ? (
                        <SlashToken name={t.name} source={t.source} />
                      ) : (
                        <AtToken path={t.name} kind={t.kind!} />
                      )}
                    </div>
                  ))}
                  <textarea
                    className="dialog-input animate-fade-in caret-[var(--color-text-primary)] py-1.5 flex-1 min-w-[120px] !w-auto"
                    placeholder={leadingTokens.length > 0 ? '' : t('chat.welcomePlaceholder')}
                    rows={1}
                    value={visibleInputTail}
                    onChange={(e) => {
                      const tail = e.target.value;
                      const prefix = leadingTokens.map((t) => t.raw).join(' ') + (leadingTokens.length > 0 ? ' ' : '');
                      const value = prefix + (tail.startsWith(' ') ? tail.slice(1) : tail);
                      setInputVal(value);
                      if (isComposingRef.current) return; // PITFALLS P13: IME composition guard
                      // Mirror the composer's slash-open predicate so the popup
                      // also triggers when typing `/` in the welcome textarea.
                      const shouldOpen = value.startsWith('/') && !value.includes(' ') && value.length <= 32 && !parsedToken?.token;
                      setSlashOpen(shouldOpen);
                      // Phase 08.3 A-01: at-mention trigger — only when a project root exists
                      // and the cursor sits at a standalone `@` followed by 0+ path chars.
                      if (!isComposingRef.current && currentProjectRoot) {
                        const cursor = e.target.selectionStart + prefix.length;
                        const textBeforeCursor = value.slice(0, cursor);
                        const atMatch = textBeforeCursor.match(/(?:^|\s)@(\S*)$/);
                        if (atMatch) {
                          const state = useAtMentionStore.getState();
                          if (!state.isOpen) {
                            state.open(cursor);
                          } else {
                            useAtMentionStore.setState({ cursorPos: cursor });
                          }
                          state.setQuery(atMatch[1]);
                        } else {
                          useAtMentionStore.getState().close();
                        }
                      } else {
                        useAtMentionStore.getState().close();
                      }
                    }}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    onKeyDown={(e) => {
                      if (isComposingKeyEvent(e)) return; // 允许输入法底层在合成中进行正常的字符处理
                      // Slash popup navigation (mirrors handleKeyDown on composer).
                      if (slashOpen) {
                        if (e.key === 'Backspace' && inputVal === '/') {
                          e.preventDefault();
                          setSlashOpen(false);
                          return;
                        }
                        const handled = slashRef.current?.handleKeyDown(e.nativeEvent) ?? false;
                        if (handled) return;
                      }
                      // Phase 08.3 fix #3: at-mention popup nav (welcome mirror).
                      if (useAtMentionStore.getState().isOpen) {
                        const atHandled = atRef.current?.handleKeyDown(e.nativeEvent) ?? false;
                        if (atHandled) return;
                      }
                      
                      // Unified Backspace deletion of leading pills
                      if (e.key === 'Backspace') {
                        if (e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0) {
                          if (leadingTokens.length > 0) {
                            e.preventDefault();
                            const newTokens = leadingTokens.slice(0, -1);
                            const newPrefix = newTokens.map((t) => t.raw).join(' ') + (newTokens.length > 0 ? ' ' : '');
                            const newTail = e.currentTarget.value;
                            setInputVal(newPrefix + newTail);
                            useAtMentionStore.getState().close();
                            setSlashOpen(false);
                            return;
                          }
                        }
                      }

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
                </div>
              </PopoverAnchor>
              <PopoverContent
                onOpenAutoFocus={(e) => e.preventDefault()}
                align="start"
                side="top"
                sideOffset={8}
                className="w-[var(--radix-popover-anchor-width)]"
              >
                {slashOpen ? (
                  <SlashCommandPopup
                    ref={slashRef}
                    query={inputVal.startsWith('/') ? inputVal.slice(1) : ''}
                    onSelect={handleSlashSelect}
                    onInsert={handleSlashInsert}
                    onClose={() => setSlashOpen(false)}
                    commands={registry.commands}
                    hasMcpWarning={registry.warnings.some((w) => w.type === 'mcp_health_warning')}
                    mcpWarningMessage={registry.warnings.find((w) => w.type === 'mcp_health_warning')?.message}
                    loading={registry.loading}
                  />
                ) : (
                  <AtMentionPopup
                    ref={atRef}
                    query={atMentionQuery}
                    candidates={atMentionCandidates}
                    truncated={atMentionTruncated}
                    loading={atMentionLoading}
                    onSelect={handleAtSelect}
                    onClose={() => useAtMentionStore.getState().close()}
                  />
                )}
              </PopoverContent>
            </Popover>
            <div className="dialog-bottom">
              <div className="dialog-bottom-left">
                <button type="button" className="dialog-btn" title={t('chat.addAttachment')} aria-label={t('chat.addAttachment')}>
                  <Paperclip className="w-4 h-4" />
                </button>
                <div 
                  className={`model-selector model-selector--welcome ${welcomeModelSelectorOpen ? 'open' : ''}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    onClick={() => setWelcomeModelSelectorOpen(!welcomeModelSelectorOpen)}
                    className="model-selector-trigger"
                  >
                    <span className="model-selector-label" title={currentModelLabel}>
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
                        {t('chat.noProvidersAvailable')}
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
                              title={`${p.name} • ${m}`}
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
                title={t('chat.send')}
                aria-label={t('chat.sendMessage')}
              >
                <ArrowUp className="w-4.5 h-4.5" />
              </button>
              <span className="sr-only">{t('chat.sendMessage')}</span>
            </div>
          </div>

          <div className="feature-rows">
            <button type="button" className="feature-card" onClick={handleCreateProject}>
              <div className="feature-card-icon">
                <Plus className="w-4 h-4" />
              </div>
              <div className="feature-card-title">{t('chat.createProjectTitle')}</div>
              <div className="feature-card-desc">{t('chat.createProjectDesc')}</div>
            </button>

            <button type="button" className="feature-card" onClick={() => onOpenSettings?.()}>
              <div className="feature-card-icon">
                <Sliders className="w-4 h-4" />
              </div>
              <div className="feature-card-title">{t('chat.configureSkillsTitle')}</div>
              <div className="feature-card-desc">{t('chat.configureSkillsDesc')}</div>
            </button>

            <button type="button" className="feature-card" onClick={() => onOpenSettings?.()}>
              <div className="feature-card-icon">
                <Layers className="w-4 h-4" />
              </div>
              <div className="feature-card-title">{t('chat.connectMcpTitle')}</div>
              <div className="feature-card-desc">{t('chat.connectMcpDesc')}</div>
            </button>
          </div>

          <div className="dialog-footer">
            <span className="dialog-footer-hint">
              <Trans
                i18nKey="chat.shortcutHint"
                components={{ kbd: <kbd /> }}
              />
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
              title={taskPanelOpen ? t('chat.hideTaskPanel') : t('chat.showTaskPanel')}
              aria-label={taskPanelOpen ? t('chat.hideTaskPanel') : t('chat.showTaskPanel')}
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        {/* Messages Viewport */}
        <div className="flex-1 relative overflow-hidden">
          {activeSessionId && <GoalSystemBubble sessionId={activeSessionId} />}

          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="messages absolute inset-0 overflow-y-auto"
            style={{ 
              paddingBottom: '180px',
              paddingTop: hasActiveGoal ? '64px' : '0px'
            }}
          >
            {/* Messages List */}
            {processedItems.map((item, idx) => {
              if (item.type === 'pending_approval_block') {
                return (
                  <PendingApprovalCard
                    key={item.id}
                    approval={item.approval}
                    onOpenTaskPanel={onOpenTaskPanel}
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
              if (item.type === 'message' && item.message) {
                return (
                  <MessageItem
                    key={item.id}
                    message={item.message}
                    isLast={idx === processedItems.length - 1}
                    isStreaming={isStreaming}
                  />
                );
              }
              return null;
            })}

            {/* Typing Indicator while streaming empty block */}
            {isStreaming && messages.length > 0 && messages[messages.length - 1].content === '' && (
              <div className="message assistant" role="status" aria-label={t('chat.generating')}>
                <div className="message-row">
                  <div className="flex items-center gap-1 py-1.5" aria-hidden="true">
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-pulse" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-pulse" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-pulse" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            {/* Error Banner */}
            {error && (
              <div role="alert" aria-live="assertive" className="p-3 bg-[var(--color-danger-dim)] border border-[var(--color-danger)]/20 rounded-xl flex items-start gap-2.5 text-xs text-[var(--color-danger)] shadow-sm animate-shake">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <div>{error.message}</div>
                  {error.recoverableActions && error.recoverableActions.length > 0 && (
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {error.recoverableActions.map((a) => (
                        <button key={a.label} type="button" onClick={() => { a.action(); clearError(); }} className="text-[var(--color-danger)] underline underline-offset-2 hover:no-underline font-medium cursor-pointer">
                          {a.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={clearError}
                  className="p-0.5 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-danger)]"
                  aria-label={t('chat.dismissError')}
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
            {/* Composer popover. Mirrors welcome popover's `!activeSessionId`
                gate so only one slash popup is open at a time. */}
            <Popover
              open={(slashOpen || isAtMentionOpen) && !!activeSessionId}
              onOpenChange={(open) => {
                if (!open) {
                  setSlashOpen(false);
                  useAtMentionStore.getState().close();
                }
              }}
              modal={false}
            >
              <PopoverAnchor asChild>
                <form onSubmit={(e) => e.preventDefault()} className="chat-composer relative z-10 flex flex-col bg-[var(--color-bg-surface)] border border-[var(--color-border)] focus-within:border-[var(--color-accent)] focus-within:ring-1 focus-within:ring-[var(--color-accent)]/20 rounded-xl p-3 transition-all shadow-lg">
                  {/* Upper: Text Input Area */}
                  {/* HOTFIX 2026-06-05: `style={{ fontSize: '14px' }}` on the
                      wrapper ensures the SlashToken inherits the same 14px
                      font that the composer's textarea uses. The `ch` unit
                      in SlashToken's `min-width` then matches the textarea's
                      per-character width so the cursor lands at the right
                      edge of the pill, not inside it. */}
                  <div className="flex flex-wrap items-start gap-1.5 w-full relative z-0" style={{ fontSize: '14px' }}>
                    {leadingTokens.map((t, idx) => (
                      <div key={idx} className="flex-shrink-0 pt-[2px]">
                        {t.type === 'slash' ? (
                          <SlashToken name={t.name} source={t.source} />
                        ) : (
                          <AtToken path={t.name} kind={t.kind!} />
                        )}
                      </div>
                    ))}
                    <textarea
                      ref={textareaRef}
                      value={visibleInputTail}
                      onChange={(e) => {
                        const tail = e.target.value;
                        const prefix = leadingTokens.map((t) => t.raw).join(' ') + (leadingTokens.length > 0 ? ' ' : '');
                        const value = prefix + (tail.startsWith(' ') ? tail.slice(1) : tail);
                        setInputVal(value);
                        if (isComposingRef.current) return; // PITFALLS P13: IME composition guard
                        const shouldOpen = value.startsWith('/') && !value.includes(' ') && value.length <= 32 && !parsedToken?.token;
                        setSlashOpen(shouldOpen);
                        // Phase 08.3 A-01: at-mention trigger (composer) — mirrors welcome onChange.
                        if (!isComposingRef.current && currentProjectRoot) {
                          const cursor = e.target.selectionStart + prefix.length;
                          const textBeforeCursor = value.slice(0, cursor);
                          const atMatch = textBeforeCursor.match(/(?:^|\s)@(\S*)$/);
                          if (atMatch) {
                            const state = useAtMentionStore.getState();
                            if (!state.isOpen) {
                              state.open(cursor);
                            } else {
                              useAtMentionStore.setState({ cursorPos: cursor });
                            }
                            state.setQuery(atMatch[1]);
                          } else {
                            useAtMentionStore.getState().close();
                          }
                        } else {
                          useAtMentionStore.getState().close();
                        }
                      }}
                      onCompositionStart={handleCompositionStart}
                      onCompositionEnd={handleCompositionEnd}
                      onKeyDown={handleKeyDown}
                      placeholder={leadingTokens.length > 0 ? '' : t('chat.composerPlaceholder')}
                      rows={2}
                      className="flex-1 min-w-[120px] !w-auto bg-transparent caret-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none resize-none text-sm min-h-[56px] max-h-40 py-1"
                    />
                  </div>
              
                  {/* Lower: Toolbar Row */}
                  <div className="flex justify-between items-center border-t border-[var(--color-border)]/30 pt-2.5 mt-1">
                    <div className="flex items-center gap-1.5">
                      <div 
                        className={`model-selector model-selector--composer ${composerModelSelectorOpen ? 'open' : ''}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div
                          onClick={() => setComposerModelSelectorOpen(!composerModelSelectorOpen)}
                          className="model-selector-trigger"
                        >
                          <span className="model-selector-label truncate max-w-[150px]" title={currentModelLabel}>
                            {currentModelLabel}
                          </span>
                          <ChevronDown className="model-chevron w-3.5 h-3.5" />
                        </div>
                        <div className="model-dropdown">
                          {providers.length === 0 ? (
                            <div 
                              onClick={() => {
                                setComposerModelSelectorOpen(false);
                                onOpenSettings?.();
                              }}
                              className="model-select-option text-[var(--color-text-muted)] italic cursor-pointer text-center py-2"
                            >
                              {t('chat.noProvidersAvailable')}
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
                                    title={`${p.name} • ${m}`}
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

                    <div className="flex items-center gap-1.5">
                      <ContextButton />
                      {isStreaming ? (
                        <button
                          type="button"
                          onClick={stopMessage}
                          className="p-2 rounded-lg bg-[var(--color-danger-dim)] hover:bg-[var(--color-danger)] hover:text-white text-[var(--color-danger)] transition-all flex items-center justify-center cursor-pointer"
                          title={t('chat.stopGenerating')}
                          aria-label={t('chat.stopGenerating')}
                        >
                          <Square className="w-4 h-4 fill-current" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSend()}
                          disabled={!inputVal.trim() || isStreaming}
                          className="p-2 rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-hover)] disabled:text-[var(--color-text-muted)] text-white transition-all shadow-md flex items-center justify-center cursor-pointer"
                          aria-label={t('chat.sendMessage')}
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </form>
              </PopoverAnchor>
              {/* IME z-index known issue: see SlashCommandPopup.tsx for full context. macOS IME candidate windows sit above web-layer z-index; press Esc to dismiss. (D-13..D-15, accepted as platform limitation.) */}
              <PopoverContent
                onOpenAutoFocus={(e) => e.preventDefault()}
                align="start"
                side="top"
                sideOffset={8}
                className="w-[var(--radix-popover-anchor-width)]"
              >
                {slashOpen ? (
                  <SlashCommandPopup
                    ref={slashRef}
                    query={inputVal.startsWith('/') ? inputVal.slice(1) : ''}
                    onSelect={handleSlashSelect}
                    onInsert={handleSlashInsert}
                    onClose={() => setSlashOpen(false)}
                    commands={registry.commands}
                    hasMcpWarning={registry.warnings.some((w) => w.type === 'mcp_health_warning')}
                    mcpWarningMessage={registry.warnings.find((w) => w.type === 'mcp_health_warning')?.message}
                    loading={registry.loading}
                  />
                ) : (
                  <AtMentionPopup
                    ref={atRef}
                    query={atMentionQuery}
                    candidates={atMentionCandidates}
                    truncated={atMentionTruncated}
                    loading={atMentionLoading}
                    onSelect={handleAtSelect}
                    onClose={() => useAtMentionStore.getState().close()}
                  />
                )}
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>
    </div>
  );
}
