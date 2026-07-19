import crypto from 'node:crypto';
import { ToolMessage } from '@langchain/core/messages';
import type {
  DelegatedToolActionRecord,
  DelegatedToolApprovalDecision,
  DelegatedToolApprovalRequest,
} from '../../shared/types';
import { DelegatedAgentRunRepository } from './delegated-agent-run-repository';
import { DelegatedToolActionRepository } from './delegated-tool-action-repository';

export interface DelegatedToolActionInput<T> {
  delegatedRunId: string;
  action: {
    id: string;
    name: string;
    args?: unknown;
    description?: string;
  };
  requiresApproval: boolean;
  execute: () => Promise<T>;
}

interface PendingToolAction<T = unknown> {
  record: DelegatedToolActionRecord;
  input: DelegatedToolActionInput<T>;
  resolve: (value: T | ToolMessage) => void;
  reject: (error: unknown) => void;
}

interface DelegatedToolApprovalSchedulerOptions {
  createId?: () => string;
  now?: () => number;
  onRunStatusChanged?: (parentRunId: string) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class DelegatedToolApprovalScheduler {
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly actions: DelegatedToolActionRepository;
  private readonly listeners = new Set<(approval: DelegatedToolApprovalRequest) => void>();
  private readonly queues = new Map<string, PendingToolAction<any>[]>();
  private readonly active = new Map<string, PendingToolAction<any>>();
  private readonly inFlight = new Map<string, Promise<any>>();
  private readonly resolutions = new Map<string, Promise<DelegatedToolActionRecord>>();
  private readonly completedResults = new Map<string, unknown>();
  private readonly sequences = new Map<string, number>();
  private readonly onRunStatusChanged?: (parentRunId: string) => void;

  constructor(
    private readonly runs: DelegatedAgentRunRepository,
    actions: DelegatedToolActionRepository,
    options: DelegatedToolApprovalSchedulerOptions = {},
  ) {
    this.actions = actions;
    this.createId = options.createId ?? crypto.randomUUID;
    this.now = options.now ?? Date.now;
    this.onRunStatusChanged = options.onRunStatusChanged;
  }

  subscribe(listener: (approval: DelegatedToolApprovalRequest) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  runAction<T>(input: DelegatedToolActionInput<T>): Promise<T | ToolMessage> {
    const key = `${input.delegatedRunId}:${input.action.id}`;
    if (this.completedResults.has(key)) {
      return Promise.resolve(this.completedResults.get(key) as T | ToolMessage);
    }
    const existingPromise = this.inFlight.get(key);
    if (existingPromise) return existingPromise as Promise<T | ToolMessage>;

    const existing = this.actions.getByAction(input.delegatedRunId, input.action.id);
    if (existing?.execution_status === 'success' || existing?.execution_status === 'rejected') {
      return Promise.resolve(existing.output as T | ToolMessage);
    }
    if (existing?.execution_status === 'error') {
      return Promise.reject(new Error(existing.error ?? `Tool action failed: ${existing.tool_name}`));
    }

    const delegatedRun = this.runs.get(input.delegatedRunId);
    if (!delegatedRun) {
      return Promise.reject(new Error(`Delegated Agent Run not found: ${input.delegatedRunId}`));
    }
    const sequence = (this.sequences.get(input.delegatedRunId)
      ?? this.actions.listForRun(input.delegatedRunId).length) + 1;
    this.sequences.set(input.delegatedRunId, sequence);
    const record = existing ?? this.actions.create({
      id: this.createId(),
      delegatedRunId: input.delegatedRunId,
      parentRunId: delegatedRun.parent_run_id,
      actionId: input.action.id,
      toolName: input.action.name,
      arguments: input.action.args,
      description: input.action.description,
      sequence,
      requiresApproval: input.requiresApproval,
      createdAt: this.now(),
    });

    if (!input.requiresApproval) {
      const promise = this.execute(record, input.execute, key);
      this.inFlight.set(key, promise);
      return promise;
    }

    let resolveAction!: (value: T | ToolMessage) => void;
    let rejectAction!: (error: unknown) => void;
    const promise = new Promise<T | ToolMessage>((resolve, reject) => {
      resolveAction = resolve;
      rejectAction = reject;
    });
    this.inFlight.set(key, promise);
    const queue = this.queues.get(input.delegatedRunId) ?? [];
    queue.push({ record, input, resolve: resolveAction, reject: rejectAction });
    this.queues.set(input.delegatedRunId, queue);
    this.pump(input.delegatedRunId);
    return promise;
  }

  resolve(approvalId: string, decision: DelegatedToolApprovalDecision): Promise<DelegatedToolActionRecord | null> {
    const existingResolution = this.resolutions.get(approvalId);
    if (existingResolution) return existingResolution;
    const active = [...this.active.values()].find((item) => item.record.id === approvalId);
    if (!active) return Promise.resolve(null);
    this.active.delete(active.record.delegated_run_id);
    const resolution = this.resolveActive(active, decision);
    this.resolutions.set(approvalId, resolution);
    void resolution.then(
      () => this.resolutions.delete(approvalId),
      () => this.resolutions.delete(approvalId),
    );
    return resolution;
  }

  listHistory(delegatedRunId: string): DelegatedToolActionRecord[] {
    return this.actions.listForRun(delegatedRunId)
      .filter((record) => record.requires_approval && record.approval_status !== 'pending');
  }

  cancelParent(parentRunId: string): void {
    const cancelled = new ToolMessage({
      content: 'Tool action cancelled because the parent Agent Run was stopped',
      tool_call_id: 'cancelled',
      name: 'cancelled',
    });
    for (const [delegatedRunId, pending] of [...this.active.entries()]) {
      if (pending.record.parent_run_id !== parentRunId) continue;
      this.active.delete(delegatedRunId);
      this.inFlight.delete(`${delegatedRunId}:${pending.record.action_id}`);
      pending.resolve(cancelled);
    }
    for (const [delegatedRunId, queue] of [...this.queues.entries()]) {
      const remaining = queue.filter((pending) => {
        if (pending.record.parent_run_id !== parentRunId) return true;
        this.inFlight.delete(`${delegatedRunId}:${pending.record.action_id}`);
        pending.resolve(cancelled);
        return false;
      });
      if (remaining.length > 0) this.queues.set(delegatedRunId, remaining);
      else this.queues.delete(delegatedRunId);
    }
    this.actions.invalidatePending(parentRunId, this.now(), 'Parent Agent Run was stopped');
  }

  private pump(delegatedRunId: string): void {
    if (this.active.has(delegatedRunId)) return;
    const queue = this.queues.get(delegatedRunId) ?? [];
    const next = queue.shift();
    if (!next) {
      this.queues.delete(delegatedRunId);
      const run = this.runs.get(delegatedRunId);
      if (run?.status === 'waiting_approval') {
        const running = this.runs.markRunningAfterApproval(delegatedRunId, this.now());
        this.onRunStatusChanged?.(running.parent_run_id);
      }
      return;
    }
    this.active.set(delegatedRunId, next);
    const run = this.runs.markWaitingApproval(delegatedRunId, this.now());
    this.onRunStatusChanged?.(run.parent_run_id);
    const approval: DelegatedToolApprovalRequest = {
      id: next.record.id,
      runId: run.parent_run_id,
      delegatedRunId: run.id,
      targetAgentId: run.target_agent_id,
      targetAgentSlug: run.target_agent_slug,
      targetAgentName: run.target_agent_name,
      delegatedTask: run.goal,
      action: next.input.action,
    };
    for (const listener of this.listeners) {
      try {
        listener(approval);
      } catch {
        // Projection observers cannot change the durable approval lifecycle.
      }
    }
  }

  private async resolveActive(
    pending: PendingToolAction,
    decision: DelegatedToolApprovalDecision,
  ): Promise<DelegatedToolActionRecord> {
    const delegatedRunId = pending.record.delegated_run_id;
    const key = `${delegatedRunId}:${pending.record.action_id}`;
    this.actions.decide(pending.record.id, decision, this.now());
    const running = this.runs.markRunningAfterApproval(delegatedRunId, this.now());
    this.onRunStatusChanged?.(running.parent_run_id);
    let finishedRecord: DelegatedToolActionRecord | null = null;
    try {
      if (decision === 'reject') {
        const rejection = new ToolMessage({
          content: `Tool action rejected by the user: ${pending.record.tool_name}`,
          tool_call_id: pending.record.action_id,
          name: pending.record.tool_name,
        });
        finishedRecord = this.actions.finish(pending.record.id, 'rejected', rejection, null, this.now());
        this.completedResults.set(key, rejection);
        pending.resolve(rejection);
      } else {
        const result = await pending.input.execute();
        finishedRecord = this.actions.finish(pending.record.id, 'success', result, null, this.now());
        this.completedResults.set(key, result);
        pending.resolve(result);
      }
    } catch (error) {
      finishedRecord = this.actions.finish(pending.record.id, 'error', null, errorMessage(error), this.now());
      pending.reject(error);
    } finally {
      this.inFlight.delete(key);
      this.pump(delegatedRunId);
    }
    return finishedRecord ?? this.actions.get(pending.record.id)!;
  }

  private async execute<T>(
    record: DelegatedToolActionRecord,
    execute: () => Promise<T>,
    key: string,
  ): Promise<T> {
    this.actions.markRunning(record.id, this.now());
    try {
      const result = await execute();
      this.actions.finish(record.id, 'success', result, null, this.now());
      this.completedResults.set(key, result);
      return result;
    } catch (error) {
      this.actions.finish(record.id, 'error', null, errorMessage(error), this.now());
      throw error;
    } finally {
      this.inFlight.delete(key);
    }
  }
}
