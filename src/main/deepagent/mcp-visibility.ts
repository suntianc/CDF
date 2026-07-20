/**
 * mcp-visibility.ts — MCP 服务器可见性查询（薄数据访问模块）
 *
 * 从 shared-infra 抽出，作为 context-aggregator 与装配模块共享的窄 seam：
 * 查询 Agent 可见的 MCP 服务器（全局已连接减去该 Agent 的排除项）与全局已连接服务器。
 */

import db from '../database';
import type { MCPServer } from '../../shared/types';

/**
 * 查询 Agent 可见的 MCP 服务器列表：全局已连接服务器减去该 Agent 的排除项。
 */
export function getAgentMcpServers(agentId: string): MCPServer[] {
  const rows = db
    .prepare(`
      SELECT m.*
      FROM mcp_servers m
      WHERE m.is_connected = 1
        AND NOT EXISTS (
          SELECT 1
          FROM agent_mcp_exclusions ame
          WHERE ame.agent_id = ?
            AND ame.mcp_server_id = m.id
        )
      ORDER BY m.updated_at DESC, m.id ASC
    `)
    .all(agentId) as Array<Omit<MCPServer, 'config' | 'is_connected'> & { config: string | null; is_connected: number }>;

  return deserializeMcpServerRows(rows);
}

export function getConnectedMcpServers(): MCPServer[] {
  const rows = db
    .prepare(`
      SELECT *
      FROM mcp_servers
      WHERE is_connected = 1
      ORDER BY updated_at DESC, id ASC
    `)
    .all() as Array<Omit<MCPServer, 'config' | 'is_connected'> & { config: string | null; is_connected: number }>;

  return deserializeMcpServerRows(rows);
}

function deserializeMcpServerRows(
  rows: Array<Omit<MCPServer, 'config' | 'is_connected'> & { config: string | null; is_connected: number }>,
): MCPServer[] {
  return rows.map((row) => ({
    ...row,
    config: row.config ? JSON.parse(row.config) : {},
    is_connected: !!row.is_connected,
  }));
}
