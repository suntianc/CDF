import { z } from 'zod';

// D-03/D-10: Schema for subagent delegated task results
export const DELEGATED_TASK_RESULT_SCHEMA = z.object({
  status: z.enum(['success', 'failure']),
  artifacts: z.array(z.string()),
  summary: z.string(),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).optional(),
});
export type DelegatedTaskResult = z.infer<typeof DELEGATED_TASK_RESULT_SCHEMA>;

export type AgentRunStatus = 'running' | 'waiting_approval' | 'completed' | 'failed' | 'aborted' | 'cancelled' | 'interrupted';
export type DelegatedAgentRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
export type DelegatedAgentRunLaunchForm = 'single' | 'parallel';
export type AgentToolCallStatus = 'running' | 'success' | 'error' | 'skipped';
export type AgentApprovalStatus = 'pending' | 'approved' | 'rejected' | 'edited' | 'invalidated';
export type AgentApprovalDecisionType = 'approve' | 'reject' | 'edit';

export interface AgentRun {
  id: string;
  session_id: string;
  agent_id: string;
  request_id: string;
  status: AgentRunStatus;
  error?: string | null;
  started_at: number;
  ended_at?: number | null;
  aborted: number;
}

export interface DelegatedAgentRun {
  id: string;
  parent_run_id: string;
  target_agent_id: string | null;
  target_agent_slug: string;
  target_agent_name: string;
  launch_form: DelegatedAgentRunLaunchForm;
  task_tool_call_id: string | null;
  batch_id: string | null;
  workflow_run_task_id: string | null;
  goal: string;
  status: DelegatedAgentRunStatus;
  outcome: DelegatedTaskResult | null;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  updated_at: number;
}

export interface AgentToolCall {
  id: string;
  run_id: string;
  delegated_run_id?: string | null;
  tool_name: string;
  input?: string | null;
  output?: string | null;
  status: AgentToolCallStatus;
  error?: string | null;
  approval_status?: AgentApprovalStatus | null;
  started_at: number;
  ended_at?: number | null;
}

export interface AgentApprovalAction {
  name: string;
  args?: unknown;
  description?: string;
  allowedDecisions?: AgentApprovalDecisionType[];
}

export interface AgentApprovalRequest {
  id: string;
  runId: string;
  actions: AgentApprovalAction[];
  delegatedRunId?: string;
  targetAgentId?: string | null;
  targetAgentSlug?: string;
  targetAgentName?: string;
  delegatedTask?: string;
  actionId?: string;
}

export interface AgentApprovalHistoryEntry {
  approval: AgentApprovalRequest;
  status: AgentApprovalStatus;
  resolvedAt: number;
  executionStatus?: DelegatedToolExecutionStatus;
  output?: unknown;
  error?: string | null;
}

export type DelegatedToolApprovalDecision = 'approve' | 'reject';
export type DelegatedToolApprovalStatus =
  | 'not_required'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'invalidated';
export type DelegatedToolExecutionStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'rejected';

export interface DelegatedToolActionRecord {
  id: string;
  delegated_run_id: string;
  parent_run_id: string;
  action_id: string;
  tool_name: string;
  arguments: unknown;
  description: string | null;
  sequence: number;
  requires_approval: boolean;
  approval_status: DelegatedToolApprovalStatus;
  decision: DelegatedToolApprovalDecision | null;
  execution_status: DelegatedToolExecutionStatus;
  output: unknown;
  error: string | null;
  created_at: number;
  decided_at: number | null;
  ended_at: number | null;
  updated_at: number;
}

export interface DelegatedToolApprovalRequest {
  id: string;
  runId: string;
  delegatedRunId: string;
  targetAgentId: string | null;
  targetAgentSlug: string;
  targetAgentName: string;
  delegatedTask: string;
  action: {
    id: string;
    name: string;
    args?: unknown;
    description?: string;
  };
}

export interface AgentApprovalResolution {
  approvalId: string;
  decisions: Array<{
    type: AgentApprovalDecisionType;
    editedAction?: unknown;
    message?: string;
  }>;
}

// 全局审批模式：strict = 全量 DEFAULT_INTERRUPT_ON；agent_decides = 提示词引导；bypass = 不拦截。
export type ApprovalMode = 'strict' | 'agent_decides' | 'bypass';

export type ExecutionStepType =
  | 'task_start' | 'task_end'
  | 'thinking'
  | 'text'
  | 'text_chunk'
  | 'tool_call' | 'tool_result'
  | 'system' | 'validation';

export interface ExecutionStep {
  type: ExecutionStepType;
  ts: number;
  delegatedRunId?: string;
  label?: string;       // task_start: agent 显示名
  goal?: string;        // task_start: 任务描述（原始 description，不含附加上下文）
  summary?: string;     // task_end: worker 最终输出的简短摘要
  content?: string;     // thinking / system
  tool?: string;        // tool_call / tool_result
  args?: unknown;       // tool_call
  success?: boolean;    // tool_result / task_end
  output?: unknown;     // tool_result(成功)
  error?: string;       // tool_result(失败) / task_end(失败)
  duration_ms?: number; // tool_result
  spanId?: string;       // 当前步骤的 span 标识
  parentSpanId?: string; // 父级 span 标识
}

// agent:parallel-task-step-* 动态通道的 payload（原 parallel-task-tool.ts 定义迁移至此）。
export interface ParallelTaskStepEvent {
  batchId: string;
  delegatedRunId: string;
  agentSlug: string;
  runTaskId?: string;
  step: ExecutionStep;
}
