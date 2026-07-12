import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project } from '@shared/types';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useLLMStore } from '../../stores/llmStore';
import { useAgentStore } from '../../stores/agentStore';
import { useAISubscriptionStore } from '../../stores/aiSubscriptionStore';
import {
  Plus, Image, BarChart3, GitBranch, MessagesSquare
} from 'lucide-react';
import { toast } from 'sonner';

import { useChatScroll } from './useChatScroll';
import { resolve as dispatcherResolve, dispatch as dispatcherDispatch } from '@/lib/commands/dispatcher';
import { useCommandRegistry } from '@/hooks/useCommandRegistry';
import { ApprovalModeSelector } from '@/components/shared/ApprovalModeSelector';
import { useComposerInputController } from './composerInput/useComposerInputController';
import { useComposerSubmissionController } from './composerInput/useComposerSubmissionController';
import { ConversationViewportSurface } from './ConversationViewportSurface';
import { ConversationWelcomeSurface } from './ConversationWelcomeSurface';
import { ConversationComposerDock } from './ConversationComposerDock';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useContextModalStore } from '@/stores/contextModalStore';
import { ModelSelectionSurface } from './modelSelection/ModelSelectionSurface';
import { useModelSelectionController } from './modelSelection/useModelSelectionController';
import { useConversationWorkspaceModel } from './useConversationWorkspaceModel';
import { useConversationPlanDisclosure } from './useConversationPlanDisclosure';
import { useConversationWorkspaceBootstrap } from './useConversationWorkspaceBootstrap';
import { CreateProjectDialog } from '@/components/ProjectTree/CreateProjectDialog';
import { WorkflowRunView } from '../WorkflowRunView/WorkflowRunView';
import { useWorkflowRunStore } from '../../stores/workflowRunStore';

interface ChatAreaProps {
  onOpenSettings?: () => void;
  onOpenPlugins?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  taskPanelOpen?: boolean;
  onToggleTaskPanel?: () => void;
  onOpenTaskPanel?: () => void;
  scene?: string;
}

