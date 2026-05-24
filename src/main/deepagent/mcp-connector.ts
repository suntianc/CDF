import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { StructuredToolInterface } from '@langchain/core/tools';
import { MCPServer } from '../../shared/types';

type McpClientConfig = ConstructorParameters<typeof MultiServerMCPClient>[0];

interface McpCacheEntry {
  client: MultiServerMCPClient | null;
  tools: StructuredToolInterface[];
  configHash: string;
}

// 按 agentId 缓存 MCP 长连接，配置不变时复用
const mcpCache = new Map<string, McpCacheEntry>();

function hashServers(servers: MCPServer[]): string {
  return JSON.stringify(
    servers.map((s) => ({ id: s.id, server_type: s.server_type, config: s.config }))
  );
}

function parseConfig(server: MCPServer): Record<string, unknown> {
  if (typeof server.config === 'string') {
    return JSON.parse(server.config);
  }
  return server.config || {};
}

function buildServerConfig(server: MCPServer): Record<string, unknown> {
  const config = parseConfig(server);

  if (server.server_type === 'stdio') {
    return {
      transport: 'stdio',
      command: String(config.command || ''),
      args: Array.isArray(config.args) ? config.args.map(String) : [],
      env: typeof config.env === 'object' && config.env ? (config.env as Record<string, string>) : undefined,
      restart: typeof config.restart === 'object' ? (config.restart as { enabled?: boolean; maxAttempts?: number; delayMs?: number }) : undefined,
    };
  }

  return {
    transport: 'sse',
    url: String(config.url || ''),
    headers: typeof config.headers === 'object' && config.headers ? (config.headers as Record<string, string>) : undefined,
  };
}

export function createMcpClient(servers: MCPServer[]): MultiServerMCPClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mcpServers: any = Object.fromEntries(servers.map((server) => [server.id, buildServerConfig(server)]));

  return new MultiServerMCPClient({
    mcpServers,
    useStandardContentBlocks: true,
    onConnectionError: 'ignore',
  });
}

export async function loadMcpTools(
  agentId: string,
  servers: MCPServer[]
): Promise<{ client: MultiServerMCPClient | null; tools: StructuredToolInterface[] }> {
  const configHash = hashServers(servers);
  const cached = mcpCache.get(agentId);

  // 配置未变，直接复用缓存的连接和工具列表
  if (cached && cached.configHash === configHash) {
    return { client: cached.client, tools: cached.tools };
  }

  // 配置变更或首次连接，关闭旧连接
  if (cached?.client) {
    await cached.client.close().catch(() => {});
  }

  if (servers.length === 0) {
    const entry: McpCacheEntry = { client: null, tools: [], configHash };
    mcpCache.set(agentId, entry);
    return { client: null, tools: [] };
  }

  const client = createMcpClient(servers);
  const tools = await client.getTools();
  mcpCache.set(agentId, { client, tools, configHash });
  return { client, tools };
}
