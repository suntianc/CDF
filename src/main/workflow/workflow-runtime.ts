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
const executionSeqs = new Map<string, number>();

function pushWorkflowEvent(executionId: string, event: WorkflowStreamEvent) {
  let seq = executionSeqs.get(executionId) || 0;
  seq++;
  executionSeqs.set(executionId, seq);
  event.seq = seq;

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

// ---- Config Snapshot (导出用) ----

const SECRET_KEY_REGEX = /api_?key|token|secret|password|bearer/i;

/**
 * 拼装工作流执行时的配置快照（agents / mcp / skills）。
 * 在 runWorkflow 启动时固化一次，避免后续 agent/mcp 变更影响历史导出一致性。
 * 严格脱敏：agents 数组不包含 provider_id / config；mcp env 中匹配密钥正则的字段被替换为 "***"。
 */
function buildConfigSnapshot(graphData: WorkflowDefinition, _projectId: string): Record<string, unknown> {
  // 1. 收集被引用的 agent_id（去重 + 过滤空值）
  const agentIds = Array.from(new Set(
    (graphData.nodes || [])
      .map((n) => n.data?.agentId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  ));

  // 2. 一次性查 agents
  const agents: Array<Record<string, unknown>> = agentIds.length > 0
    ? (db.prepare(`SELECT id, name, description, provider_id, system_prompt, config FROM agents WHERE id IN (${agentIds.map(() => '?').join(',')})`).all(...agentIds) as any[])
    : [];

  // 3. 一次性查 agent_mcp_servers 多对多
  const mcpIdsByAgent: Record<string, string[]> = {};
  const allMcpIds = new Set<string>();
  if (agentIds.length > 0) {
    const rows = db.prepare(`SELECT agent_id, mcp_server_id FROM agent_mcp_servers WHERE agent_id IN (${agentIds.map(() => '?').join(',')})`).all(...agentIds) as Array<{ agent_id: string; mcp_server_id: string }>;
    for (const r of rows) {
      (mcpIdsByAgent[r.agent_id] = mcpIdsByAgent[r.agent_id] || []).push(r.mcp_server_id);
      allMcpIds.add(r.mcp_server_id);
    }
  }

  // 4. 一次性查 mcp_servers
  const mcpServerList = allMcpIds.size > 0
    ? (db.prepare(`SELECT id, name, config FROM mcp_servers WHERE id IN (${Array.from(allMcpIds).map(() => '?').join(',')})`).all(...Array.from(allMcpIds)) as any[])
    : [];

  // 5. 一次性查 agent_skills 多对多
  const skillNamesByAgent: Record<string, string[]> = {};
  const allSkillNames = new Set<string>();
  if (agentIds.length > 0) {
    const rows = db.prepare(`SELECT agent_id, skill_name FROM agent_skills WHERE agent_id IN (${agentIds.map(() => '?').join(',')})`).all(...agentIds) as Array<{ agent_id: string; skill_name: string }>;
    for (const r of rows) {
      (skillNamesByAgent[r.agent_id] = skillNamesByAgent[r.agent_id] || []).push(r.skill_name);
      allSkillNames.add(r.skill_name);
    }
  }

  // 6. skills 当前以文件系统存储（无独立 skills 表），所以仅按 name 列出
  const skills = Array.from(allSkillNames).map((name) => ({ name, description: '' }));

  // 7. 拼装 mcp_servers 并脱敏 env
  const mcpServers = mcpServerList.map((s) => {
    let cfg: Record<string, unknown> = {};
    if (s.config) {
      try { cfg = JSON.parse(s.config); } catch { cfg = {}; }
    }
    const sanitizedEnv: Record<string, string> = {};
    const env = cfg.env;
    if (env && typeof env === 'object') {
      for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
        if (SECRET_KEY_REGEX.test(k)) {
          sanitizedEnv[k] = '***';
        } else {
          sanitizedEnv[k] = String(v);
        }
      }
    }
    return {
      id: s.id,
      name: s.name,
      command: (cfg as any).command,
      args: (cfg as any).args,
      env: sanitizedEnv,
    };
  });

  // 8. 拼装 agents（剔除 provider_id / config）
  const safeAgents = agents.map((a) => ({
    id: a.id,
    name: a.name,
    system_prompt: a.system_prompt,
    description: a.description,
    mcp_server_ids: mcpIdsByAgent[a.id as string] || [],
    skill_names: skillNamesByAgent[a.id as string] || [],
  }));

  return {
    graph_data: graphData,
    agents: safeAgents,
    mcp_servers: mcpServers,
    skills,
  };
}

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

  // 2. 拼装配置快照（导出用，固化执行时引用的 agents / mcp / skills）
  const configSnapshot = buildConfigSnapshot(graphData, projectId);

  // 3. 创建 execution 记录
  db.prepare(`
    INSERT INTO workflow_executions (id, workflow_id, project_id, trigger_source, status, input, started_at, config_snapshot)
    VALUES (?, ?, ?, ?, 'running', ?, ?, ?)
  `).run(executionId, workflowId, projectId, triggerSource, JSON.stringify(executionInput), now, JSON.stringify(configSnapshot));

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
    const nodeNames = new Map<string, string>();
    if (graphData && Array.isArray(graphData.nodes)) {
      for (const n of graphData.nodes) {
        nodeNames.set(n.id, n.data?.label || n.id);
      }
    }
    const nodeStartTimes = new Map<string, number>();
    const nodeLogsMap = new Map<string, string[]>();

    // 3. 构建图
    const builder = buildWorkflowGraph(graphData, (node, upstreamNodeIds) => {
      const executeNode = createAgentNodeExecutor(node, upstreamNodeIds);
      return async (state) => {
        nodeStartTimes.set(node.id, Date.now());
        nodeLogsMap.set(node.id, []);
        const nodeStartEvent: WorkflowStreamEvent = {
          type: 'node_start',
          executionId,
          nodeId: node.id,
          nodeName: node.data.label || node.id,
        };
        pushWorkflowEvent(executionId, nodeStartEvent);
        params.onEvent?.(nodeStartEvent);
        return executeNode(state, (logText) => {
          const logs = nodeLogsMap.get(node.id) || [];
          logs.push(logText);
          nodeLogsMap.set(node.id, logs);

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

        // CR-03: 错误路径和成功路径互斥，各自生成独立 ID
        if (errors && errors.length > 0) {
          // 错误路径：只记录失败
          allErrors.push(...errors);
          for (const err of errors) {
            const errorRunId = crypto.randomUUID();
            const nodeName = nodeNames.get(err.nodeId) || err.nodeId;
            const nodeStartTime = nodeStartTimes.get(err.nodeId) || err.timestamp || Date.now();
            const accumulatedLogs = nodeLogsMap.get(err.nodeId) || [];
            db.prepare(`
              INSERT INTO workflow_node_runs (id, execution_id, node_id, node_name, status, error, error_type, started_at, ended_at, logs)
              VALUES (?, ?, ?, ?, 'failed', ?, 'node_error', ?, ?, ?)
            `).run(errorRunId, executionId, err.nodeId, nodeName, err.error, nodeStartTime, Date.now(), JSON.stringify(accumulatedLogs));

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
          const nodeName = nodeNames.get(nodeId) || nodeId;
          const nodeStartTime = nodeStartTimes.get(nodeId) || Date.now();
          const accumulatedLogs = nodeLogsMap.get(nodeId) || [];

          db.prepare(`
            INSERT INTO workflow_node_runs (id, execution_id, node_id, node_name, status, output, started_at, ended_at, logs)
            VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?)
          `).run(successRunId, executionId, nodeId, nodeName, JSON.stringify(nodeOutputs[nodeId]), nodeStartTime, Date.now(), JSON.stringify(accumulatedLogs));

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

    const eventsForSnapshot = eventBuffers.get(executionId) || [];
    db.prepare('UPDATE workflow_executions SET events_snapshot = ? WHERE id = ?')
      .run(JSON.stringify(eventsForSnapshot), executionId);

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

    const eventsForSnapshot = eventBuffers.get(executionId) || [];
    db.prepare('UPDATE workflow_executions SET events_snapshot = ? WHERE id = ?')
      .run(JSON.stringify(eventsForSnapshot), executionId);

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
      executionSeqs.delete(executionId);
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

  // 历史执行记录：列表 / 删除 / 导出
  ipcMain.handle('workflow:listExecutions', (_, workflowId: string) => {
    return listExecutionsByWorkflow(workflowId);
  });
  ipcMain.handle('workflow:deleteExecution', (_, executionId: string) => {
    deleteExecution(executionId);
  });
  ipcMain.handle('workflow:exportExecution', async (_, executionId: string) => {
    return exportExecutionToFile(executionId);
  });
}

// 需要导入 ipcMain
import { ipcMain } from 'electron';
import { listExecutionsByWorkflow, deleteExecution, exportExecutionToFile } from './log-exporter';
