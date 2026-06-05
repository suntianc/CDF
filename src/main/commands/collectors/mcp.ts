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
       JOIN agent_mcp_servers ON mcp_servers.id = agent_mcp_servers.mcp_server_id
       WHERE agent_mcp_servers.agent_id = ? AND mcp_servers.is_connected = 1`
    )
    .all(agentId) as MCPServer[];

  if (agentServers.length === 0) {
    return { commands: [], hasAgentMcp: false };
  }

  // Pre-warm the tool cache so the LLM has tools loaded for this agent
  // by the time the user dispatches. Result is unused here — the dispatcher
  // reads from the same cache on its own.
  await loadMcpTools(agentId, agentServers);

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
