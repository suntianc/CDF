/**
 * 工作流执行记录导出 / 列表 / 删除
 *
 * 职责单一:读取单次执行的完整数据,过滤 provider 信息并脱敏 MCP env,组装导出 JSON。
 * 优先使用 config_snapshot（runWorkflow 启动时已固化）;为 null 时 fallback 到即时拼装。
 */

import fs from 'fs';
import { dialog, BrowserWindow } from 'electron';
import db from '../database';

const SECRET_KEY_REGEX = /api_?key|token|secret|password|bearer/i;
const SECRET_VALUE_PLACEHOLDER = '***';
const SCHEMA_VERSION = '1.1';
const LIST_LIMIT = 50;

export interface ExportExecutionResult {
  saved: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

/**
 * 脱敏 MCP env 中匹配密钥正则的字段,生成可直接写入快照的安全副本。
 */
function sanitizeMcpEnv(env: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!env || typeof env !== 'object') return out;
  for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
    if (SECRET_KEY_REGEX.test(k)) {
      out[k] = SECRET_VALUE_PLACEHOLDER;
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

/**
 * 节点字段白名单 — 与前端 NodeConfigDrawer 实际渲染的字段一一对齐。
 *
 * 设计原则:
 * - 在白名单内的字段:即使当前值是空串/0/默认值,也保留 — 显式表达"该字段属于该节点类型"
 * - 不在白名单的字段:即使有值也不导出 — 避免遗留垃圾或历史 schema 字段
 * - 未知节点类型:保守保留全部 data(不裁剪)
 */
const NODE_FIELD_WHITELIST: Record<string, string[]> = {
  start:   ['label', 'workspace', 'taskGoal'],
  end:     ['label'],
  task:    ['label', 'nodeKind', 'taskDescription', 'agentId', 'failureStrategy', 'retryCount', 'temperature'],
  agent:   ['label', 'nodeKind', 'taskDescription', 'agentId', 'failureStrategy', 'retryCount', 'temperature'],
  loop:    ['label', 'nodeKind', 'taskDescription', 'loopCount', 'agentId', 'failureStrategy', 'retryCount', 'temperature'],
  foreach: ['label', 'nodeKind', 'taskDescription', 'dataSource', 'itemPrompt', 'agentId', 'failureStrategy', 'retryCount', 'temperature'],
  review:  ['label', 'nodeKind', 'reviewSpec', 'reviewRules', 'agentId', 'failureStrategy', 'retryCount', 'temperature'],
};

/**
 * 按节点类型白名单裁剪 data 字段。
 */
function projectNodeData(nodeType: string, data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object') return {};
  const whitelist = NODE_FIELD_WHITELIST[nodeType];
  if (!whitelist) return data as Record<string, unknown>;
  const src = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of whitelist) {
    if (k in src) out[k] = src[k];
  }
  return out;
}

/**
 * 递归剔除空值:null / undefined / 空字符串 / 空数组 / 空对象。
 * 保留:false / 0 / 非空值(布尔 false 和数字 0 是有意义的语义值)。
 * 数组:对每个元素递归 prune,但保留所有元素位置(不剔除变空的对象项),
 *      避免改变 events / nodes 等列表的长度语义。
 */
function pruneEmpty(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(pruneEmpty);
  }
  if (obj !== null && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const pv = pruneEmpty(v);
      if (pv === null || pv === undefined) continue;
      if (typeof pv === 'string' && pv === '') continue;
      if (Array.isArray(pv) && pv.length === 0) continue;
      if (
        typeof pv === 'object' &&
        !Array.isArray(pv) &&
        Object.keys(pv as object).length === 0
      ) continue;
      out[k] = pv;
    }
    return out;
  }
  return obj;
}

/**
 * 读取单次执行的完整数据,过滤 provider 信息并脱敏 MCP env,组装导出 JSON。
 */
