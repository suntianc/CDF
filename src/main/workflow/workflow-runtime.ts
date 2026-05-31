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
import type { WorkflowDefinition, WorkflowStreamEvent } from '../../shared/types';

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

const eventBuffers = new Map<string, WorkflowStreamEvent[]>();

function pushWorkflowEvent(executionId: string, event: WorkflowStreamEvent) {
  const buffer = eventBuffers.get(executionId);
  if (buffer) {
    buffer.push(event);
  }
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send(`workflow:event-${executionId}`, event);
    }
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

function enrichWorkflowInput(input: Record<string, unknown>, graphData: WorkflowDefinition): Record<string, unknown> {
  const startNode = graphData.nodes?.find((node) => node.type === 'start');
  if (!startNode) return input;

  const workspace = startNode.data.workspace?.trim();
  const workArea = startNode.data.workArea?.trim();
  if (!workspace && !workArea) return input;

  return {
    ...input,
    workflowStart: {
      nodeId: startNode.id,
      label: startNode.data.label,
      ...(workspace ? { workspace } : {}),
      ...(workArea ? { workArea } : {}),
    },
  };
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

  // 初始化事件缓冲区
  eventBuffers.set(executionId, []);

  // 1. 加载 workflow 定义
  const workflowRow = getWorkflow(workflowId);
  const graphData = JSON.parse(workflowRow.graph_data) as WorkflowDefinition;
  const executionInput = enrichWorkflowInput(input, graphData);

  // 2. 创建 execution 记录
  db.prepare(`
    INSERT INTO workflow_executions (id, workflow_id, project_id, trigger_source, status, input, started_at)
    VALUES (?, ?, ?, ?, 'running', ?, ?)
  `).run(executionId, workflowId, projectId, triggerSource, JSON.stringify(executionInput), now);

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

  void (async () => {
  try {
    // 3. 构建图
    const builder = buildWorkflowGraph(graphData, (node, upstreamNodeIds) => {
      const executeNode = createAgentNodeExecutor(node, upstreamNodeIds);
      return async (state) => {
        const nodeStartEvent: WorkflowStreamEvent = {
          type: 'node_start',
          executionId,
          nodeId: node.id,
          nodeName: node.data.label || node.id,
        };
        pushWorkflowEvent(executionId, nodeStartEvent);
        params.onEvent?.(nodeStartEvent);
        return executeNode(state, (logText) => {
          const logEvent: WorkflowStreamEvent = {
            type: 'node_log',
            executionId,
            nodeId: node.id,
            log: logText,
          };
          pushWorkflowEvent(executionId, logEvent);
          params.onEvent?.(logEvent);
        });
      };
    });

    // 4. 编译图（使用独立 checkpointer — D-16a）
    const checkpointer = getWorkflowCheckpointSaver();
    const graph = builder.compile({ checkpointer });

    // 5. 流式执行
    const threadId = `workflow-${executionId}`;
    const stream = await graph.stream(
      { inputs: executionInput, messages: [] },
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
        const nodeOutputs = update.nodeOutputs as Record<string, unknown> | undefined;
        const errors = update.errors as Array<{ nodeId: string; error: string; timestamp: number }> | undefined;
        const nodeStartTime = Date.now();

        // CR-03: 错误路径和成功路径互斥，各自生成独立 ID
        if (errors && errors.length > 0) {
          // 错误路径：只记录失败
          allErrors.push(...errors);
          for (const err of errors) {
            const errorRunId = crypto.randomUUID();
            db.prepare(`
              INSERT INTO workflow_node_runs (id, execution_id, node_id, node_name, status, error, error_type, started_at, ended_at)
              VALUES (?, ?, ?, ?, 'failed', ?, 'node_error', ?, ?)
            `).run(errorRunId, executionId, err.nodeId, err.nodeId, err.error, err.timestamp, Date.now());

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
        } else if (nodeOutputs?.[nodeId]) {
          // 成功路径：只记录成功
          allNodeOutputs[nodeId] = nodeOutputs[nodeId];
          const successRunId = crypto.randomUUID();

          db.prepare(`
            INSERT INTO workflow_node_runs (id, execution_id, node_id, node_name, status, output, started_at, ended_at)
            VALUES (?, ?, ?, ?, 'completed', ?, ?, ?)
          `).run(successRunId, executionId, nodeId, nodeId, JSON.stringify(nodeOutputs[nodeId]), nodeStartTime, Date.now());

          const nodeEndEvent: WorkflowStreamEvent = {
            type: 'node_end',
            executionId,
            nodeId,
            duration_ms: Date.now() - nodeStartTime,
            outputKeys: Object.keys(nodeOutputs[nodeId] as object),
          };
          pushWorkflowEvent(executionId, nodeEndEvent);
          params.onEvent?.(nodeEndEvent);
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

  } finally {
    activeExecutions.delete(executionId);
    // 延迟 30 秒清除缓冲区，留足时间给前端查询/重连获取历史事件
    setTimeout(() => {
      eventBuffers.delete(executionId);
    }, 30000);
  }
  })();

  return executionId;
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
  ipcMain.handle('workflow:run', async (_, workflowId: string, projectId: string, triggerSource: string, input?: Record<string, unknown>) => {
    const executionId = await runWorkflow({
      workflowId,
      projectId,
      triggerSource: triggerSource as 'editor' | 'chat' | 'schedule',
      input,
    });
    return executionId;
  });

  ipcMain.handle('workflow:stop', async (_, executionId: string) => {
    stopWorkflow(executionId);
  });

  ipcMain.handle('workflow:getEvents', (_, executionId: string) => {
    return eventBuffers.get(executionId) || [];
  });
}

// 需要导入 ipcMain
import { ipcMain } from 'electron';
