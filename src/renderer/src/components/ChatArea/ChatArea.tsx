import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useFileStore } from '../../stores/fileStore';
import { useLLMStore } from '../../stores/llmStore';
import { useAgentStore } from '../../stores/agentStore';
import {
  ArrowUp, Square,
  ChevronDown, Plus, SlidersHorizontal
} from 'lucide-react';

import { useChatScroll } from './useChatScroll';
import { TodoList } from './TodoList';
import { resolve as dispatcherResolve, dispatch as dispatcherDispatch } from '@/lib/commands/dispatcher';
import { useCommandRegistry } from '@/hooks/useCommandRegistry';
import { useGoalJudgeStatus } from '../../hooks/useGoalJudge';
import { ApprovalModeSelector } from '@/components/shared/ApprovalModeSelector';
import { useComposerInputController } from './composerInput/useComposerInputController';
import { ComposerInputSurface } from './composerInput/ComposerInputSurface';
import { useComposerSubmissionController } from './composerInput/useComposerSubmissionController';
import { projectConversationTimeline } from './conversationTimeline/conversationTimeline';
import { ConversationViewportSurface } from './ConversationViewportSurface';
import { ConversationWelcomeSurface } from './ConversationWelcomeSurface';

interface ChatAreaProps {
  onOpenSettings?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  taskPanelOpen?: boolean;
  onToggleTaskPanel?: () => void;
  onOpenTaskPanel?: () => void;
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
  const filePanelOpen = useFileStore((s) => s.filePanelOpen);
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
  const viewingSubagentId = useSessionStore((s) => s.viewingSubagentId);
  const setViewingSubagent = useSessionStore((s) => s.setViewingSubagent);
  const delegatedTasks = useSessionStore((s) => s.delegatedTasks);
  const viewingTask = useMemo(
    () => viewingSubagentId ? delegatedTasks.find((t) => t.taskId === viewingSubagentId) ?? null : null,
    [viewingSubagentId, delegatedTasks],
  );
  const viewingParallelWorker = useSessionStore((s) => s.viewingParallelWorker);
  const setViewingParallelWorker = useSessionStore((s) => s.setViewingParallelWorker);
  const parallelBatches = useSessionStore((s) => s.parallelBatches);
  const viewingWorkerData = useMemo(() => {
    if (!viewingParallelWorker) return null;
    const batch = parallelBatches.find((b) => b.batchId === viewingParallelWorker.batchId);
    if (!batch) return null;
    return batch.workers.find((w) =>
      viewingParallelWorker.workerId ? w.workerId === viewingParallelWorker.workerId : w.agentSlug === viewingParallelWorker.agentSlug
    ) ?? null;
  }, [viewingParallelWorker, parallelBatches]);

  const [welcomeModelSelectorOpen, setWelcomeModelSelectorOpen] = useState(false);
  const [composerModelSelectorOpen, setComposerModelSelectorOpen] = useState(false);
  const sessionModelOverrides = useSessionStore((state) => state.sessionModelOverrides) || {};
  const override = activeSessionId ? sessionModelOverrides[activeSessionId] : (sessionModelOverrides[''] || null);
  const selectedProviderId = override?.providerId || '';
  const selectedModel = override?.model || '';
  const [todoExpandedByPlan, setTodoExpandedByPlan] = useState<Record<string, boolean>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
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
  // Only reset if we are not actively streaming or waiting for approval to avoid breaking state when switching views
  useEffect(() => {
    const { isStreaming, pendingApproval } = useSessionStore.getState();
    if (!isStreaming && !pendingApproval) {
      useSessionStore.setState({ isStreaming: false, streamingMessageId: null });
    }
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
    return projects.find(p => p.id === currentProjectId)?.name || t('chat.unknownProject');
  }, [currentProjectId, projects]);

  // Phase 08.3 B-01: derive the project root for at-mention enumeration.
  // Returns null when no project is active — the @ trigger MUST not open the popup in that case.
  const currentProjectRoot = useMemo(
    () => projects.find((p) => p.id === currentProjectId)?.path ?? null,
    [projects, currentProjectId]
  );