export function buildExportPayload(executionId: string): Record<string, unknown> {
  // 1. 读 workflow_executions
  const row = db.prepare('SELECT * FROM workflow_executions WHERE id = ?').get(executionId) as any;
  if (!row) throw new Error(`Execution not found: ${executionId}`);

  // 2. 读 workflow (graph_data + name)
  const workflowRow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(row.workflow_id) as any;
  if (!workflowRow) throw new Error(`Workflow not found: ${row.workflow_id}`);

  // 3. 读 node_runs（含 logs）
  const nodeRunRows = db.prepare('SELECT * FROM workflow_node_runs WHERE execution_id = ? ORDER BY started_at').all(executionId) as any[];

  // 4. 解析 workflow 部分
  const graphData = workflowRow.graph_data ? JSON.parse(workflowRow.graph_data) : null;
  const configSnapshot = row.config_snapshot ? JSON.parse(row.config_snapshot) : null;

  // 5. 强制过滤:agents 数组中剔除 provider_id / config
  const safeAgents = (configSnapshot?.agents || []).map((a: any) => {
    const { provider_id, config, ...rest } = a;
    return rest;
  });

  // 6. 二次校验:mcp env 脱敏（config_snapshot 在 runWorkflow 阶段已经脱敏过,这里再次防御）
  const safeMcpServers = (configSnapshot?.mcp_servers || []).map((s: any) => ({
    id: s.id,
    name: s.name,
    command: s.command,
    args: s.args,
    env: sanitizeMcpEnv(s.env),
  }));

  // 7. 解析 events 并剔除冗余引用字段(executionId/workflowId 已在 outer 字段)
  //    并剔除 node_log 类型(其 step 内容与 node_runs[].execution_trace 100% 同义)
  const rawEvents = row.events_snapshot ? JSON.parse(row.events_snapshot) : [];
  const events = Array.isArray(rawEvents)
    ? rawEvents
        .map(({ executionId, workflowId, ...rest }: any) => rest)
        .filter((e: any) => e?.type !== 'node_log')
    : [];

  // 8. graph_data 节点裁剪:按前端 NodeConfigDrawer 字段白名单 + 剔除 position(画布坐标对复盘无价值)
  const rawGraphData = configSnapshot?.graph_data || graphData;
  const slimGraphData = rawGraphData && Array.isArray(rawGraphData.nodes)
    ? {
        ...rawGraphData,
        nodes: rawGraphData.nodes.map((n: any) => ({
          id: n.id,
          type: n.type,
          data: projectNodeData(n.type, n.data),
        })),
      }
    : rawGraphData;

  // workflow 顶层其它字段走 pruneEmpty 清理空 agents/mcp_servers/skills;
  // graph_data 不经过 pruneEmpty(白名单已确定字段,即使是空字符串也要保留,显式表达"属于该节点类型")
  const restWorkflow = pruneEmpty({
    id: workflowRow.id,
    name: workflowRow.name,
    agents: safeAgents,
    mcp_servers: safeMcpServers,
    skills: configSnapshot?.skills || [],
  }) as Record<string, unknown>;

  return {
    schema_version: SCHEMA_VERSION,
    exported_at: Date.now(),
    workflow: {
      ...restWorkflow,
      graph_data: slimGraphData,
    },
    execution: {
      id: row.id,
      status: row.status,
      started_at: row.started_at,
      ended_at: row.ended_at,
      duration_ms: row.ended_at && row.started_at ? row.ended_at - row.started_at : null,
      input: row.input ? JSON.parse(row.input) : {},
      output: row.output ? JSON.parse(row.output) : undefined,
      error: row.error || undefined,
      node_runs: nodeRunRows.map((r) => ({
        node_id: r.node_id,
        node_name: r.node_name,
        status: r.status,
        input: r.input ? JSON.parse(r.input) : undefined,
        output: r.output ? JSON.parse(r.output) : undefined,
        error: r.error || undefined,
        // retry_count 仅在 > 0 时输出(默认 0 无意义)
        ...(r.retry_count && r.retry_count > 0 ? { retry_count: r.retry_count } : {}),
        started_at: r.started_at,
        ended_at: r.ended_at,
        execution_trace: r.execution_trace ? JSON.parse(r.execution_trace) : [],
        // 老数据(无 execution_trace 列值时)回退输出 logs;新数据(有 execution_trace)只输出 execution_trace
        ...(r.execution_trace
          ? {}
          : {
              logs: r.logs ? JSON.parse(r.logs) : [],
            }),
      })),
      events,
    },
  };
}

/**
 * 弹保存对话框,导出 JSON 文件
 */
export async function exportExecutionToFile(executionId: string): Promise<ExportExecutionResult> {
  try {
    const payload = buildExportPayload(executionId);
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const result = await dialog.showSaveDialog(win!, {
      title: '导出工作流执行记录',
      defaultPath: `workflow-execution-${executionId.slice(0, 8)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) {
      return { saved: false, canceled: true };
    }
    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8');
    return { saved: true, path: result.filePath };
  } catch (err) {
    return { saved: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 列出某工作流的执行记录,按 started_at 倒序
 */
export function listExecutionsByWorkflow(workflowId: string): any[] {
  const rows = db.prepare(`
    SELECT * FROM workflow_executions
    WHERE workflow_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(workflowId, LIST_LIMIT) as any[];
  return rows.map((r) => ({
    ...r,
    input: r.input ? JSON.parse(r.input) : {},
    output: r.output ? JSON.parse(r.output) : undefined,
  }));
}

/**
 * 删除单次执行(级联删除 node_runs),单事务
 */
export function deleteExecution(executionId: string): void {
  const txn = db.transaction((id: string) => {
    db.prepare('DELETE FROM workflow_node_runs WHERE execution_id = ?').run(id);
    db.prepare('DELETE FROM workflow_executions WHERE id = ?').run(id);
  });
  txn(executionId);
}
