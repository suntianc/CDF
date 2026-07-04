import { loadMcpTools } from '../../deepagent/mcp-connector';
import db from '../../database';
import type { MCPServer, SlashCommand } from '../../../shared/types';

interface McpCollectorResult {
  commands: SlashCommand[];
  /** True iff the agent has at least one visible connected MCP server. */
  hasAgentMcp: boolean;
}

/**
 * Phase 6 MCP collector.
 *
 * - Reuses `loadMcpTools(agentId, servers)` (mcpCache hit, no reconnect).
 * - Returns BOTH the mapped `SlashCommand[]` AND `hasAgentMcp` so the IPC
 *   layer can decide whether to fire `mcp_health_warning` (P6.5).
 *
 * Server-dimension grouping (v1.1 polish): one SlashCommand per MCP server
 * rather than one per tool. The LLM picks the appropriate tool from the
 * server's available tools at dispatch time, so the user does not need
 * to memorize the exact tool name (`/arxiv_search`, `/arxiv_summarize`).
 * Pre-loads tools so the dispatcher can confidently tell the LLM "the
 * arxiv server has these tools available".
 */
export async function collectMcpCommands(agentId: string): Promise<McpCollectorResult> {
  const agentServers = db
    .prepare(
      `SELECT mcp_servers.* FROM mcp_servers
       WHERE mcp_servers.is_connected = 1
         AND NOT EXISTS (
           SELECT 1
           FROM agent_mcp_exclusions
           WHERE agent_mcp_exclusions.agent_id = ?
             AND agent_mcp_exclusions.mcp_server_id = mcp_servers.id
         )
       ORDER BY mcp_servers.updated_at DESC, mcp_servers.id ASC`
    )
    .all(agentId) as MCPServer[];

  if (agentServers.length === 0) {
    return { commands: [], hasAgentMcp: false };
  }

  const allConnectedServers = db
    .prepare(
      `SELECT * FROM mcp_servers
       WHERE is_connected = 1
       ORDER BY updated_at DESC, id ASC`
    )
    .all() as MCPServer[];

  // Pre-warm the tool cache so the LLM has tools loaded for this agent
  // by the time the user dispatches. Result is unused here — the dispatcher
  // reads from the same cache on its own.
  await loadMcpTools(agentId, agentServers, allConnectedServers);

  // One command per server. `name` and `target` are both the server name
  // so `dispatcher.resolve()` can match `/<server>` and `dispatcher.dispatch()`
  // can build the prompt from the same identifier.
  const commands: SlashCommand[] = agentServers.map((server) => ({
    name: server.name,
    description: server.description || `MCP server: ${server.name}`,
    source: 'mcp',
    target: server.name,
    sourceLabel: `mcp:${server.name}`,
    badge: `[mcp:${server.name}]`,
  }));

  return { commands, hasAgentMcp: true };
}
