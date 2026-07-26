// Shared contract for the session store slices (#235). The public shape of the
// store (SessionState and the exported data types) lives here; sessionStore.ts
// re-exports the public pieces so consumer imports stay unchanged.
import type { StoreApi } from 'zustand';
import type {
  AgentApprovalRequest,
  AgentApprovalHistoryEntry,
  AgentRun,
  AgentToolCall,
  ChatRuntimeOverrides,
  ConversationRunStreamEnvelope,
  ConversationModelSourceType,
  ExecutionStep,
  Message,
  Session,
  SkillAttribution,
  TodoItem,
} from '@shared/types';
import type { ReasoningEffort } from '@shared/ai-subscriptions';
import type {
  ConversationRuntimeProjectionDeps,
  ConversationRuntimeProjectionState,
} from '../../components/ChatArea/conversationRuntime/conversationRuntimeProjection';
import type {
  ConversationRuntimeRegistryAction,
  ConversationRuntimeRegistryResult,
  ConversationRuntimeRegistryState,
} from '../../components/ChatArea/conversationRuntime/conversationRuntimeRegistry';

export interface SessionError {
  message: string;
  messageParams?: Record<string, string | number>;
  recoverableActions?: { label: string; action: () => void }[];
}

export type SendMessageResult =
  | { ok: true }
  | { ok: false; code: 'CONVERSATION_BUSY' };

export interface ParallelWorker {
  delegatedRunId: string;
  agentSlug: string;
  agentName?: string;   // 来自 task_start.label
  goal?: string;        // 来自 task_start.goal（原始任务描述）
  summary?: string;     // 来自 task_end.summary（完成后的输出摘要）
  status: 'running' | 'success' | 'failure';
  steps: ExecutionStep[];
  textBuffer: string;
  startedAt: number;
  completedAt?: number;
}

export interface ParallelBatch {
  batchId: string;
  workers: ParallelWorker[];
  startedAt: number;
}

export interface DelegatedTask {
  delegatedRunId: string;
  taskId: string;
  agentSlug: string;
  agentName: string;
  goal: string;
  status: 'running' | 'success' | 'failure';
  chunks: string[];
  steps: ExecutionStep[];
  startedAt?: number;
  completedAt?: number;
  result?: {
    status: 'success' | 'failure';
    artifacts: string[];
    summary: string;
    error?: { code: string; message: string };
  };
  errorCode?: string;
}

// 08.2 P3 C1-05: per-session /goal judge status. Type intentionally lives
// alongside the store contract (rather than in useGoalJudge.ts) so other
// consumers (e.g. GoalSystemBubble) can import the canonical shape without
// pulling in the judge orchestration module.
export type JudgeStatus = 'idle' | 'judging' | 'satisfied' | 'unsatisfied' | 'failed' | 'paused';

export interface GoalJudgeStatusEntry {
  status: JudgeStatus;
  iteration: number;
  startedAt: number;
  reason?: string;
}

export interface SendMessageOptions {
  hiddenUserMessage?: boolean;
  imageBase64?: string[];
  skillAttributions?: SkillAttribution[];
}

export interface SessionState {
  sessions: Session[];
  activeSessionId: string | null;
  messages: Message[];
  isStreaming: boolean;
  streamingMessageId: string | null;
  activeRunId: string | null;
  agentRuns: AgentRun[];
  agentToolCalls: AgentToolCall[];
  delegatedTasks: DelegatedTask[];
  parallelBatches: ParallelBatch[];
  todos: TodoItem[];
  pendingApproval: AgentApprovalRequest | null;
  pendingApprovals: AgentApprovalRequest[];
  approvalHistory: AgentApprovalHistoryEntry[];
  error: SessionError | null;
  isConversationLoading: boolean;
  conversationRuntimeRegistry: ConversationRuntimeRegistryState;
  // D-02/D-04/D-05: per-session user goal (in-memory, persists across switches)
  sessionGoals: Map<string, string>;
  // 08.2 P3 C1-05: per-session /goal judge status (iteration + reason).
  // P6 pitfall (session leak): status is keyed by sessionId and NOT cleared
  // on session switch — goal is sticky per P6 lock. ChatArea/GoalSystemBubble
  // filter by activeSessionId at render time.
  goalJudgeStatus: Map<string, GoalJudgeStatusEntry>;
  sessionModelOverrides: Record<string, {
    providerId: string;
    sourceId?: string;
    sourceType?: ConversationModelSourceType;
    model: string;
    reasoningEffort?: ReasoningEffort;
  }>;
  setSessionModelOverride: (
    sessionId: string,
    sourceId: string,
    model: string,
    sourceType?: ConversationModelSourceType
  ) => void;
  setSessionReasoningEffort: (sessionId: string, effort?: ReasoningEffort) => void;
  hydrateSessionModelOverrides: () => Promise<void>;
  fetchSessions: (projectId: string) => Promise<void>;
  createSession: (projectId: string, name: string, parentSessionId?: string, summary?: string) => Promise<Session>;
  deleteSession: (sessionId: string) => Promise<void>;
  selectSession: (sessionId: string | null) => Promise<void>;
  fetchAgentActivity: (sessionId: string, force?: boolean) => Promise<void>;
  sendMessage: (projectId: string, content: string, overrides?: ChatRuntimeOverrides, targetSessionId?: string, options?: SendMessageOptions) => Promise<SendMessageResult>;
  handleConversationRunEvent: (envelope: ConversationRunStreamEnvelope) => void;
  handleMessagesChanged: (sessionId: string) => void;
  hydrateConversationRun: (sessionId: string, expectedRequestId?: string) => Promise<void>;
  getMessagesForSession: (sessionId: string) => Message[];
  getIsSessionStreaming: (sessionId: string) => boolean;
  setSessionGoal: (sessionId: string, goal: string) => void;
  setGoalJudgeStatus: (sessionId: string, partial: Partial<GoalJudgeStatusEntry>) => void;
  getGoalJudgeStatus: (sessionId: string) => GoalJudgeStatusEntry | undefined;
  clearGoalJudgeStatus: (sessionId: string) => void;
  viewingSubagentId: string | null;
  setViewingSubagent: (id: string | null) => void;
  viewingParallelWorker: { batchId: string; delegatedRunId: string; agentSlug: string } | null;
  setViewingParallelWorker: (key: { batchId: string; delegatedRunId: string; agentSlug: string } | null) => void;
  resolveApproval: (decision: 'approve' | 'reject' | 'edit', editedArgs?: string, approvalId?: string) => Promise<void>;
  stopMessage: () => Promise<void>;
  clearError: () => void;
  updateMessageThinkDuration: (messageId: string, seconds: number) => void;
}

/**
 * Registry machinery shared by the slices: transition dispatch, projection
 * publishing and the deps used to project runtime events. Implemented by
 * createRuntimeRegistryAdapter.
 */
export interface RuntimeRegistryAdapter {
  projectionDeps: ConversationRuntimeProjectionDeps;
  projectionPatch: (projection: ConversationRuntimeProjectionState) => Partial<SessionState>;
  publishRegistryEntry: (conversationId: string) => void;
  transitionRegistry: (action: ConversationRuntimeRegistryAction) => ConversationRuntimeRegistryResult;
}

export interface SessionSliceContext {
  set: StoreApi<SessionState>['setState'];
  get: StoreApi<SessionState>['getState'];
  registry: RuntimeRegistryAdapter;
}
