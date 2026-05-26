import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { StructuredToolInterface } from '@langchain/core/tools';
import { MCPServer } from '../../shared/types';

type McpClientConfig = ConstructorParameters<typeof MultiServerMCPClient>[0];

interface McpCacheEntry {
  client: MultiServerMCPClient | null;
  tools: StructuredToolInterface[];
  configHash: string;
}

// 按 agentId 缓存 MCP 长连接，配置不变时复用（Agent 运行时用）
const mcpCache = new Map<string, McpCacheEntry>();

// 按 serverId 缓存 MCP 长连接，供健康检查复用
const serverClients = new Map<string, { client: MultiServerMCPClient; lastUsed: number }>();

// 连接过期时间：5分钟
const CONNECTION_TTL = 5 * 60 * 1000;

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

/**
 * 按 serverId 获取或创建 MCP 客户端（健康检查复用）
 */
export async function getOrCreateServerClient(server: MCPServer): Promise<MultiServerMCPClient> {
  const cached = serverClients.get(server.id);
  if (cached && Date.now() - cached.lastUsed < CONNECTION_TTL) {
    return cached.client;
  }

  // 关闭旧连接（如果存在）
  if (cached?.client) {
    await cached.client.close().catch(() => {});
  }

  const client = createMcpClient([server]);
  serverClients.set(server.id, { client, lastUsed: Date.now() });
  return client;
}

/**
 * 健康检查：复用连接，失败时清理缓存
 */
export async function checkMcpServerHealth(
  server: MCPServer
): Promise<{ ok: boolean; tools: number; message: string }> {
  try {
    const client = await getOrCreateServerClient(server);
    // 更新最后使用时间
    const entry = serverClients.get(server.id);
    if (entry) entry.lastUsed = Date.now();

    const tools = await client.getTools();
    return { ok: true, tools: tools.length, message: `检测到 ${tools.length} 个工具` };
  } catch (err: any) {
    // 连接失效，清理缓存，下次会重建
    const cached = serverClients.get(server.id);
    if (cached?.client) {
      await cached.client.close().catch(() => {});
    }
    serverClients.delete(server.id);
    return { ok: false, tools: 0, message: err.message || '连接失败' };
  }
}

/**
 * 断开指定 MCP 服务器连接（供 UI 调用）
 */
export async function disconnectMcpServer(serverId: string): Promise<void> {
  const cached = serverClients.get(serverId);
  if (cached?.client) {
    await cached.client.close().catch(() => {});
  }
  serverClients.delete(serverId);
}

/**
 * 断开所有 MCP 服务器连接（应用退出时调用）
 */
export async function disconnectAllMcpServers(): Promise<void> {
  for (const [serverId, cached] of serverClients) {
    await cached.client.close().catch(() => {});
  }
  serverClients.clear();
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
