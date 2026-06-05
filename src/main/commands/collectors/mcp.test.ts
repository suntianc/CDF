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

  it('returns hasAgentMcp=true and one command per server (server-dim) when servers bound but tools empty (P6.5)', async () => {
    mockAgentServers([{ id: 's1', name: 'arxiv', description: 'arXiv papers' }]);
    loadMcpToolsMock.mockResolvedValueOnce({ client: null, tools: [] });
    const result = await collectMcpCommands('agent-1');
    expect(result.hasAgentMcp).toBe(true);
    // v1.1 polish: server-dim. The command still exists (so the user can
    // see the server is bound) even when its tool list is empty.
    expect(result.commands).toEqual([
      {
        name: 'arxiv',
        description: 'arXiv papers',
        source: 'mcp',
        target: 'arxiv',
        sourceLabel: 'mcp:arxiv',
        badge: '[mcp:arxiv]',
      },
    ]);
  });

  it('groups multiple tools under one server into a single SlashCommand (server-dim)', async () => {
    mockAgentServers([{ id: 's1', name: 'arxiv', description: 'arXiv MCP' }]);
    loadMcpToolsMock.mockResolvedValueOnce({
      client: null,
      tools: [
        { name: 'arxiv_search', description: 'Search papers' },
        { name: 'arxiv_summarize', description: 'Summarize paper' },
        { name: 'arxiv_download', description: 'Download PDF' },
      ],
    });
    const result = await collectMcpCommands('agent-1');
    // ONE command per server, not one per tool — the LLM picks the right
    // tool from the server's available tools at dispatch time.
    expect(result.commands).toEqual([
      {
        name: 'arxiv',
        description: 'arXiv MCP',
        source: 'mcp',
        target: 'arxiv',
        sourceLabel: 'mcp:arxiv',
        badge: '[mcp:arxiv]',
      },
    ]);
    expect(result.hasAgentMcp).toBe(true);
  });

  it('produces one command per server when multiple servers are bound', async () => {
    mockAgentServers([
      { id: 's1', name: 'arxiv', description: 'arXiv MCP' },
      { id: 's2', name: 'github', description: 'GitHub MCP' },
    ]);
    loadMcpToolsMock.mockResolvedValueOnce({ client: null, tools: [] });
    const result = await collectMcpCommands('agent-1');
    expect(result.commands).toEqual([
      {
        name: 'arxiv',
        description: 'arXiv MCP',
        source: 'mcp',
        target: 'arxiv',
        sourceLabel: 'mcp:arxiv',
        badge: '[mcp:arxiv]',
      },
      {
        name: 'github',
        description: 'GitHub MCP',
        source: 'mcp',
        target: 'github',
        sourceLabel: 'mcp:github',
        badge: '[mcp:github]',
      },
    ]);
  });

  it('falls back to "MCP server: <name>" when server description is missing (D-09)', async () => {
    mockAgentServers([{ id: 's1', name: 'no_desc_server' }]);
    loadMcpToolsMock.mockResolvedValueOnce({ client: null, tools: [] });
    const result = await collectMcpCommands('agent-1');
    expect(result.commands[0].description).toBe('MCP server: no_desc_server');
  });
});
