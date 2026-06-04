import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadMcpToolsMock, dbPrepareMock } = vi.hoisted(() => ({
  loadMcpToolsMock: vi.fn(),
  dbPrepareMock: vi.fn(),
}));

vi.mock('../../deepagent/mcp-connector', () => ({
  loadMcpTools: loadMcpToolsMock,
}));

vi.mock('../../database', () => ({
  default: {
    prepare: dbPrepareMock,
  },
}));

import { collectMcpCommands } from './mcp';

describe('collectors/mcp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockAgentServers(servers: unknown[]) {
    dbPrepareMock.mockReturnValueOnce({ all: vi.fn(() => servers) });
  }

  it('returns empty commands and hasAgentMcp=false when agent has no MCP servers', async () => {
    mockAgentServers([]);
    const result = await collectMcpCommands('agent-1');
    expect(result).toEqual({ commands: [], hasAgentMcp: false });
    expect(loadMcpToolsMock).not.toHaveBeenCalled();
  });

  it('returns hasAgentMcp=true and empty commands when servers bound but tools empty (P6.5)', async () => {
    mockAgentServers([{ id: 's1', name: 's1', is_connected: 1 }]);
    loadMcpToolsMock.mockResolvedValueOnce({ client: null, tools: [] });
    const result = await collectMcpCommands('agent-1');
    expect(result).toEqual({ commands: [], hasAgentMcp: true });
  });

  it('maps MCP tools to SlashCommand with source=mcp and badge=[mcp:<name>]', async () => {
    mockAgentServers([{ id: 's1' }]);
    loadMcpToolsMock.mockResolvedValueOnce({
      client: null,
      tools: [
        { name: 'arxiv_search', description: 'Search arxiv' },
        { name: 'web_lookup', description: 'Web lookup' },
      ],
    });
    const result = await collectMcpCommands('agent-1');
    expect(result.commands).toEqual([
      {
        name: 'arxiv_search',
        description: 'Search arxiv',
        source: 'mcp',
        target: 'arxiv_search',
        sourceLabel: 'mcp:arxiv_search',
        badge: '[mcp:arxiv_search]',
      },
      {
        name: 'web_lookup',
        description: 'Web lookup',
        source: 'mcp',
        target: 'web_lookup',
        sourceLabel: 'mcp:web_lookup',
        badge: '[mcp:web_lookup]',
      },
    ]);
    expect(result.hasAgentMcp).toBe(true);
  });

  it('falls back to empty description when MCP tool description is undefined (D-09)', async () => {
    mockAgentServers([{ id: 's1' }]);
    loadMcpToolsMock.mockResolvedValueOnce({
      client: null,
      tools: [{ name: 'no_desc_tool' }],
    });
    const result = await collectMcpCommands('agent-1');
    expect(result.commands[0].description).toBe('');
  });
});
