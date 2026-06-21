/**
 * 工作流工具 — Master Agent 可调用的工作流操作工具
 *
 * D-16c: Master Agent 可通过 Chat 触发工作流执行。
 * 提供 3 个 LangChain tool：list_workflows, run_workflow, get_workflow_status。
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import db from '../database';
import { runWorkflow, waitForWorkflowCompletion } from './workflow-runtime';

/**
 * 创建工作流工具集
 *
 * @param projectId - 当前项目 ID
 * @returns 3 个 LangChain tool 实例
 */
export function createWorkflowTools(projectId: string) {
  return [
    tool(
      async () => {
        // 仅对 Agent 暴露已启用 (active) 的工作流；草稿/未启用 (draft) 工作流视为不存在。
        const workflows = db.prepare(
          "SELECT id, name, description, status FROM workflows WHERE project_id = ? AND status = 'active' ORDER BY updated_at DESC",
        ).all(projectId);
        return JSON.stringify(workflows);
      },
      {
        name: 'list_workflows',
        description: '列出当前项目中已启用的工作流。返回工作流 ID、名称、描述和状态。仅包含 status 为 active 的工作流。',
        schema: z.object({}),
      },
    ),

    tool(
      async ({ workflowId, input, timeout_ms }: { workflowId: string; input?: Record<string, unknown>; timeout_ms?: number }) => {
        const executionId = await runWorkflow({
          workflowId,
          projectId,
          triggerSource: 'chat',
          input: input ?? {},
        });

        const completionPromise = waitForWorkflowCompletion(executionId);
        let result: { status: string; output?: unknown; error?: string };

        if (timeout_ms && timeout_ms > 0) {
          const timeoutResult = await Promise.race([
            completionPromise,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout_ms)),
          ]);
          if (timeoutResult === null) {
            return JSON.stringify({
              executionId,
              status: 'running',
              message: `工作流仍在执行中（已等待 ${Math.round(timeout_ms / 1000)}s）。使用 get_workflow_status 查询最终结果。`,
            });
          }
          result = timeoutResult;
        } else {
          result = await completionPromise;
        }

        const nodeRuns = db.prepare(
          'SELECT node_id, node_name, status, error, output FROM workflow_node_runs WHERE execution_id = ? ORDER BY started_at ASC',
        ).all(executionId) as Array<{ node_id: string; node_name: string; status: string; error?: string; output?: string }>;
        return JSON.stringify({ executionId, ...result, nodeRuns });
      },
      {
        name: 'run_workflow',
        description: '执行指定的工作流。默认等待完成后返回结果。可通过 timeout_ms 设置最长等待时间：超时后返回 running 状态和 executionId，之后用 get_workflow_status 查询结果。对于耗时较长的工作流，建议设置合理的 timeout_ms（如 60000 = 1分钟）。',
        schema: z.object({
          workflowId: z.string().describe('要执行的工作流 ID'),
          input: z.record(z.string(), z.unknown()).optional().describe('可选的输入参数'),
          timeout_ms: z.number().optional().describe('最长等待时间（毫秒）。不传则等待至完成。建议复杂工作流设置 60000-300000'),
        }),
      },
    ),

    tool(
      async ({ executionId }: { executionId: string }) => {
        const execution = db.prepare(
          'SELECT id, workflow_id, status, error, started_at, ended_at FROM workflow_executions WHERE id = ?',
        ).get(executionId);
        if (!execution) {
          return JSON.stringify({ error: 'Execution not found' });
        }
        // 同时获取节点运行状态
        const nodeRuns = db.prepare(
          'SELECT node_id, node_name, status, error, started_at, ended_at FROM workflow_node_runs WHERE execution_id = ? ORDER BY started_at ASC',
        ).all(executionId);
        return JSON.stringify({ ...execution as object, nodeRuns });
      },
      {
        name: 'get_workflow_status',
        description: '查询工作流执行状态。返回执行详情和各节点运行状态。',
        schema: z.object({
          executionId: z.string().describe('要查询的执行 ID'),
        }),
      },
    ),
  ];
}