export function ChatArea({
  onOpenSettings,
  onOpenPlugins,
  onToggleSidebar,
  onOpenTaskPanel,
  scene
}: ChatAreaProps) {
  const { t } = useTranslation();
  const setProjects = useProjectStore((s) => s.setProjects);
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const selectSession = useSessionStore((s) => s.selectSession);
  const clearError = useSessionStore((s) => s.clearError);
  const createSession = useSessionStore((s) => s.createSession);
  const fetchSessions = useSessionStore((s) => s.fetchSessions);
  const stopMessage = useSessionStore((s) => s.stopMessage);
  const setSessionModelOverride = useSessionStore((s) => s.setSessionModelOverride);
  const setSessionReasoningEffort = useSessionStore((s) => s.setSessionReasoningEffort);
  const fetchProviders = useLLMStore((s) => s.fetchProviders);
  const fetchAISubscriptionEntries = useAISubscriptionStore((s) => s.fetchEntries);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const setViewingSubagent = useSessionStore((s) => s.setViewingSubagent);
  const setViewingParallelWorker = useSessionStore((s) => s.setViewingParallelWorker);
  const activeWorkflowRun = useWorkflowRunStore((s) => s.activeRun);
  const isWorkflowGraphView = useWorkflowRunStore((s) => s.isGraphView);
  const setWorkflowGraphView = useWorkflowRunStore((s) => s.setGraphView);
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
    isConversationLoading,
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
    setSessionReasoningEffort,
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

  const openContextModal = useContextModalStore.getState().open;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (readerEvent) => {
        const dataUrl = readerEvent.target?.result;
        if (typeof dataUrl !== 'string') return;
        
        const result = composerInput.addAttachment({
          dataUrl,
          mimeType: file.type,
          sizeBytes: file.size,
        });
        
        if (!result.accepted) {
          if (result.reason === 'tooMany') {
            toast.warning('最多添加 5 张图片');
          } else if (result.reason === 'tooLarge') {
            toast.warning(`图片过大（${(file.size / 1024 / 1024).toFixed(1)}MB），最大 5MB`);
          } else if (result.reason === 'unsupportedType') {
            toast.warning('不支持的图片类型');
          }
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }, [composerInput]);

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
    selectedReasoningEffort: modelSelection.selectedReasoningEffort,
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
    setSessionReasoningEffort,
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

  useEffect(() => {
    if (!activeSessionId) {
      useWorkflowRunStore.getState().clear();
      return;
    }
    if (!window.electronAPI?.workflowRun?.getRunBySession) return;
    void useWorkflowRunStore.getState().loadRunForSession(activeSessionId);
  }, [activeSessionId]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--color-bg-app)] overflow-hidden relative">
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileChange}
        accept="image/*"
        multiple
        style={{ display: 'none' }}
      />
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
        onOpenPlugins={onOpenPlugins}
        leftToolbarSlot={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="p-1 rounded-md text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors border-0 bg-transparent cursor-pointer flex items-center justify-center"
                  title={t('chat.addAttachment')}
                  aria-label={t('chat.addAttachment')}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-[180px] z-50">
                <DropdownMenuItem
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 text-xs py-2 cursor-pointer"
                >
                  <Image className="w-3.5 h-3.5 text-[var(--color-text-secondary)]" />
                  <span>添加图片附件</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={openContextModal}
                  className="flex items-center gap-2 text-xs py-2 cursor-pointer"
                >
                  <BarChart3 className="w-3.5 h-3.5 text-[var(--color-text-secondary)]" />
                  <span>查看上下文占用</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ApprovalModeSelector />
          </>
        }
        modelSelectorSlot={
          <>
            <ModelSelectionSurface
              variant="welcome"
              modelGroups={modelSelection.modelGroups}
              selectedSourceType={modelSelection.selectedSourceType}
              selectedSourceId={modelSelection.selectedSourceId}
              selectedModel={modelSelection.selectedModel}
              currentModelLabel={modelSelection.currentModelLabel}
              currentProviderType={modelSelection.currentCandidate?.providerType}
              onSelectModel={modelSelection.selectModel}
              onOpenSettings={onOpenSettings}
              selectedReasoningEffort={modelSelection.selectedReasoningEffort}
              onSelectReasoningEffort={modelSelection.selectReasoningEffort}
            />
          </>
        }
      />

      {/* Main Chat Workspace */}
      <div 
        className={`absolute inset-0 flex flex-col bg-[var(--color-bg-app)] overflow-hidden transition-[opacity,transform] duration-200 ease-out ${
          activeSessionId 
            ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto z-10' 
            : 'opacity-0 -translate-y-4 scale-105 pointer-events-none z-0'
        }`}
      >
        {/* Chat Header */}
        {scene !== 'research' && (
          <header className="main-topbar shrink-0 h-10">
            <div className="main-topbar-left" />
          </header>
        )}

        {/* Messages Viewport — sub-agent view or master conversation */}
        <div className="flex-1 relative overflow-hidden">
          {activeWorkflowRun && (
            <div className="absolute right-3 top-2 z-20 flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-1 shadow-sm">
              <button
                type="button"
                aria-pressed={!isWorkflowGraphView}
                onClick={() => setWorkflowGraphView(false)}
                className={`flex items-center gap-1 rounded-[var(--radius-xs)] px-2 py-1 text-xs ${
                  !isWorkflowGraphView
                    ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]'
                }`}
              >
                <MessagesSquare className="h-3.5 w-3.5" />
                {t('workflow.runView.chatTimeline')}
              </button>
              <button
                type="button"
                aria-pressed={isWorkflowGraphView}
                onClick={() => setWorkflowGraphView(true)}
                className={`flex items-center gap-1 rounded-[var(--radius-xs)] px-2 py-1 text-xs ${
                  isWorkflowGraphView
                    ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]'
                }`}
              >
                <GitBranch className="h-3.5 w-3.5" />
                {t('workflow.runView.runGraph')}
              </button>
            </div>
          )}
          {activeWorkflowRun && isWorkflowGraphView ? (
            <WorkflowRunView />
          ) : (
          <ConversationViewportSurface
            activeSessionId={activeSessionId}
            timelineItems={timelineItems}
            messages={messages}
            isConversationLoading={isConversationLoading}
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
          )}
        </div>

        {activeSessionId &&
          <ConversationComposerDock
            hidden={Boolean(viewingTask || viewingWorkerData || (activeWorkflowRun && isWorkflowGraphView))}
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
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="p-1 rounded-md text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors border-0 bg-transparent cursor-pointer flex items-center justify-center"
                      title={t('chat.addAttachment')}
                      aria-label={t('chat.addAttachment')}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-[180px] z-50">
                    <DropdownMenuItem
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 text-xs py-2 cursor-pointer"
                    >
                      <Image className="w-3.5 h-3.5 text-[var(--color-text-secondary)]" />
                      <span>添加图片附件</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={openContextModal}
                      className="flex items-center gap-2 text-xs py-2 cursor-pointer"
                    >
                      <BarChart3 className="w-3.5 h-3.5 text-[var(--color-text-secondary)]" />
                      <span>查看上下文占用</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <ApprovalModeSelector dropUp />
              </>
            }
            modelSelectorSlot={
              <>
                <ModelSelectionSurface
                  variant="composer"
                  modelGroups={modelSelection.modelGroups}
                  selectedSourceType={modelSelection.selectedSourceType}
                  selectedSourceId={modelSelection.selectedSourceId}
                  selectedModel={modelSelection.selectedModel}
                  currentModelLabel={modelSelection.currentModelLabel}
                  currentProviderType={modelSelection.currentCandidate?.providerType}
                  onSelectModel={modelSelection.selectModel}
                  onOpenSettings={onOpenSettings}
                  selectedReasoningEffort={modelSelection.selectedReasoningEffort}
                  onSelectReasoningEffort={modelSelection.selectReasoningEffort}
                />
              </>
            }
          />
          }
      </div>
      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        onProjectCreated={handleProjectCreated}
      />
    </div>
  );
}
