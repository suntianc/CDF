import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project } from '@shared/types';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useFileStore } from '../../stores/fileStore';
import { useLLMStore } from '../../stores/llmStore';
import { useAgentStore } from '../../stores/agentStore';
import { useAISubscriptionStore } from '../../stores/aiSubscriptionStore';
import {
  Plus, SlidersHorizontal
} from 'lucide-react';

import { useChatScroll } from './useChatScroll';
import { resolve as dispatcherResolve, dispatch as dispatcherDispatch } from '@/lib/commands/dispatcher';
import { useCommandRegistry } from '@/hooks/useCommandRegistry';
import { ApprovalModeSelector } from '@/components/shared/ApprovalModeSelector';
import { useComposerInputController } from './composerInput/useComposerInputController';
import { useComposerSubmissionController } from './composerInput/useComposerSubmissionController';
import { ConversationViewportSurface } from './ConversationViewportSurface';
import { ConversationWelcomeSurface } from './ConversationWelcomeSurface';
import { ConversationComposerDock } from './ConversationComposerDock';
import { ContextButton } from '@/components/Composer/ContextButton';
import { ModelSelectionSurface } from './modelSelection/ModelSelectionSurface';
import { useModelSelectionController } from './modelSelection/useModelSelectionController';
import { useConversationWorkspaceModel } from './useConversationWorkspaceModel';
import { useConversationPlanDisclosure } from './useConversationPlanDisclosure';
import { useConversationWorkspaceBootstrap } from './useConversationWorkspaceBootstrap';
import { CreateProjectDialog } from '@/components/ProjectTree/CreateProjectDialog';

interface ChatAreaProps {
  onOpenSettings?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  taskPanelOpen?: boolean;
  onToggleTaskPanel?: () => void;
  onOpenTaskPanel?: () => void;
  scene?: string;
}

