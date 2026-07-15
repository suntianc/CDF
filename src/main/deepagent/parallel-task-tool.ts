import crypto from 'node:crypto';
import { BrowserWindow } from 'electron';
import type { RunnableConfig } from '@langchain/core/runnables';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import db from '../database';
import type { DelegatedAgentRunCoordinator } from './delegated-agent-run-coordinator';
import { resolveAgentSlug } from './agent-slug';
import type { CatalogAgent } from '../agent-catalog';
import { createAgentCatalog } from '../agent-catalog';
import type {
  DelegatedAgentRun,
  DelegatedTaskResult,
  ExecutionStep,
  ParallelTaskStepEvent,
} from '../../shared/types';
import {
  getRunBySessionId,
  getCurrentStage,
  createTask,
  setTaskDelegation,
  updateTaskStatus,
  getTask,
} from '../workflow-run/db';
import { parallelTaskStepChannel } from '../../shared/ipc-contract';
import { pushProjectionEvent } from '../workflow-run/notify';

export type { ParallelTaskStepEvent } from '../../shared/types';

export function pushParallelTaskStep(sessionId: string, event: ParallelTaskStepEvent) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(parallelTaskStepChannel(sessionId), event);
    }
  }
}

interface ParallelTaskToolOptions {
  coordinator: DelegatedAgentRunCoordinator;
  createBatchId?: () => string;
}

interface ParallelTaskInput {
  name: string;
  description: string;
  input?: Record<string, unknown>;
  runTaskId?: string;
}

interface PreparedParallelTask {
  index: number;
  task: ParallelTaskInput;
  agent: CatalogAgent | null;
  runTaskId?: string;
}

interface ParallelTaskResult {
  name: string;
  agentName?: string;
  delegatedRunId?: string;
  status: 'success' | 'failure';
  output?: string;
  error?: string;
  errorCode?: string;
  outcome?: DelegatedTaskResult;
  duration_ms: number;
}

function resultFromOutcome(
  prepared: PreparedParallelTask,
  delegatedRun: DelegatedAgentRun,
  outcome: DelegatedTaskResult,
): ParallelTaskResult {
  const duration = delegatedRun.ended_at !== null
    ? delegatedRun.ended_at - (delegatedRun.started_at ?? delegatedRun.created_at)
    : 0;
  return {
    name: prepared.task.name,
    agentName: delegatedRun.target_agent_name,
    delegatedRunId: delegatedRun.id,
    status: outcome.status,
    outcome,
    ...(outcome.status === 'success'
      ? { output: outcome.summary }
      : {
          error: outcome.error?.message ?? 'Delegated Agent Run failed',
          errorCode: outcome.error?.code,
        }),
    duration_ms: Math.max(0, duration),
  };
}

function resolveWorkflowRunTaskIds(
  sessionId: string,
  tasks: ParallelTaskInput[],
): Array<string | undefined> {
  const workflowRun = getRunBySessionId(sessionId);
  if (!workflowRun) return tasks.map(() => undefined);

  const currentStage = getCurrentStage(workflowRun);
  if (!currentStage) return tasks.map(() => undefined);

  const usedRunTaskIds = new Set<string>();
  return tasks.map((task) => {
    let runTaskId = task.runTaskId;
    if (runTaskId) {
      const existing = getTask(runTaskId);
      if (
        !existing
        || existing.run_id !== workflowRun.id
        || existing.stage_id !== currentStage.id
        || usedRunTaskIds.has(runTaskId)
      ) {
        runTaskId = undefined;
      } else {
        usedRunTaskIds.add(runTaskId);
      }
    }

    if (runTaskId) return runTaskId;
    const fallback = createTask(
      workflowRun.id,
      currentStage.id,
      task.name || task.description.slice(0, 60) || 'parallel-task',
      task.description,
    );
    pushProjectionEvent({ type: 'task', task: fallback });
    return fallback.id;
  });
}

function pushTaskStep(
  sessionId: string,
  batchId: string,
  delegatedRun: DelegatedAgentRun,
  runTaskId: string | undefined,
  step: ExecutionStep,
): void {
  pushParallelTaskStep(sessionId, {
    batchId,
    delegatedRunId: delegatedRun.id,
    agentSlug: delegatedRun.target_agent_slug,
    runTaskId,
    step: { ...step, delegatedRunId: delegatedRun.id },
  });
}

