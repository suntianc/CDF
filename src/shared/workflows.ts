export interface Workflow {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  stages: WorkflowStage[];
  master_agent_id?: string;
  status: 'draft' | 'active';
  created_at: number;
  updated_at: number;
}

// IPC 保存入参：时间戳由主进程生成。
export interface WorkflowSaveInput {
  id?: string;
  project_id: string;
  name: string;
  description?: string;
  stages?: WorkflowStage[];
  master_agent_id?: string;
  status?: Workflow['status'];
}

export type WorkflowRunStatus = 'running' | 'completed' | 'failed' | 'aborted' | 'waiting_gate';

export interface WorkflowStage {
  id: string;
  name: string;
  taskDescription: string;
  acceptanceCriteria: string | string[];
  gateEnabled: boolean;
}

export interface WorkflowStageReport {
  acceptanceSelfCheck: Array<{ criterion: string; passed: boolean; notes?: string }>;
  artifacts: Array<{ path: string; description?: string }>;
  summary: string;
  tasks?: WorkflowRunTask[];
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  project_id: string;
  session_id: string;
  master_agent_id: string;
  status: WorkflowRunStatus;
  current_stage_index: number;
  total_stages: number;
  stages: string;
  skeleton_snapshot: string | null;
  error: string | null;
  started_at: number;
  ended_at: number | null;
  created_at: number;
  updated_at: number;
}

export type WorkflowTaskStatus = 'planned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowRunTask {
  id: string;
  run_id: string;
  stage_id: string;
  title: string;
  description: string;
  status: WorkflowTaskStatus;
  dependencies: string[];
  delegation_batch_id: string | null;
  /** @deprecated Delegated Agent Run identity supersedes worker identity. */
  delegation_worker_id: string | null;
  delegated_run_id?: string | null;
  delegation_agent_slug: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface WorkflowStageGate {
  id: string;
  run_id: string;
  stage_id: string;
  stage_name: string;
  report: WorkflowStageReport;
  status: 'pending' | 'approved' | 'rejected' | 'auto_approved';
  feedback: string | null;
  created_at: number;
  decided_at: number | null;
}

export interface StageGateResolution {
  decision: 'approve' | 'reject' | 'terminate';
  feedback?: string;
}

export type WorkflowRunProjectionEvent =
  | { type: 'snapshot'; run: WorkflowRun; gates: WorkflowStageGate[]; tasks: WorkflowRunTask[] }
  | { type: 'run'; runId?: string; status: WorkflowRunStatus; currentStageIndex: number; error: string | null }
  | { type: 'stage_gate'; gate: WorkflowStageGate }
  | { type: 'task'; task: WorkflowRunTask }
  | { type: 'delegation'; taskId: string; batchId: string; workerId: string; delegatedRunId?: string; agentSlug: string }
  | { type: 'replay'; events: WorkflowRunProjectionEvent[] };
