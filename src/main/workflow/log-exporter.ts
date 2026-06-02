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
const SCHEMA_VERSION = '1.0';
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

  // 7. 解析 events
  const events = row.events_snapshot ? JSON.parse(row.events_snapshot) : [];

  return {
    schema_version: SCHEMA_VERSION,
    exported_at: Date.now(),
    workflow: {
      id: workflowRow.id,
      name: workflowRow.name,
      graph_data: configSnapshot?.graph_data || graphData,
      agents: safeAgents,
      mcp_servers: safeMcpServers,
      skills: configSnapshot?.skills || [],
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
        retry_count: r.retry_count,
        started_at: r.started_at,
        ended_at: r.ended_at,
        logs: r.logs ? JSON.parse(r.logs) : [],
        tool_calls: r.tool_calls ? JSON.parse(r.tool_calls) : [],
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
