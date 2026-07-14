import type { ReasoningEffort } from './ai-subscriptions';
import type {
  AgentApprovalRequest,
  AgentApprovalStatus,
  AgentRunStatus,
  DelegatedTaskResult,
  ExecutionStep,
} from './agent-runtime';
import type { SkillAttribution } from './skills';

export interface Session {
  id: string;
  project_id: string;
  name: string;
  agent_id?: string | null;
  parent_session_id?: string | null;
  summary?: string | null;
  prompt_snapshot?: string | null;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: number;
  tokens?: number | null;
  think_duration_seconds?: number | null;
  imageBase64?: string[];
}

// IPC 保存入参：以 db:saveMessage handler 实际消费的字段为真（created_at 由主进程生成）。
export interface MessageSaveInput {
  id: string;
  session_id: string;
  role: Message['role'];
  content: string;
  tokens?: number | null;
  think_duration_seconds?: number | null;
  imageBase64?: string[];
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export type LLMStreamEvent =
  | { type: 'run_started'; runId: string; agentId: string; status: AgentRunStatus }
  | { type: 'run_updated'; runId: string; status: AgentRunStatus; error?: string }
  | { type: 'message_chunk'; text: string }
  | { type: 'message_done' }
  | { type: 'tool_start'; id?: string; delegatedRunId?: string; name: string; input?: unknown }
  | { type: 'tool_end'; id?: string; delegatedRunId?: string; name: string; output?: unknown }
  | { type: 'tool_error'; id?: string; delegatedRunId?: string; name: string; error: string }
  | { type: 'skill_attribution'; attributions: SkillAttribution[] }
  | { type: 'approval_required'; approval: AgentApprovalRequest }
  | { type: 'approval_resolved'; approvalId: string; status: AgentApprovalStatus; resolvedAt?: number; executionStatus?: import('./agent-runtime').DelegatedToolExecutionStatus; output?: unknown; error?: string | null }
  | { type: 'approval_outcome'; approvalId: string; executionStatus: import('./agent-runtime').DelegatedToolExecutionStatus; output?: unknown; error?: string | null }
  | { type: 'runtime_error'; error: string; errorCode?: string; errorMessageKey?: string; errorMessageParams?: Record<string, string | number> }
  | { type: 'delegated_task_start'; delegatedRunId: string; taskId: string; agentSlug: string; agentName: string; goal: string }
  | { type: 'delegated_task_chunk'; delegatedRunId: string; taskId: string; text: string }
  | { type: 'delegated_task_end'; delegatedRunId: string; taskId: string; status: 'success' | 'failure'; result?: DelegatedTaskResult; errorCode?: string }
  | { type: 'delegated_task_step'; delegatedRunId: string; taskId: string; step: ExecutionStep }
  | { type: 'todos_update'; todos: TodoItem[] };

export type ConversationRunOrigin = 'background-capability-continuation' | 'workflow-resume';

export interface ConversationRunIdentity {
  sessionId: string;
  requestId: string;
  messageId: string;
  origin: ConversationRunOrigin;
}

export interface ConversationRunStreamEnvelope extends ConversationRunIdentity {
  sequence: number;
  event: LLMStreamEvent;
}

export interface ConversationRunStreamSnapshot extends ConversationRunIdentity {
  sequence: number;
  content: string;
  runId: string | null;
  agentId: string | null;
  /** Complete ordered event history for deterministic renderer hydration. */
  events: LLMStreamEvent[];
}

export type ConversationModelSourceType = 'llm_provider' | 'ai_subscription';

// llm:chat 的真实入参（handler 为真，原 src/main/llm.ts 定义迁移至此）。
export interface ChatPayload {
  projectId: string;
  sessionId: string;
  agentId?: string | null;
  message: {
    id: string;
    content: string;
    imageBase64?: string[];
  };
  overrides?: ChatRuntimeOverrides;
  resume?: {
    decisions: Array<{ type: 'approve' | 'reject'; message?: string }>;
  };
}

// llm:judge 的真实入参（handler 为真，原 src/main/llm.ts 定义迁移至此）。
export interface JudgePayload {
  projectId: string;
  agentId?: string | null;
  prompt: string;
  overrides?: ChatRuntimeOverrides;
}

export interface ChatRuntimeOverrides {
  modelSource?: ConversationModelSourceType;
  sourceId?: string;
  providerId?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  /** D-09: frontmatter `allowed-tools` whitelist. Non-empty lists are enforced
   *  at runtime by the deepagent tool-call middleware. Empty/absent means all
   *  otherwise available tools remain available. */
  allowedTools?: string[];
}