export function ChatArea({
  onOpenSettings,
  sidebarCollapsed,
  onToggleSidebar,
  taskPanelOpen,
  onToggleTaskPanel,
  onOpenTaskPanel,
  scene
}: ChatAreaProps) {
  const { t } = useTranslation();
  const filePanelOpen = useFileStore((s) => s.filePanelOpen);
  const setProjects = useProjectStore((s) => s.setProjects);
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const selectSession = useSessionStore((s) => s.selectSession);
  const clearError = useSessionStore((s) => s.clearError);
  const createSession = useSessionStore((s) => s.createSession);
  const fetchSessions = useSessionStore((s) => s.fetchSessions);
  const stopMessage = useSessionStore((s) => s.stopMessage);
  const setSessionModelOverride = useSessionStore((s) => s.setSessionModelOverride);
  const fetchProviders = useLLMStore((s) => s.fetchProviders);
  const fetchAISubscriptionEntries = useAISubscriptionStore((s) => s.fetchEntries);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const setViewingSubagent = useSessionStore((s) => s.setViewingSubagent);
  const setViewingParallelWorker = useSessionStore((s) => s.setViewingParallelWorker);
  const workspaceModel = useConversationWorkspaceModel();
  const {
    currentProjectId,
    projects,
    currentProjectName,
    activeSessionId,
    activeSession,
  } = workspaceModel.workspace;
  const {
    messages,
    isStreaming,
    error,
    timelineItems,
    viewingTask,
    viewingWorkerData,
    hasActiveGoal,
  } = workspaceModel.viewport;
  const { todos, streamingMessageId, activeRunId } = workspaceModel.plan;
  const { providers, aiSubscriptionEntries, sessionModelOverrides } = workspaceModel.model;
  const { activeSessionAgent, masterProvider } = workspaceModel.agent;
  const currentProjectDisplayName = currentProjectName ?? t('chat.unknownProject');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);

  const { handleScroll } = useChatScroll({
    scrollContainerRef,
    messages,
    activeSessionId,
    isStreaming,
  });

  const resetStaleStreamingState = useCallback(() => {
    const { isStreaming, pendingApproval } = useSessionStore.getState();
    if (!isStreaming && !pendingApproval) {
      useSessionStore.setState({ isStreaming: false, streamingMessageId: null });
    }
  }, []);

  const clearCompletedTodos = useCallback(() => {
    useSessionStore.setState({ todos: [] });
  }, []);

  useConversationWorkspaceBootstrap({
    currentProjectId,
    resetStaleStreamingState,
    fetchProviders,
    fetchAgents,
  });

  useEffect(() => {
    fetchAISubscriptionEntries();
  }, [fetchAISubscriptionEntries]);

  const planDisclosure = useConversationPlanDisclosure({
    activeSessionId,
    todos,
    isStreaming,
    streamingMessageId,
    activeRunId,
    clearTodos: clearCompletedTodos,
  });

  const modelSelection = useModelSelectionController({
    activeSessionId,
    providers,
    aiSubscriptionEntries,
    sessionModelOverrides,
    masterProvider,
    setSessionModelOverride,
  });

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
    mode: workspaceModel.composer.mode,
    isStreaming,
    projectId: currentProjectId,
    hasPathMentionProject: workspaceModel.composer.hasPathMentionProject,
    commands: registry.commands,
    resolveCommand: dispatcherResolve,
  });

  const inputVal = composerInput.text;

  const composerSubmission = useComposerSubmissionController({
    composerInput,
    mode: workspaceModel.composer.mode,
    activeSessionId,
    currentProjectId,
    isStreaming,
    selectedSourceType: modelSelection.selectedSourceType,
    selectedSourceId: modelSelection.selectedSourceId,
    selectedModel: modelSelection.selectedModel,
    commands: registry.commands,
    resolveCommand: dispatcherResolve,
    dispatchCommand: dispatcherDispatch,
    createSession,
    selectSession,
    fetchSessions,
    sendMessage,
    getWelcomeModelOverride: () => useSessionStore.getState().sessionModelOverrides[''] || null,
    setSessionModelOverride: (sessionId, sourceId, model, sourceType) => {
      setSessionModelOverride(sessionId, sourceId, model, sourceType);
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

  const handleProjectCreated = async (project: Project) => {
    setProjects([...projects, project]);
    setCurrentProject(project.id);
    await fetchSessions(project.id);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--color-bg-app)] overflow-hidden relative">
      <ConversationWelcomeSurface
        visible={!activeSessionId}
        currentProjectId={currentProjectId}
        currentProjectName={currentProjectDisplayName}
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
        onCreateProject={() => setCreateProjectOpen(true)}
        onOpenSettings={onOpenSettings}
        leftToolbarSlot={
          <>
            <button type="button" className="dialog-btn" title={t('chat.addAttachment')} aria-label={t('chat.addAttachment')}>
              <Plus className="w-4 h-4" />
            </button>
            <ApprovalModeSelector />
            <ContextButton />
          </>
        }
        modelSelectorSlot={
          <ModelSelectionSurface
            variant="welcome"
            modelGroups={modelSelection.modelGroups}
            selectedSourceType={modelSelection.selectedSourceType}
            selectedSourceId={modelSelection.selectedSourceId}
            selectedModel={modelSelection.selectedModel}
            currentModelLabel={modelSelection.currentModelLabel}
            onSelectModel={modelSelection.selectModel}
            onOpenSettings={onOpenSettings}
          />
        }
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
        {scene !== 'research' && (
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
        )}

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

        {activeSessionId && (
          <ConversationComposerDock
            hidden={Boolean(viewingTask || viewingWorkerData)}
            showTodos={planDisclosure.showTodos}
            todos={todos}
            todoExpanded={planDisclosure.todoExpanded}
            onToggleTodoExpanded={planDisclosure.toggleTodoExpanded}
            composerController={composerInput}
            isStreaming={isStreaming}
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
            stopGeneratingLabel={t('chat.stopGenerating')}
            onStopGenerating={stopMessage}
            leftToolbarSlot={
              <>
                <button type="button" className="dialog-btn" title={t('chat.addAttachment')} aria-label={t('chat.addAttachment')}>
                  <Plus className="w-4 h-4" />
                </button>
                <ApprovalModeSelector dropUp />
                <ContextButton />
              </>
            }
            modelSelectorSlot={
              <ModelSelectionSurface
                variant="composer"
                modelGroups={modelSelection.modelGroups}
                selectedSourceType={modelSelection.selectedSourceType}
                selectedSourceId={modelSelection.selectedSourceId}
                selectedModel={modelSelection.selectedModel}
                currentModelLabel={modelSelection.currentModelLabel}
                onSelectModel={modelSelection.selectModel}
                onOpenSettings={onOpenSettings}
              />
            }
          />
        )}
      </div>

      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        onProjectCreated={handleProjectCreated}
      />
    </div>
  );
}
