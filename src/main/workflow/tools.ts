/**
 * 工作流工具 — Master Agent 可调用的工作流操作工具
 *
 * D-16c: Master Agent 可通过 Chat 触发工作流执行。
 * 提供 3 个 LangChain tool：list_workflows, run_workflow, get_workflow_status。
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import db from '../database';
import { runWorkflow } from './workflow-runtime';

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
        const workflows = db.prepare(
          'SELECT id, name, description, status FROM workflows WHERE project_id = ? ORDER BY updated_at DESC',
        ).all(projectId);
        return JSON.stringify(workflows);
      },
      {
        name: 'list_workflows',
        description: '列出当前项目中所有可用的工作流。返回工作流 ID、名称、描述和状态。',
        schema: z.object({}),
      },
    ),

    tool(
      async ({ workflowId, input }: { workflowId: string; input?: Record<string, unknown> }) => {
        const executionId = await runWorkflow({
          workflowId,
          projectId,
          triggerSource: 'chat',
          input: input ?? {},
        });
        return JSON.stringify({ executionId, status: 'started' });
      },
      {
        name: 'run_workflow',
        description: '执行指定的工作流。返回执行 ID。可通过 get_workflow_status 查询执行状态。',
        schema: z.object({
          workflowId: z.string().describe('要执行的工作流 ID'),
          input: z.record(z.string(), z.unknown()).optional().describe('可选的输入参数'),
        }),
      },
    ),

    tool(
      async ({ executionId }: { executionId: string }) => {
        const execution = db.prepare(
          'SELECT id, workflow_id, status, input, output, error, started_at, ended_at FROM workflow_executions WHERE id = ?',
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
