import { describe, expect, it } from 'vitest';
import { selectDelegatedToolScope } from './agent-tool-scope';

const tool = (name: string) => ({ name });
const server = (id: string) => ({ id, name: id });

describe('Agent Tool Scope', () => {
  it('inherits the complete parent tool surface when no explicit scope exists', () => {
    const result = selectDelegatedToolScope({
      agentConfig: null,
      parentBuiltInToolNames: ['bash', 'fetch'],
      childBuiltInTools: [tool('bash'), tool('fetch'), tool('child-only')],
      parentMcpServerIds: ['github', 'arxiv'],
      childMcpServers: [server('github'), server('arxiv'), server('child-only')],
    });

    expect(result.mode).toBe('inherit');
    expect(result.builtInTools.map((item) => item.name)).toEqual(['bash', 'fetch']);
    expect(result.mcpServers.map((item) => item.id)).toEqual(['github', 'arxiv']);
  });

  it('intersects explicit built-in and MCP selections with the parent surface', () => {
    const result = selectDelegatedToolScope({
      agentConfig: JSON.stringify({
        toolScope: {
          mode: 'narrow',
          builtInTools: ['bash', 'unavailable-tool'],
          mcpServerIds: ['github', 'unavailable-server'],
        },
      }),
      parentBuiltInToolNames: ['bash', 'fetch'],
      childBuiltInTools: [tool('bash'), tool('fetch'), tool('unavailable-tool')],
      parentMcpServerIds: ['github', 'arxiv'],
      childMcpServers: [server('github'), server('arxiv'), server('unavailable-server')],
    });

    expect(result.mode).toBe('narrow');
    expect(result.builtInTools.map((item) => item.name)).toEqual(['bash']);
    expect(result.mcpServers.map((item) => item.id)).toEqual(['github']);
  });

  it('keeps Skill configuration independent from tool narrowing', () => {
    const result = selectDelegatedToolScope({
      agentConfig: {
        toolScope: { mode: 'narrow', builtInTools: [], mcpServerIds: [] },
      },
      parentBuiltInToolNames: ['bash'],
      childBuiltInTools: [tool('bash')],
      parentMcpServerIds: ['github'],
      childMcpServers: [server('github')],
    });

    expect(result.builtInTools).toEqual([]);
    expect(result.mcpServers).toEqual([]);
  });
});
