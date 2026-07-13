import crypto from 'node:crypto';
import { DELEGATED_TASK_RESULT_SCHEMA } from '../../shared/types';
import type { DelegatedAgentRun, DelegatedTaskResult } from '../../shared/types';
import { DelegatedAgentRunRepository } from './delegated-agent-run-repository';
import { classifyDelegatedRunFailure } from './delegated-run-failure';

export interface QueueSingleDelegatedRunInput {
  parentAgentRunId: string;
  targetAgentId: string;
  targetAgentSlug: string;
  targetAgentName: string;
  taskToolCallId: string | null;
  goal: string;
}

export interface RunSingleDelegatedRunInput extends QueueSingleDelegatedRunInput {
  delegatedRunId?: string;
  input: unknown;
  signal?: AbortSignal;
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
  private readonly inFlight = new Map<string, Promise<DelegatedTaskResult>>();

  constructor(
    private readonly repository: DelegatedAgentRunRepository,
    private readonly runtimeAdapter: DelegatedRuntimeAdapter,
    options: DelegatedAgentRunCoordinatorOptions = {},
  ) {
    this.createId = options.createId ?? crypto.randomUUID;
    this.now = options.now ?? Date.now;
  }

  queueSingle(input: QueueSingleDelegatedRunInput): DelegatedAgentRun {
    if (input.taskToolCallId) {
      const existing = this.repository.getByTaskToolCall(
        input.parentAgentRunId,
        input.taskToolCallId,
      );
      if (existing) return existing;
    }
    return this.repository.createSingle({
      id: this.createId(),
      ...input,
      createdAt: this.now(),
    });
  }

  async runSingle(input: RunSingleDelegatedRunInput): Promise<DelegatedTaskResult> {
    const record = input.delegatedRunId
      ? this.repository.get(input.delegatedRunId)
      : input.taskToolCallId
        ? this.repository.getByTaskToolCall(input.parentAgentRunId, input.taskToolCallId)
        : null;
    const delegatedRun = record ?? this.queueSingle(input);
    if (delegatedRun.outcome) return delegatedRun.outcome;

    const existingExecution = this.inFlight.get(delegatedRun.id);
    if (existingExecution) return existingExecution;

    const execution = this.executeSingle(delegatedRun.id, input)
      .finally(() => this.inFlight.delete(delegatedRun.id));
    this.inFlight.set(delegatedRun.id, execution);
    return execution;
  }

  private async executeSingle(
    delegatedRunId: string,
    input: RunSingleDelegatedRunInput,
  ): Promise<DelegatedTaskResult> {
    this.repository.markRunning(delegatedRunId, this.now());

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

    this.repository.finish(
      delegatedRunId,
      outcome.status === 'success' ? 'completed' : 'failed',
      outcome,
      this.now(),
    );
    return outcome;
  }

  reconcileInterrupted(endedAt = this.now()): number {
    return this.repository.reconcileInterrupted(endedAt);
  }
}
