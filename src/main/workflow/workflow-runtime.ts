/**
 * 工作流运行时 — 独立的工作流执行引擎
 *
 * D-16a: 独立 workflow runtime，不复用 chat runtime 的 session/checkpoint 逻辑。
 * D-17: 执行状态通过 IPC 事件流实时推送。
 * D-18: 工作流持久化采用 SQLite 存储。
 * D-20: 保留完整执行历史。
 */

import crypto from 'crypto';
import path from 'path';
import { app, BrowserWindow } from 'electron';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import db from '../database';
import { buildWorkflowGraph } from './graph-builder';
import { createAgentNodeExecutor } from './node-executor';
import type { WorkflowStreamEvent } from '../../shared/types';

// ---- Checkpoint Saver (独立 namespace，D-16a) ----

let workflowCheckpointSaver: SqliteSaver | null = null;

function getWorkflowCheckpointSaver(): SqliteSaver {
  if (!workflowCheckpointSaver) {
    workflowCheckpointSaver = SqliteSaver.fromConnString(
      path.join(app.getPath('userData'), 'workflow-checkpoints.db'),
    );
  }
  return workflowCheckpointSaver;
}

// ---- IPC Event Push (D-17) ----

function pushWorkflowEvent(executionId: string, event: WorkflowStreamEvent) {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    windows[0].webContents.send(`workflow:event-${executionId}`, event);
  }
}

// ---- DB Helpers ----

interface WorkflowRow {
  id: string;
  project_id: string;
  name: string;
  graph_data: string;
}

function getWorkflow(workflowId: string): WorkflowRow {
  const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as WorkflowRow | undefined;
  if (!row) throw new Error(`Workflow not found: ${workflowId}`);
  return row;
}

// ---- Active Executions Tracker ----

const activeExecutions = new Map<string, { aborted: boolean }>();

// ---- runWorkflow ----

export interface RunWorkflowParams {
  workflowId: string;
  projectId: string;
  triggerSource: 'editor' | 'chat' | 'schedule';
  input?: Record<string, unknown>;
  onEvent?: (event: WorkflowStreamEvent) => void;
}

/**
 * 执行工作流
 *
 * 1. 从 DB 加载 workflow 定义
 * 2. 创建 workflow_executions 记录（status='running'）
 * 3. 构建 LangGraph StateGraph
 * 4. 流式执行，通过 IPC 推送事件
 * 5. 记录 workflow_node_runs
 * 6. 完成/失败时更新 workflow_executions
 */