  const activeSession = useMemo(() => {
    return sessions.find(s => s.id === activeSessionId) || null;
  }, [activeSessionId, sessions]);

  const timelineItems = useMemo(() => (
    projectConversationTimeline({
      messages: messages || [],
      isStreaming,
      pendingApproval,
    })
  ), [messages, isStreaming, pendingApproval]);


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

  const renderModelSelector = (
    variant: 'welcome' | 'composer',
    open: boolean,
    setOpen: (open: boolean) => void
  ) => {
    const directionClass = variant === 'welcome'
      ? 'model-selector model-selector--welcome'
      : 'model-selector model-selector--composer';

    return (
      <div
        className={`${directionClass} ${open ? 'open' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          onClick={() => setOpen(!open)}
          className="model-selector-trigger"
        >
          <span
            className={`model-selector-label ${variant === 'composer' ? 'truncate max-w-[150px]' : ''}`}
            title={currentModelLabel}
          >
            {currentModelLabel}
          </span>
          <ChevronDown className="model-chevron w-3.5 h-3.5" />
        </div>
        <div className="model-dropdown">
          {providers.length === 0 ? (
            <div
              onClick={() => {
                setOpen(false);
                onOpenSettings?.();
              }}
              className="model-select-option text-[var(--color-text-muted)] italic cursor-pointer text-center py-2"
            >
              {t('chat.noProvidersAvailable')}
            </div>
          ) : (
            providers.map((provider) => (
              <div key={provider.id} className="model-group">
                <div className="model-group-name">{provider.name}</div>
                {getProviderModels(provider).map((modelName) => (
                  <div
                    key={modelName}
                    className={`model-select-option ${
                      (selectedProviderId === provider.id && selectedModel === modelName) ||
                      (!selectedProviderId && !selectedModel && masterProvider?.id === provider.id && masterProvider?.default_model === modelName)
                        ? 'selected'
                        : ''
                    }`}
                    title={`${provider.name} • ${modelName}`}
                    onClick={() => handleSelectModel(provider.id, modelName)}
                  >
                    {modelName}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    );
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

  const composerInput = useComposerInputController({
    mode: activeSessionId ? 'session' : 'welcome',
    isStreaming,
    projectId: currentProjectId,
    hasPathMentionProject: Boolean(currentProjectRoot),
    commands: registry.commands,
    resolveCommand: dispatcherResolve,
  });

  const inputVal = composerInput.text;

  const composerSubmission = useComposerSubmissionController({
    composerInput,
    mode: activeSessionId ? 'session' : 'welcome',
    activeSessionId,
    currentProjectId,
    isStreaming,
    selectedProviderId,
    selectedModel,
    commands: registry.commands,
    resolveCommand: dispatcherResolve,
    dispatchCommand: dispatcherDispatch,
    createSession,
    selectSession,
    fetchSessions,
    sendMessage,
    getWelcomeModelOverride: () => useSessionStore.getState().sessionModelOverrides[''] || null,
    setSessionModelOverride: (sessionId, providerId, model) => {
      useSessionStore.getState().setSessionModelOverride(sessionId, providerId, model);
    },
    t,
  });

  // Clear Composer Input when active session changes to prevent drafts/capsules from being carried over.
  useEffect(() => {
    composerInput.reset();
  }, [activeSessionId, composerInput.reset]);

  const handleComposerSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const result = await composerSubmission.submit();
    if (result.type === 'failed') {
      console.error(`[composerSubmission/${result.phase}]`, result.error);
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

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--color-bg-app)] overflow-hidden relative">
      <ConversationWelcomeSurface
        visible={!activeSessionId}
        currentProjectId={currentProjectId}
        currentProjectName={currentProjectName}
        composerController={composerInput}
        error={error}
        commands={registry.commands}
        commandWarnings={registry.warnings}
        commandLoading={registry.loading}
        onCommandSelect={composerSubmission.selectCommandEntry}
        onCommandInsert={composerInput.insertCommand}
        onSubmit={() => handleComposerSubmit()}
        canSubmit={(inputVal.trim().length > 0 || composerInput.attachments.length > 0) && !isStreaming}
        onClearError={clearError}
        onCreateProject={handleCreateProject}
        onOpenSettings={onOpenSettings}
        leftToolbarSlot={
          <>
            <button type="button" className="dialog-btn" title={t('chat.addAttachment')} aria-label={t('chat.addAttachment')}>
              <Plus className="w-4 h-4" />
            </button>
            <ApprovalModeSelector />
          </>
        }
        modelSelectorSlot={renderModelSelector('welcome', welcomeModelSelectorOpen, setWelcomeModelSelectorOpen)}
      />

      {/* Main Chat Workspace */}
      <div 
        className={`absolute inset-0 flex flex-col bg-[var(--color-bg-app)] overflow-hidden transition-all duration-300 ease-in-out ${
          activeSessionId 
            ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto z-10' 
            : 'opacity-0 -translate-y-4 scale-105 pointer-events-none z-0'
        }`}
      >
        {/* Chat Header */}
        <header className="main-topbar shrink-0 h-9">

          <div className="main-topbar-left" />
          
          {/* Right Header Toolbar */}
          <div className={`main-topbar-right flex items-center gap-2 ml-auto no-drag ${filePanelOpen ? '-mr-4' : 'mr-2'}`}>
            <button
              onClick={onToggleTaskPanel}
              className={`w-7 h-7 flex items-center justify-center cursor-pointer rounded transition-all ${
                taskPanelOpen
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
              }`}
              title={taskPanelOpen ? t('chat.hideTaskPanel') : t('chat.showTaskPanel')}
              aria-label={taskPanelOpen ? t('chat.hideTaskPanel') : t('chat.showTaskPanel')}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        {/* Messages Viewport — sub-agent view or master conversation */}
        <div className="flex-1 relative overflow-hidden">
          <ConversationViewportSurface
            activeSessionId={activeSessionId}
            timelineItems={timelineItems}
            messages={messages}
            isStreaming={isStreaming}
            hasActiveGoal={hasActiveGoal}
            viewingTask={viewingTask}
            viewingWorkerData={viewingWorkerData}
            error={error}
            scrollContainerRef={scrollContainerRef}
            onScroll={handleScroll}
            onOpenTaskPanel={onOpenTaskPanel}
            onBackFromSubagent={() => setViewingSubagent(null)}
            onBackFromParallelWorker={() => setViewingParallelWorker(null)}
            onClearError={clearError}
          />
        </div>

        {/* Input Composer Panel — hidden when viewing sub-agent */}
        <div className={`absolute bottom-0 left-0 right-0 px-6 pb-6 pt-12 z-10 pointer-events-none ${(viewingTask || viewingWorkerData) ? 'hidden' : ''}`}>
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
            <ComposerInputSurface
              controller={composerInput}
              variant="session"
              inputLabel={t('chat.composerPlaceholder')}
              placeholder={t('chat.composerPlaceholder')}
              commands={registry.commands}
              commandWarnings={registry.warnings}
              commandLoading={registry.loading}
              onCommandSelect={composerSubmission.selectCommandEntry}
              onCommandInsert={composerInput.insertCommand}
              onSubmit={() => handleComposerSubmit()}
              canSubmit={(inputVal.trim().length > 0 || composerInput.attachments.length > 0) && !isStreaming}
              sendLabel={t('chat.sendMessage')}
              popoverEnabled={!!activeSessionId}
              leftToolbarSlot={
                <>
                  <button type="button" className="dialog-btn" title={t('chat.addAttachment')} aria-label={t('chat.addAttachment')}>
                    <Plus className="w-4 h-4" />
                  </button>
                  <ApprovalModeSelector dropUp />
                </>
              }
              modelSelectorSlot={renderModelSelector('composer', composerModelSelectorOpen, setComposerModelSelectorOpen)}
              submitSlot={
                isStreaming ? (
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
                    onClick={() => handleComposerSubmit()}
                    disabled={(inputVal.trim().length === 0 && composerInput.attachments.length === 0) || isStreaming}
                    className="dialog-btn send"
                    aria-label={t('chat.sendMessage')}
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                )
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
