import { useMemo } from 'react';
import type { AISubscriptionEntry, ReasoningEffort } from '@shared/ai-subscriptions';
import type { Agent, ConversationModelSourceType, LLMProvider, Message, Project, Session, TodoItem } from '@shared/types';
import { useGoalJudgeStatus } from '../../hooks/useGoalJudge';
import { useAgentStore } from '../../stores/agentStore';
import { useAISubscriptionStore } from '../../stores/aiSubscriptionStore';
import { useLLMStore } from '../../stores/llmStore';
import { useProjectStore } from '../../stores/projectStore';
import {
  type DelegatedTask,
  type ParallelWorker,
  type SessionError,
  useSessionStore,
} from '../../stores/sessionStore';
import {
  projectConversationTimeline,
  type ConversationTimelineItem,
} from './conversationTimeline/conversationTimeline';

interface ConversationWorkspaceModel {
  workspace: {
    currentProjectId: string | null;
    projects: Project[];
    currentProjectName: string | null;
    currentProjectRoot: string | null;
    activeSessionId: string | null;
    activeSession: Session | null;
  };
  viewport: {
    messages: Message[];
    isStreaming: boolean;
    error: SessionError | null;
    timelineItems: ConversationTimelineItem[];
    viewingTask: DelegatedTask | null;
    viewingWorkerData: ParallelWorker | null;
    hasActiveGoal: boolean;
  };
  plan: {
    todos: TodoItem[];
    streamingMessageId: string | null;
    activeRunId: string | null;
  };
  composer: {
    mode: 'welcome' | 'session';
    hasPathMentionProject: boolean;
  };
  agent: {
    agents: Agent[];
    defaultAgent: Agent | null;
    activeSessionAgent: Agent | null;
    masterProvider: LLMProvider | null;
  };
  model: {
    providers: LLMProvider[];
    aiSubscriptionEntries: AISubscriptionEntry[];
    sessionModelOverrides: Record<string, {
      providerId: string;
      sourceId?: string;
      sourceType?: ConversationModelSourceType;
      model: string;
      reasoningEffort?: ReasoningEffort;
    }>;
  };
}

export function useConversationWorkspaceModel(): ConversationWorkspaceModel {
  const { currentProjectId, projects } = useProjectStore();
  const {
    sessions,
    activeSessionId,
    messages,
    isStreaming,
    streamingMessageId,
    activeRunId,
    error,
    todos,
    pendingApproval,
    delegatedTasks,
    parallelBatches,
    viewingSubagentId,
    viewingParallelWorker,
    sessionModelOverrides,
  } = useSessionStore();
  const { providers } = useLLMStore();
  const aiSubscriptionEntries = useAISubscriptionStore((state) => state.entries);
  const { agents } = useAgentStore();
  const { status: goalStatus, goal: activeGoal } = useGoalJudgeStatus(activeSessionId || '');

  const currentProject = useMemo(
    () => projects.find((project) => project.id === currentProjectId) ?? null,
    [projects, currentProjectId],
  );

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  const timelineItems = useMemo(() => (
    projectConversationTimeline({
      messages: messages || [],
      isStreaming,
      pendingApproval,
    })
  ), [messages, isStreaming, pendingApproval]);

  const viewingTask = useMemo(
    () => viewingSubagentId ? delegatedTasks.find((task) => task.taskId === viewingSubagentId) ?? null : null,
    [viewingSubagentId, delegatedTasks],
  );

  const viewingWorkerData = useMemo(() => {
    if (!viewingParallelWorker) return null;
    const batch = parallelBatches.find((item) => item.batchId === viewingParallelWorker.batchId);
    if (!batch) return null;
    return batch.workers.find((worker) => (
      viewingParallelWorker.workerId
        ? worker.workerId === viewingParallelWorker.workerId
        : worker.agentSlug === viewingParallelWorker.agentSlug
    )) ?? null;
  }, [viewingParallelWorker, parallelBatches]);

  const defaultAgent = useMemo(() => (
    agents.find((agent) => agent.project_id === currentProjectId && agent.is_default === 1) ?? null
  ), [agents, currentProjectId]);

  const activeSessionAgent = useMemo(() => (
    agents.find((agent) => agent.id === activeSession?.agent_id) ?? defaultAgent
  ), [activeSession?.agent_id, agents, defaultAgent]);

  const masterProvider = useMemo(() => {
    const baseAgent = activeSession ? activeSessionAgent : defaultAgent;
    return providers.find((provider) => provider.id === baseAgent?.provider_id) ?? null;
  }, [activeSession, activeSessionAgent, defaultAgent, providers]);

  const hasActiveGoal = Boolean(activeSessionId && goalStatus && activeGoal);

  return {
    workspace: {
      currentProjectId,
      projects,
      currentProjectName: currentProject?.name ?? null,
      currentProjectRoot: currentProject?.path ?? null,
      activeSessionId,
      activeSession,
    },
    viewport: {
      messages,
      isStreaming,
      error,
      timelineItems,
      viewingTask,
      viewingWorkerData,
      hasActiveGoal,
    },
    plan: {
      todos,
      streamingMessageId,
      activeRunId,
    },
    composer: {
      mode: activeSessionId ? 'session' : 'welcome',
      hasPathMentionProject: Boolean(currentProject?.path),
    },
    agent: {
      agents,
      defaultAgent,
      activeSessionAgent,
      masterProvider,
    },
    model: {
      providers,
      aiSubscriptionEntries,
      sessionModelOverrides: sessionModelOverrides || {},
    },
  };
}
