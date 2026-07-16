import crypto from 'node:crypto';
import { DELEGATED_TASK_RESULT_SCHEMA } from '../../shared/types';
import type {
  DelegatedAgentRun,
  DelegatedTaskResult,
  DelegatedToolActionRecord,
  DelegatedToolApprovalDecision,
  DelegatedToolApprovalRequest,
  ExecutionStep,
} from '../../shared/types';
import { DelegatedAgentRunRepository } from './delegated-agent-run-repository';
import { classifyDelegatedRunFailure } from './delegated-run-failure';
import {
  DelegatedToolApprovalScheduler,
  type DelegatedToolActionInput,
} from './delegated-tool-approval-scheduler';
import type { DelegatedAgentConfigurationSnapshot } from './delegated-agent-configuration-snapshot';

export interface QueueSingleDelegatedRunInput {
  parentAgentRunId: string;
  targetAgentId: string | null;
  targetAgentSlug: string;
  targetAgentName: string;
  taskToolCallId: string | null;
  goal: string;
  /** Captured before persistence; kept only for this process lifetime. */
  configurationSnapshot?: DelegatedAgentConfigurationSnapshot;
}

export interface DelegatedRunProgress {
  onQueued?: (run: DelegatedAgentRun) => void;
  onStarted?: (run: DelegatedAgentRun) => void;
  onFinished?: (run: DelegatedAgentRun, outcome: DelegatedTaskResult) => void;
  onStep?: (step: ExecutionStep) => void;
}

export interface RunSingleDelegatedRunInput
  extends QueueSingleDelegatedRunInput, DelegatedRunProgress {
  delegatedRunId?: string;
  input: unknown;
  signal?: AbortSignal;
  /** Resolve current Catalog configuration only when this call creates a new run. */
  resolveConfigurationSnapshot?: () => DelegatedAgentConfigurationSnapshot;
}

export interface RunParallelDelegatedRunInput extends RunSingleDelegatedRunInput {
  batchId: string;
  workflowRunTaskId?: string | null;
}

export interface RunDelegatedBatchInput {
  parentAgentRunId: string;
  batchId: string;
  items: Array<Omit<
    RunParallelDelegatedRunInput,
    'parentAgentRunId' | 'batchId' | 'delegatedRunId'
  >>;
}

export interface DelegatedBatchOutcome {
  delegatedRun: DelegatedAgentRun;
  outcome: DelegatedTaskResult;
}

export interface DelegatedRuntimeRequest extends RunSingleDelegatedRunInput {
  delegatedRunId: string;
}

export interface DelegatedRuntimeAdapter {
  run(request: DelegatedRuntimeRequest): Promise<DelegatedTaskResult>;
}

interface DelegatedAgentRunCoordinatorOptions {
  createId?: () => string;
  now?: () => number;
  maxActiveRuns?: number;
}

interface PendingExecution {
  delegatedRunId: string;
  input: RunSingleDelegatedRunInput;
  resolve: (outcome: DelegatedTaskResult) => void;
  reject: (error: unknown) => void;
}

function structuredFailure(error: unknown): DelegatedTaskResult {
  return {
    status: 'failure',
    artifacts: [],
    summary: '',
    error: classifyDelegatedRunFailure(error),
  };
}

export class DelegatedAgentRunCoordinator {
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly maxActiveRuns: number;
  private readonly inFlight = new Map<string, Promise<DelegatedTaskResult>>();
  private readonly pending: PendingExecution[] = [];
  private readonly toolApprovals: DelegatedToolApprovalScheduler;
  private readonly configurationSnapshots = new Map<string, DelegatedAgentConfigurationSnapshot>();
  private readonly runChangeListeners = new Set<(parentRunId: string) => void>();
  private activeRuns = 0;