export async function runWorkflow(params: RunWorkflowParams): Promise<string> {
  const { workflowId, projectId, triggerSource, input = {} } = params;
  const executionId = crypto.randomUUID();
  const now = Date.now();

  // 1. 加载 workflow 定义
  const workflowRow = getWorkflow(workflowId);
  const graphData = JSON.parse(workflowRow.graph_data);

  // 2. 创建 execution 记录
  db.prepare(`
    INSERT INTO workflow_executions (id, workflow_id, project_id, trigger_source, status, input, started_at)
    VALUES (?, ?, ?, ?, 'running', ?, ?)
  `).run(executionId, workflowId, projectId, triggerSource, JSON.stringify(input), now);

  // 推送 workflow_start 事件
  const startEvent: WorkflowStreamEvent = {
    type: 'workflow_start',
    executionId,
    workflowId,
  };
  pushWorkflowEvent(executionId, startEvent);
  params.onEvent?.(startEvent);

  // 标记为活跃执行
  activeExecutions.set(executionId, { aborted: false });

  try {
    // 3. 构建图
    const builder = buildWorkflowGraph(graphData, (node) => createAgentNodeExecutor(node));

    // 4. 编译图（使用独立 checkpointer — D-16a）
    const checkpointer = getWorkflowCheckpointSaver();
    const graph = builder.compile({ checkpointer });

    // 5. 流式执行
    const threadId = `workflow-${executionId}`;
    const stream = await graph.stream(
      { inputs: input, messages: [] },
      {
        configurable: { thread_id: threadId },
        streamMode: 'updates',
      },
    );

    const allNodeOutputs: Record<string, unknown> = {};
    const allErrors: Array<{ nodeId: string; error: string; timestamp: number }> = [];

    for await (const chunk of stream) {
      // 检查是否被中止
      if (activeExecutions.get(executionId)?.aborted) {
        break;
      }

      // chunk 格式: { [nodeId]: stateUpdate }
      for (const [nodeId, stateUpdate] of Object.entries(chunk)) {
        const update = stateUpdate as Record<string, unknown>;

        // 推送 node_start 事件
        const nodeStartEvent: WorkflowStreamEvent = {
          type: 'node_start',
          executionId,
          nodeId,
          nodeName: nodeId,
        };
        pushWorkflowEvent(executionId, nodeStartEvent);
        params.onEvent?.(nodeStartEvent);

        // 记录 node run
        const nodeRunId = crypto.randomUUID();
        const nodeOutputs = update.nodeOutputs as Record<string, unknown> | undefined;
        const errors = update.errors as Array<{ nodeId: string; error: string; timestamp: number }> | undefined;

        if (nodeOutputs?.[nodeId]) {
          allNodeOutputs[nodeId] = nodeOutputs[nodeId];

          // 记录成功
          db.prepare(`
            INSERT INTO workflow_node_runs (id, execution_id, node_id, node_name, status, output, started_at, ended_at)
            VALUES (?, ?, ?, ?, 'completed', ?, ?, ?)
          `).run(nodeRunId, executionId, nodeId, nodeId, JSON.stringify(nodeOutputs[nodeId]), now, Date.now());

          const nodeEndEvent: WorkflowStreamEvent = {
            type: 'node_end',
            executionId,
            nodeId,
            duration_ms: Date.now() - now,
            outputKeys: Object.keys(nodeOutputs[nodeId] as object),
          };
          pushWorkflowEvent(executionId, nodeEndEvent);
          params.onEvent?.(nodeEndEvent);
        }

        if (errors) {
          allErrors.push(...errors);
          for (const err of errors) {
            // 记录失败
            db.prepare(`
              INSERT INTO workflow_node_runs (id, execution_id, node_id, node_name, status, error, error_type, started_at, ended_at)
              VALUES (?, ?, ?, ?, 'failed', ?, 'node_error', ?, ?)
            `).run(nodeRunId, executionId, err.nodeId, err.nodeId, err.error, err.timestamp, Date.now());

            const nodeErrorEvent: WorkflowStreamEvent = {
              type: 'node_error',
              executionId,
              nodeId: err.nodeId,
              errorType: 'node_error',
              errorMessage: err.error,
              retryCount: 0,
            };
            pushWorkflowEvent(executionId, nodeErrorEvent);
            params.onEvent?.(nodeErrorEvent);
          }
        }
      }
    }

    // 6. 完成
    const finalStatus = activeExecutions.get(executionId)?.aborted ? 'stopped' : 'completed';
    const endTime = Date.now();

    db.prepare(`
      UPDATE workflow_executions SET status = ?, output = ?, ended_at = ? WHERE id = ?
    `).run(finalStatus, JSON.stringify(allNodeOutputs), endTime, executionId);

    const endEvent: WorkflowStreamEvent = {
      type: 'workflow_end',
      executionId,
      status: finalStatus,
      duration_ms: endTime - now,
    };
    pushWorkflowEvent(executionId, endEvent);
    params.onEvent?.(endEvent);

    return executionId;
  } catch (err) {
    // 失败
    const endTime = Date.now();
    const errorMessage = err instanceof Error ? err.message : String(err);

    db.prepare(`
      UPDATE workflow_executions SET status = 'failed', error = ?, ended_at = ? WHERE id = ?
    `).run(errorMessage, endTime, executionId);

    const failEvent: WorkflowStreamEvent = {
      type: 'workflow_end',
      executionId,
      status: 'failed',
      duration_ms: endTime - now,
    };
    pushWorkflowEvent(executionId, failEvent);
    params.onEvent?.(failEvent);

    return executionId;
  } finally {
    activeExecutions.delete(executionId);
  }
}

/**
 * 停止正在执行的工作流
 */
export function stopWorkflow(executionId: string): void {
  const execution = activeExecutions.get(executionId);
  if (execution) {
    execution.aborted = true;
  }
  // 更新 DB 状态
  db.prepare(`
    UPDATE workflow_executions SET status = 'stopped', ended_at = ? WHERE id = ? AND status = 'running'
  `).run(Date.now(), executionId);
}

// ---- IPC Handler Registration ----

/**
 * 注册工作流相关的 IPC handlers
 */
export function registerWorkflowIpcHandlers(): void {
  ipcMain.handle('workflow:run', async (event, workflowId: string, projectId: string, triggerSource: string, input?: Record<string, unknown>) => {
    const executionId = await runWorkflow({
      workflowId,
      projectId,
      triggerSource: triggerSource as 'editor' | 'chat' | 'schedule',
      input,
      onEvent: (data) => {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          windows[0].webContents.send(`workflow:event-${executionId}`, data);
        }
      },
    });
    return executionId;
  });

  ipcMain.handle('workflow:stop', async (_, executionId: string) => {
    stopWorkflow(executionId);
  });
}

// 需要导入 ipcMain
import { ipcMain } from 'electron';
