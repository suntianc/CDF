/**
 * tools.ts — Workflow Run 的 Master Agent 工具
 *
 * 提供 advance_stage 工具：Agent 完成当前阶段后调用，
 * 提交结构化报告并触发 Stage Gate 审批。
 * 永远加入 interruptOn（无视全局 approvalMode）。
 *
 * 注意：此工具在 deepagents 的 interruptOn 注册后，
 * 实际执行（callback）只发生在审批批准后。
 * 回调中执行 cursor 推进（主进程权威推进）。
 * 中断值检测 isAdvanceStageInterrupt 使用 deepagents 标准 actionRequests 格式。
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { WorkflowRun, WorkflowRunTask, WorkflowStageReport, WorkflowTaskStatus } from '../../shared/types';
import { advanceStageCursor, getCurrentStage, createTask, setTaskDependencies, updateTaskStatus, listRunTasks, getTask, updateRunStatus } from './db';
import { pushProjectionEvent } from './notify';

/** advance_stage 工具注入时需要的上下文 */
export interface AdvanceStageToolContext {
  runId: string;
  projectId: string;
  getRun: () => WorkflowRun | undefined;
}

export function createAdvanceStageTool(ctx: AdvanceStageToolContext) {
  return tool(
    async ({ report, routeId }: { report: WorkflowStageReport; routeId?: string; rationale?: string }) => {
      const run = ctx.getRun();
      if (!run) throw new Error('Workflow run not found');

      // 审批已通过，主进程权威推进 cursor
      const advanced = advanceStageCursor(run.id, routeId);
      if (!advanced) throw new Error('Failed to advance stage cursor');
      pushProjectionEvent({
        type: 'run',
        runId: advanced.id,
        status: advanced.status,
        currentStageId: advanced.current_stage_id,
        currentStageIndex: advanced.current_stage_index,
        error: advanced.error,
      });

      if (advanced.status === 'completed') {
        return {
          status: 'completed',
          message: '所有阶段已完成！工作流执行结束。',
        };
      }

      const nextStage = getCurrentStage(advanced);
      if (!nextStage) {
        return {
          status: 'completed',
          message: '所有阶段已完成！工作流执行结束。',
        };
      }

      return {
        status: 'stage_advanced',
        nextStageIndex: advanced.current_stage_index,
        nextStageName: nextStage.name,
        nextStageTask: nextStage.taskDescription,
        acceptanceCriteria: nextStage.acceptanceCriteria,
      };
    },
    {
      name: 'advance_stage',
      description: '提交当前阶段的验收报告并推进到下一阶段。调用前确保已完成当前阶段的所有任务并自检通过。',
      schema: z.object({
        report: z.object({
          acceptanceSelfCheck: z.array(z.object({
            criterion: z.string().describe('验收标准原文'),
            passed: z.boolean().describe('是否通过'),
            notes: z.string().describe('备注，如未通过请说明原因'),
          })),
          artifacts: z.array(z.object({
            path: z.string().describe('产物相对路径'),
            description: z.string().describe('产物说明'),
          })),
          summary: z.string().describe('本阶段工作总结'),
        }),
        routeId: z.string().optional().describe('选择的已编排 Stage Route ID；单一路由可省略'),
        rationale: z.string().optional().describe('选择该条件路由的简短理由'),
      }),
    },
  );
}

export function createStageRouteBlockerTool(ctx: AdvanceStageToolContext) {
  return tool(
    async ({ explanation }: { explanation: string }) => {
      const run = ctx.getRun();
      if (!run) throw new Error('Workflow run not found');
      updateRunStatus(run.id, 'waiting_input');
      pushProjectionEvent({
        type: 'run',
        runId: run.id,
        status: 'waiting_input',
        currentStageId: run.current_stage_id,
        currentStageIndex: run.current_stage_index,
        error: null,
      });
      return {
        status: 'waiting_input',
        explanation,
        message: 'Explain the missing information to the user and wait for their next instruction. Do not select a Stage Route yet.',
      };
    },
    {
      name: 'report_stage_route_blocker',
      description: '当信息不足、无法负责任地选择已编排 Stage Route 时，说明缺失信息并等待用户输入。不得用它绕过验收或编造默认路线。',
      schema: z.object({
        explanation: z.string().min(1).describe('面向用户的自然语言说明：缺少什么信息，以及为什么当前无法选择路线'),
      }),
    },
  );
}

/**
 * 从 deepagents 标准 interrupt value 中检测 advance_stage 中断。
 *
 * deepagents 的 interruptOn 机制会产生形如如下结构的值：
 * {
 *   actionRequests: [{ name: 'advance_stage', args: { report: {...} } }],
 *   reviewConfigs: [...]
 * }
 *
 * @returns 提取的 report 对象，或 null（如果不是 advance_stage 中断）
 */