  constructor(
    private readonly repository: DelegatedAgentRunRepository,
    private readonly runtimeAdapter: DelegatedRuntimeAdapter,
    options: DelegatedAgentRunCoordinatorOptions = {},
  ) {
    this.createId = options.createId ?? crypto.randomUUID;
    this.now = options.now ?? Date.now;
    this.maxActiveRuns = Math.max(1, options.maxActiveRuns ?? 4);
    this.toolApprovals = new DelegatedToolApprovalScheduler(
      repository,
      repository.createToolActionRepository(),
      {
        createId: this.createId,
        now: this.now,
        onRunStatusChanged: (parentRunId) => this.notifyRunChanged(parentRunId),
      },
    );
  }

  subscribeRunChanges(listener: (parentRunId: string) => void): () => void {
    this.runChangeListeners.add(listener);
    return () => this.runChangeListeners.delete(listener);
  }

  subscribeToolApprovals(listener: (approval: DelegatedToolApprovalRequest) => void): () => void {
    return this.toolApprovals.subscribe(listener);
  }

  runToolAction<T>(input: DelegatedToolActionInput<T>) {
    return this.toolApprovals.runAction(input);
  }

  resolveToolApproval(approvalId: string, decision: DelegatedToolApprovalDecision) {
    return this.toolApprovals.resolve(approvalId, decision);
  }

  listToolApprovalHistory(delegatedRunId: string): DelegatedToolActionRecord[] {
    return this.toolApprovals.listHistory(delegatedRunId);
  }

