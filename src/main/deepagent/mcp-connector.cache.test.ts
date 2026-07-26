import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MCPServer } from '../../shared/types';

const { constructorMock, getToolsMock, closeMock } = vi.hoisted(() => ({
  constructorMock: vi.fn(),
  getToolsMock: vi.fn(),
  closeMock: vi.fn(async () => {}),
}));

vi.mock('@langchain/mcp-adapters', () => ({
  MultiServerMCPClient: vi.fn(function MockMultiServerMCPClient(this: {
    getTools: typeof getToolsMock;
    close: typeof closeMock;
  }, config: unknown) {
    constructorMock(config);
    this.getTools = getToolsMock;
    this.close = closeMock;
  }),
}));

function server(id: string): MCPServer {
  return {
    id,
    name: id,
    server_type: 'stdio',
    config: { command: 'node', args: [`${id}.js`] },
    is_connected: true,
    created_at: 0,
    updated_at: 0,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('loadMcpTools shared connection cache', () => {
  beforeEach(() => {
    vi.resetModules();
    constructorMock.mockClear();
    closeMock.mockClear();
    getToolsMock.mockReset();
    getToolsMock.mockImplementation(async (...serverIds: string[]) => {
      const toolsByServer: Record<string, Array<{ name: string; description: string }>> = {
        alpha: [{ name: 'search', description: 'Search alpha' }],
        beta: [{ name: 'read', description: 'Read beta' }],
      };
      const ids = serverIds.length > 0 ? serverIds : Object.keys(toolsByServer);
      return ids.flatMap((id) => toolsByServer[id] ?? []);
    });
  });

  it('reuses the global server connection when Agents exclude different servers', async () => {
    const { loadMcpTools } = await import('./mcp-connector');
    const alpha = server('alpha');
    const beta = server('beta');
    const allServers = [alpha, beta];

    const first = await loadMcpTools('agent-a', [alpha], allServers);
    const second = await loadMcpTools('agent-b', [beta], allServers);

    expect(first.tools.map((tool) => tool.name)).toEqual(['search']);
    expect(second.tools.map((tool) => tool.name)).toEqual(['read']);
    expect(constructorMock).toHaveBeenCalledTimes(1);
    expect(closeMock).not.toHaveBeenCalled();
  });

  it('coalesces concurrent builds for the same config into a single client (#215)', async () => {
    const { loadMcpTools } = await import('./mcp-connector');
    const alpha = server('alpha');
    const beta = server('beta');
    const allServers = [alpha, beta];
    const gate = deferred<Array<{ name: string; description: string }>>();
    getToolsMock.mockImplementation(() => gate.promise);

    // Two agents load the same (uncached) config concurrently.
    const p1 = loadMcpTools('agent-a', [alpha], allServers);
    const p2 = loadMcpTools('agent-b', [beta], allServers);
    await Promise.resolve();
    gate.resolve([{ name: 'search', description: 'x' }]);
    await Promise.all([p1, p2]);

    // Only one shared client is constructed despite two concurrent callers (no leak).
    expect(constructorMock).toHaveBeenCalledTimes(1);
  });

  it('starts loading tools from all shared servers before waiting for any one server', async () => {
    const { loadMcpTools } = await import('./mcp-connector');
    const alpha = server('alpha');
    const beta = server('beta');
    const alphaTools = deferred<Array<{ name: string; description: string }>>();
    const betaTools = deferred<Array<{ name: string; description: string }>>();

    getToolsMock.mockImplementation((serverId: string) => {
      if (serverId === 'alpha') return alphaTools.promise;
      if (serverId === 'beta') return betaTools.promise;
      return Promise.resolve([]);
    });

    const loadPromise = loadMcpTools('agent-a', [alpha, beta], [alpha, beta]);
    await Promise.resolve();

    expect(getToolsMock).toHaveBeenCalledWith('alpha');
    expect(getToolsMock).toHaveBeenCalledWith('beta');

    alphaTools.resolve([{ name: 'search', description: 'Search alpha' }]);
    betaTools.resolve([{ name: 'read', description: 'Read beta' }]);

    const result = await loadPromise;
    expect(result.tools.map((tool) => tool.name)).toEqual(['search', 'read']);
  });
});