export function isAdvanceStageInterrupt(interruptValue: unknown): { report: WorkflowStageReport; routeId?: string; rationale?: string } | { error: string } | null {
  if (!interruptValue || typeof interruptValue !== 'object') return null;
  const val = interruptValue as Record<string, unknown>;

  // 检查 deepagents 标准 actionRequests 格式
  const actionRequests = val.actionRequests;
  if (!Array.isArray(actionRequests) || actionRequests.length === 0) return null;

  const advanceActions = actionRequests.filter((candidate) => (
    candidate
    && typeof candidate === 'object'
    && (candidate as Record<string, unknown>).name === 'advance_stage'
  ));
  if (advanceActions.length === 0) return null;

  // advance_stage 必须是中断的唯一 action；位于任意位置的混合 action 都必须拒绝。
  if (actionRequests.length !== 1 || advanceActions.length !== 1) {
    return { error: 'multiple_actions: advance_stage must be the only action in the interrupt' };
  }

  const action = advanceActions[0];

  const args = (action as Record<string, unknown>).args;
  if (!args || typeof args !== 'object') return null;

  const report = (args as Record<string, unknown>).report;
  if (!report || typeof report !== 'object') return null;

  const routeId = typeof (args as Record<string, unknown>).routeId === 'string'
    ? (args as Record<string, unknown>).routeId as string
    : undefined;
  const rationale = typeof (args as Record<string, unknown>).rationale === 'string'
    ? (args as Record<string, unknown>).rationale as string
    : undefined;
  return { report: report as WorkflowStageReport, routeId, rationale };
}


// =============================================================================
// Phase 16: Task Graph 管理工具
// =============================================================================

/** 为 Workflow Session 创建 task graph 管理工具的上下文 */
export interface TaskGraphToolContext {
  runId: string;
  getRun: () => WorkflowRun | undefined;
}

/**
 * 创建任务工具 (`create_task`)：在当前 stage 规划子任务。
 * 文档要求 Agent 先规划再派单。
 */
function getActiveStageId(ctx: TaskGraphToolContext): string | null {
  const run = ctx.getRun();
  if (!run) return null;
  return run.current_stage_id || null;
}

export function createTaskGraphTools(ctx: TaskGraphToolContext) {
  return [
    tool(
      async (input) => {
        const run = ctx.getRun();
        const stageId = getActiveStageId(ctx);
        if (!run || !stageId) return JSON.stringify({ error: 'Workflow run or current Stage not found' });

        const dependencies = input.dependencies ?? [];
        for (const dependencyId of dependencies) {
          const dependency = getTask(dependencyId);
          if (
            !dependency
            || dependency.run_id !== ctx.runId
            || dependency.stage_id !== stageId
          ) {
            return JSON.stringify({ error: `Dependency ${dependencyId} does not belong to the current Workflow Run Stage` });
          }
        }

        const task = createTask(ctx.runId, stageId, input.title, input.description, dependencies);
        pushProjectionEvent({ type: 'task', task });
        return JSON.stringify({
          taskId: task.id,
          title: task.title,
          status: task.status,
          dependencies: task.dependencies,
        });
      },
      {
        name: 'create_task',
        description:
          '在当前 Workflow Stage 中创建一个子任务。必须先规划任务图（创建所有 task 并设置依赖），再使用 parallel_tasks 派单执行。' +
          '不要为每个子任务单独调此工具——先一次性规划所有任务，再一次性设置依赖，最后派单执行。',
        schema: z.object({
          title: z.string().describe('任务标题（简短唯一）'),
          description: z.string().describe('任务详细描述'),
          dependencies: z.array(z.string()).optional().describe('前驱 task id 列表'),
        }),
      },
    ),
    tool(
      async (input) => {
        const task = getTask(input.taskId);
        if (!task || task.run_id !== ctx.runId) {
          return JSON.stringify({ error: 'Task does not belong to this Workflow Run' });
        }
        const result = setTaskDependencies(input.taskId, input.dependencies ?? []);
        if ('detectCycle' in result) {
          return JSON.stringify({ error: `Cycle detected: ${result.detectCycle.join(' -> ')}` });
        }
        const updated = getTask(input.taskId);
        if (updated) pushProjectionEvent({ type: 'task', task: updated });
        return JSON.stringify({ success: true });
      },
      {
        name: 'set_task_dependencies',
        description: '设置某 task 的前驱依赖（替换式）。必须保证属于同一次 Workflow Run，不能有环。',
        schema: z.object({
          taskId: z.string().describe('目标 task id'),
          dependencies: z.array(z.string()).describe('前驱 task id 列表'),
        }),
      },
    ),
    tool(
      async (input) => {
        const task = getTask(input.taskId);
        if (!task || task.run_id !== ctx.runId) {
          return JSON.stringify({ error: 'Task does not belong to this Workflow Run' });
        }
        const validStatuses: WorkflowTaskStatus[] = ['planned', 'in_progress', 'completed', 'failed', 'cancelled'];
        if (!validStatuses.includes(input.status as WorkflowTaskStatus)) {
          return JSON.stringify({ error: `Invalid status: ${input.status}` });
        }
        const updated = updateTaskStatus(input.taskId, input.status as WorkflowTaskStatus);
        if (!updated) return JSON.stringify({ error: 'Task not found' });
        pushProjectionEvent({ type: 'task', task: updated });
        return JSON.stringify({ taskId: updated.id, status: updated.status });
      },
      {
        name: 'update_task_status',
        description: '更新 task 状态。仅限 planned | in_progress | completed | failed | cancelled。',
        schema: z.object({
          taskId: z.string().describe('目标 task id'),
          status: z.string().describe('新状态'),
        }),
      },
    ),
    tool(
      async (_input) => {
        const stageId = getActiveStageId(ctx);
        if (!ctx.getRun() || !stageId) return JSON.stringify({ error: 'Workflow run or current Stage not found' });
        const tasks = listRunTasks(ctx.runId, stageId);
        return JSON.stringify(tasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          dependencies: t.dependencies,
          agent: t.delegation_agent_slug,
        })));
      },
      {
        name: 'list_tasks',
        description: '列出当前 Stage 的全部子任务及其状态。',
        schema: z.object({}),
      },
    ),
  ];
}