  cancelParent(parentRunId: string, endedAt = this.now()): number {
    this.toolApprovals.cancelParent(parentRunId);
    const cancellation: DelegatedTaskResult = {
      status: 'failure', artifacts: [], summary: '',
      error: { code: 'CANCELLED', message: 'Parent Agent Run was stopped by the user' },
    };
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const pending = this.pending[index];
      const run = this.repository.get(pending.delegatedRunId);
      if (run?.parent_run_id !== parentRunId) continue;
      this.pending.splice(index, 1);
      this.inFlight.delete(pending.delegatedRunId);
      this.configurationSnapshots.delete(pending.delegatedRunId);
      pending.resolve(cancellation);
    }
    const changes = this.repository.cancelForParent(parentRunId, endedAt);
    this.notifyRunChanged(parentRunId);
    return changes;
  }

  queueSingle(input: QueueSingleDelegatedRunInput): DelegatedAgentRun {
    if (input.taskToolCallId) {
      const existing = this.repository.getByTaskToolCall(
        input.parentAgentRunId,
        input.taskToolCallId,
      );
      if (existing) return existing;
    }
    const delegatedRun = this.repository.createSingle({
      id: this.createId(),
      ...input,
      createdAt: this.now(),
    });
    if (input.configurationSnapshot) {
      this.configurationSnapshots.set(delegatedRun.id, input.configurationSnapshot);
    }
    return delegatedRun;
  }

  async runSingle(input: RunSingleDelegatedRunInput): Promise<DelegatedTaskResult> {
    const record = input.delegatedRunId
      ? this.repository.get(input.delegatedRunId)
      : input.taskToolCallId
        ? this.repository.getByTaskToolCall(input.parentAgentRunId, input.taskToolCallId)
        : null;
    let configurationSnapshot = record
      ? this.configurationSnapshots.get(record.id)
      : undefined;
    configurationSnapshot ??= input.configurationSnapshot;
    if (!configurationSnapshot && input.resolveConfigurationSnapshot) {
      configurationSnapshot = input.resolveConfigurationSnapshot();
    }

    const delegatedRun = record ?? this.queueSingle({
      ...input,
      configurationSnapshot,
    });
    if (delegatedRun.outcome) return delegatedRun.outcome;

    const existingExecution = this.inFlight.get(delegatedRun.id);
    if (existingExecution) return existingExecution;
    if (configurationSnapshot && !this.configurationSnapshots.has(delegatedRun.id)) {
      this.configurationSnapshots.set(delegatedRun.id, configurationSnapshot);
    }

    let resolveExecution!: (outcome: DelegatedTaskResult) => void;
    let rejectExecution!: (error: unknown) => void;
    const execution = new Promise<DelegatedTaskResult>((resolve, reject) => {
      resolveExecution = resolve;
      rejectExecution = reject;
    });
    this.inFlight.set(delegatedRun.id, execution);
    this.pending.push({
      delegatedRunId: delegatedRun.id,
      input: {
        ...input,
        delegatedRunId: delegatedRun.id,
        configurationSnapshot: this.configurationSnapshots.get(delegatedRun.id),
      },
      resolve: resolveExecution,
      reject: rejectExecution,
    });
    this.promoteQueuedRuns();
    return execution;
  }

  async runBatch(input: RunDelegatedBatchInput): Promise<DelegatedBatchOutcome[]> {
    const queued = input.items.map((item) => this.repository.createParallel({
      id: this.createId(),
      ...item,
      parentAgentRunId: input.parentAgentRunId,
      batchId: input.batchId,
      createdAt: this.now(),
    }));
    queued.forEach((delegatedRun, index) => {
      try {
        input.items[index].onQueued?.(delegatedRun);
      } catch {
        // Projection observers cannot change the execution outcome.
      }
    });

    return Promise.all(queued.map(async (delegatedRun, index) => {
      const item = input.items[index];
      if (item.configurationSnapshot) {
        this.configurationSnapshots.set(delegatedRun.id, item.configurationSnapshot);
      }
      const outcome = await this.runSingle({
        ...item,
        parentAgentRunId: input.parentAgentRunId,
        delegatedRunId: delegatedRun.id,
      });
      return {
        delegatedRun: this.repository.get(delegatedRun.id) ?? delegatedRun,
        outcome,
      };
    }));
  }

  private promoteQueuedRuns(): void {
    while (this.activeRuns < this.maxActiveRuns && this.pending.length > 0) {
      const next = this.pending.shift();
      if (!next) return;
      this.activeRuns += 1;
      void this.executeSingle(next.delegatedRunId, next.input)
        .then(next.resolve, next.reject)
        .finally(() => {
          this.activeRuns -= 1;
          this.inFlight.delete(next.delegatedRunId);
          this.configurationSnapshots.delete(next.delegatedRunId);
          this.promoteQueuedRuns();
        });
    }
  }

  private async executeSingle(
    delegatedRunId: string,
    input: RunSingleDelegatedRunInput,
  ): Promise<DelegatedTaskResult> {
    const running = this.repository.markRunning(delegatedRunId, this.now());
    this.notifyRunChanged(running.parent_run_id);
    try {
      input.onStarted?.(running);
    } catch {
      // Projection observers cannot change the execution outcome.
    }

    let outcome: DelegatedTaskResult;
    try {
      const rawOutcome = await this.runtimeAdapter.run({
        ...input,
        delegatedRunId,
      });
      const parsed = DELEGATED_TASK_RESULT_SCHEMA.safeParse(rawOutcome);
      outcome = parsed.success
        ? parsed.data
        : structuredFailure(new Error(`Invalid delegated runtime outcome: ${parsed.error.message}`));
    } catch (error) {
      outcome = structuredFailure(error);
    }

    const finished = this.repository.finish(
      delegatedRunId,
      outcome.status === 'success' ? 'completed' : 'failed',
      outcome,
      this.now(),
    );
    this.notifyRunChanged(finished.parent_run_id);
    try {
      input.onFinished?.(finished, outcome);
    } catch {
      // Projection observers cannot change the durable execution outcome.
    }
    return outcome;
  }

  reconcileInterrupted(endedAt = this.now()): number {
    return this.repository.reconcileInterrupted(endedAt);
  }

  private notifyRunChanged(parentRunId: string): void {
    for (const listener of this.runChangeListeners) {
      try {
        listener(parentRunId);
      } catch {
        // Projection observers cannot change the durable run lifecycle.
      }
    }
  }
}
