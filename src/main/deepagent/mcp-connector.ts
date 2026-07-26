import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { StructuredToolInterface } from '@langchain/core/tools';
import { MCPServer } from '../../shared/types';

interface McpCacheEntry {
  client: MultiServerMCPClient | null;
  toolsByServer: Map<string, StructuredToolInterface[]>;
  configHash: string;
}

// Agent 运行时共享一套 MCP 长连接；Agent 级差异只过滤工具清单。
let mcpCache: McpCacheEntry | null = null;

// 同一 configHash 的并发 (re)build 合并到一个 in-flight promise，避免各自建 client、
// 只有后者写回 mcpCache 而前者泄漏。
let inFlightMcpBuild: { configHash: string; promise: Promise<McpCacheEntry> } | null = null;

// 按 serverId 缓存 MCP 长连接，供健康检查复用
const serverClients = new Map<string, { client: MultiServerMCPClient; lastUsed: number }>();

// 连接过期时间：5分钟
const CONNECTION_TTL = 5 * 60 * 1000;

function hashServers(servers: MCPServer[]): string {
  return JSON.stringify(
    [...servers]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((s) => ({ id: s.id, server_type: s.server_type, config: s.config }))
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
    transport: 'http',
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
  const closes = [...serverClients.values()].map((cached) =>
    cached.client.close().catch(() => {}),
  );
  await Promise.all(closes);
  serverClients.clear();
}

export async function loadMcpTools(
  _agentId: string,
  servers: MCPServer[],
  sharedServers: MCPServer[] = servers,
): Promise<{ client: MultiServerMCPClient | null; tools: StructuredToolInterface[] }> {
  const configHash = hashServers(sharedServers);

  // 全局配置未变，复用共享连接；按当前 Agent 可见 server 过滤工具。
  if (mcpCache && mcpCache.configHash === configHash) {
    return {
      client: mcpCache.client,
      tools: collectToolsForServers(mcpCache.toolsByServer, servers),
    };
  }

  // 已有针对同一目标配置的构建在飞行中，复用它，避免重复建连与泄漏。
  if (inFlightMcpBuild && inFlightMcpBuild.configHash === configHash) {
    const entry = await inFlightMcpBuild.promise;
    return { client: entry.client, tools: collectToolsForServers(entry.toolsByServer, servers) };
  }

  const build = buildMcpCacheEntry(sharedServers, configHash);
  inFlightMcpBuild = { configHash, promise: build };
  try {
    const entry = await build;
    return { client: entry.client, tools: collectToolsForServers(entry.toolsByServer, servers) };
  } finally {
    if (inFlightMcpBuild?.promise === build) inFlightMcpBuild = null;
  }
}

async function buildMcpCacheEntry(
  sharedServers: MCPServer[],
  configHash: string,
): Promise<McpCacheEntry> {
  // 全局配置变更或首次连接，关闭旧共享连接。
  if (mcpCache?.client) {
    await mcpCache.client.close().catch(() => {});
  }

  if (sharedServers.length === 0) {
    const entry: McpCacheEntry = { client: null, toolsByServer: new Map(), configHash };
    mcpCache = entry;
    return entry;
  }

  const client = createMcpClient(sharedServers);
  const toolEntries = await Promise.all(
    sharedServers.map(async (server) => [server.id, await client.getTools(server.id)] as const),
  );
  const entry: McpCacheEntry = {
    client,
    toolsByServer: new Map<string, StructuredToolInterface[]>(toolEntries),
    configHash,
  };
  mcpCache = entry;
  return entry;
}

function collectToolsForServers(
  toolsByServer: Map<string, StructuredToolInterface[]>,
  servers: MCPServer[],
): StructuredToolInterface[] {
  return servers.flatMap((server) => toolsByServer.get(server.id) ?? []);
}
