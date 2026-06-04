import { loadMcpTools } from '../../deepagent/mcp-connector';
import db from '../../database';
import type { MCPServer, SlashCommand } from '../../../shared/types';

interface McpCollectorResult {
  commands: SlashCommand[];
  /** True iff the agent has at least one bound MCP server (regardless of
   *  whether the tools list is non-empty). Drives the mcp_health_warning
   *  discrimination (P6.5: agent-never-bound vs tools-empty). */
  hasAgentMcp: boolean;
}

/**
 * Phase 6 MCP collector.
 *
 * - Reuses `loadMcpTools(agentId, servers)` (mcpCache hit, no reconnect).
 * - Returns BOTH the mapped `SlashCommand[]` AND `hasAgentMcp` so the IPC
 *   layer can decide whether to fire `mcp_health_warning` (P6.5).
 * - Description is collected for internal log only; popup does not render it
 *   (D-09).
 */
export async function collectMcpCommands(agentId: string): Promise<McpCollectorResult> {
  const agentServers = db
    .prepare(
      `SELECT mcp_servers.* FROM mcp_servers
       JOIN agent_mcp_servers ON mcp_servers.id = agent_mcp_servers.mcp_server_id
       WHERE agent_mcp_servers.agent_id = ? AND mcp_servers.is_connected = 1`
    )
    .all(agentId) as MCPServer[];

  if (agentServers.length === 0) {
    return { commands: [], hasAgentMcp: false };
  }

  const { tools } = await loadMcpTools(agentId, agentServers);

  const commands: SlashCommand[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    source: 'mcp',
    target: tool.name,
    sourceLabel: `mcp:${tool.name}`,
    badge: `[mcp:${tool.name}]`,
  }));

  return { commands, hasAgentMcp: true };
}