export function createParallelTaskTool(
  projectId: string,
  sessionId: string,
  options: ParallelTaskToolOptions,
) {
  return tool(
    async (input, config?: RunnableConfig) => {
      const batchId = (options.createBatchId ?? crypto.randomUUID)();
      const { tasks } = input as { tasks: ParallelTaskInput[] };
      if (tasks.length === 0) {
        return JSON.stringify({ batchId, results: [] });
      }

      const parentAgentRunId = config?.configurable?.parentAgentRunId;
      if (typeof parentAgentRunId !== 'string' || !parentAgentRunId) {
        throw new Error('parallel_tasks requires parentAgentRunId');
      }

      void projectId; // Catalog delegation targets are global in #183.
      const allAgents = createAgentCatalog(db, { initializeSchema: false }).listDelegationTargets();
      const workflowRunTaskIds = resolveWorkflowRunTaskIds(sessionId, tasks);
      const prepared: PreparedParallelTask[] = tasks.map((task, index) => ({
        index,
        task,
        agent: allAgents.find((candidate) => resolveAgentSlug(candidate) === task.name) ?? null,
        runTaskId: workflowRunTaskIds[index],
      }));
      const results: Array<ParallelTaskResult | undefined> = tasks.map(() => undefined);

      const batchOutcomes = await options.coordinator.runBatch({
        parentAgentRunId,
        batchId,
        items: prepared.map(({ task, agent, runTaskId }) => {
          const targetAgentSlug = agent ? resolveAgentSlug(agent) : task.name;
          const targetAgentName = agent?.name ?? task.name;
          const taskContext = task.input
            ? `${task.description}\n\n## 附加上下文\n${JSON.stringify(task.input, null, 2)}`
            : task.description;
          let currentRun: DelegatedAgentRun | null = null;
          return {
            targetAgentId: agent?.id ?? null,
            targetAgentSlug,
            targetAgentName,
            taskToolCallId: null,
            workflowRunTaskId: runTaskId,
            goal: task.description,
            input: { messages: [{ role: 'user', content: taskContext }] },
            signal: config?.signal,
            onQueued: (run: DelegatedAgentRun) => {
              if (!runTaskId) return;
              setTaskDelegation(runTaskId, batchId, run.id, targetAgentSlug);
              pushProjectionEvent({
                type: 'delegation',
                taskId: runTaskId,
                batchId,
                delegatedRunId: run.id,
                agentSlug: targetAgentSlug,
              });
            },
            onStarted: (run: DelegatedAgentRun) => {
              currentRun = run;
              if (runTaskId) {
                const updated = updateTaskStatus(runTaskId, 'in_progress');
                if (updated) pushProjectionEvent({ type: 'task', task: updated });
              }
              pushTaskStep(sessionId, batchId, run, runTaskId, {
                type: 'task_start',
                ts: Date.now(),
                label: targetAgentName,
                goal: task.description,
              });
            },
            onStep: (step: ExecutionStep) => {
              if (currentRun) pushTaskStep(sessionId, batchId, currentRun, runTaskId, step);
            },
            onFinished: (run: DelegatedAgentRun, outcome: DelegatedTaskResult) => {
              pushTaskStep(sessionId, batchId, run, runTaskId, {
                type: 'task_end',
                ts: Date.now(),
                success: outcome.status === 'success',
                ...(outcome.status === 'success'
                  ? { summary: outcome.summary.slice(0, 300) }
                  : { error: outcome.error?.message ?? 'Delegated Agent Run failed' }),
              });
              if (runTaskId) {
                const updated = updateTaskStatus(
                  runTaskId,
                  outcome.status === 'success' ? 'completed' : 'failed',
                );
                if (updated) pushProjectionEvent({ type: 'task', task: updated });
              }
            },
          };
        }),
      });

      batchOutcomes.forEach(({ delegatedRun, outcome }, index) => {
        const item = prepared[index];
        results[item.index] = resultFromOutcome(item, delegatedRun, outcome);
      });

      return JSON.stringify({ batchId, results: results.filter(Boolean) });
    },
    {
      name: 'parallel_tasks',
      description:
        '并发调用多个子 Agent 执行独立任务。最多四个 Delegated Agent Run 同时活动，' +
        '其余任务按顺序排队；所有任务完成后返回逐项聚合结果。name 使用 Agent 的 effective_slug。' +
        '若当前处于 Workflow Run，每个任务会绑定到当前 Stage 的 Task Graph 以追踪状态。',
      schema: z.object({
        tasks: z.array(
          z.object({
            name: z.string().describe('agent effective_slug'),
            description: z.string().describe('给该 Agent 的任务描述'),
            input: z.record(z.string(), z.unknown()).optional().describe('附加上下文（可选）'),
            runTaskId: z.string().optional().describe('绑定到此现有 Workflow Run Task ID（可选）'),
          }),
        ).describe('要并发执行的任务列表'),
      }),
    },
  );
}
