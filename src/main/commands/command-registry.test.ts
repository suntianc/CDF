import { beforeEach, describe, expect, it, vi } from 'vitest';

const { collectSystemCommandsMock, collectMcpCommandsMock, collectSkillCommandsMock, collectProjectCommandsMock } = vi.hoisted(() => ({
  collectSystemCommandsMock: vi.fn(),
  collectMcpCommandsMock: vi.fn(),
  collectSkillCommandsMock: vi.fn(),
  collectProjectCommandsMock: vi.fn(),
}));

vi.mock('./collectors/system', () => ({
  collectSystemCommands: collectSystemCommandsMock,
}));
vi.mock('./collectors/mcp', () => ({
  collectMcpCommands: collectMcpCommandsMock,
}));
vi.mock('./collectors/skill', () => ({
  collectSkillCommands: collectSkillCommandsMock,
}));
vi.mock('./collectors/project', () => ({
  collectProjectCommands: collectProjectCommandsMock,
}));

import { collectAllCommands } from './command-registry';

describe('command-registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupAllSucceed() {
    collectSystemCommandsMock.mockReturnValue([{ name: 'goal', description: '', source: 'system', target: 'goal', sourceLabel: 'system', badge: '[system]' }]);
    collectMcpCommandsMock.mockResolvedValue({ commands: [{ name: 'mcp1', description: '', source: 'mcp', target: 'mcp1', sourceLabel: 'mcp:mcp1', badge: '[mcp:mcp1]' }], hasAgentMcp: true });
    collectSkillCommandsMock.mockResolvedValue([{ name: 'sk1', description: '', source: 'skill:project', target: 'project:sk1', sourceLabel: 'skill:project', badge: '[skill:project]' }]);
    collectProjectCommandsMock.mockResolvedValue([{ name: 'cmd1', description: '', source: 'cmd:project', target: '/path/cmd1.md', sourceLabel: 'cmd:project', badge: '[cmd:project]' }]);
  }

  it('all 4 collectors succeed: returns 4 commands + 0 conflicts + 0 warnings', async () => {
    setupAllSucceed();
    const result = await collectAllCommands('/tmp/proj', 'agent-1');
    expect(result.commands).toHaveLength(4);
    expect(result.conflicts).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('passes Skill catalog options to the Skill collector', async () => {
    setupAllSucceed();

    await collectAllCommands('/tmp/proj', 'agent-1', {
      userOverrides: {
        review: 'off',
      },
      agentOverrides: {
        'docs:review': 'user-invocable-only',
      },
    });

    expect(collectSkillCommandsMock).toHaveBeenCalledWith('/tmp/proj', {
      userOverrides: {
        review: 'off',
      },
      agentOverrides: {
        'docs:review': 'user-invocable-only',
      },
    });
  });

  it('does not throw when one collector rejects (P6.1 — failure isolation)', async () => {
    collectSystemCommandsMock.mockReturnValue([{ name: 'goal', description: '', source: 'system', target: 'goal', sourceLabel: 'system', badge: '[system]' }]);
    collectMcpCommandsMock.mockRejectedValue(new Error('mcp server down'));
    collectSkillCommandsMock.mockResolvedValue([{ name: 'sk1', description: '', source: 'skill:project', target: 'project:sk1', sourceLabel: 'skill:project', badge: '[skill:project]' }]);
    collectProjectCommandsMock.mockResolvedValue([{ name: 'cmd1', description: '', source: 'cmd:project', target: '/path/cmd1.md', sourceLabel: 'cmd:project', badge: '[cmd:project]' }]);

    const result = await collectAllCommands('/tmp/proj', 'agent-1');
    expect(result.commands).toHaveLength(3);
    expect(result.commands.map((c) => c.source)).toEqual(['system', 'skill:project', 'cmd:project']);
    expect(result.warnings).toEqual([]);
  });

  it('mcp_health_warning only when hasAgentMcp is true AND tools empty (P6.5)', async () => {
    collectSystemCommandsMock.mockReturnValue([]);
    collectMcpCommandsMock.mockResolvedValue({ commands: [], hasAgentMcp: true });
    collectSkillCommandsMock.mockResolvedValue([]);
    collectProjectCommandsMock.mockResolvedValue([]);

    const result = await collectAllCommands('/tmp/proj', 'agent-1');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].type).toBe('mcp_health_warning');
  });

  it('mcp_health_warning NOT fired when hasAgentMcp is false (P6.5 — agent never bound)', async () => {
    collectSystemCommandsMock.mockReturnValue([]);
    collectMcpCommandsMock.mockResolvedValue({ commands: [], hasAgentMcp: false });
    collectSkillCommandsMock.mockResolvedValue([]);
    collectProjectCommandsMock.mockResolvedValue([]);

    const result = await collectAllCommands('/tmp/proj', 'agent-1');
    expect(result.warnings).toEqual([]);
  });

  it('preserves BOTH rows on conflict (D-05 + P6.2 — do NOT dedupe)', async () => {
    const shared = { name: 'dup', description: 'shared' };
    collectSystemCommandsMock.mockReturnValue([{ ...shared, source: 'system', target: 'dup', sourceLabel: 'system', badge: '[system]' }]);
    collectMcpCommandsMock.mockResolvedValue({ commands: [], hasAgentMcp: false });
    collectSkillCommandsMock.mockResolvedValue([{ ...shared, source: 'skill:project', target: 'project:dup', sourceLabel: 'skill:project', badge: '[skill:project]' }]);
    collectProjectCommandsMock.mockResolvedValue([]);

    const result = await collectAllCommands('/tmp/proj', 'agent-1');
    expect(result.commands).toHaveLength(2);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].conflicts).toHaveLength(2);
  });

  it('all collectors fail → returns empty result, no throw (P6.1 + P6.2)', async () => {
    collectSystemCommandsMock.mockImplementation(() => { throw new Error('system boom'); });
    collectMcpCommandsMock.mockRejectedValue(new Error('mcp boom'));
    collectSkillCommandsMock.mockRejectedValue(new Error('skills boom'));
    collectProjectCommandsMock.mockRejectedValue(new Error('projects boom'));

    const result = await collectAllCommands('/tmp/proj', 'agent-1');
    expect(result.commands).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('mcp_health_warning not fired when MCP returns tools (success path)', async () => {
    collectSystemCommandsMock.mockReturnValue([]);
    collectMcpCommandsMock.mockResolvedValue({
      commands: [{ name: 'ok_tool', description: '', source: 'mcp', target: 'ok_tool', sourceLabel: 'mcp:ok_tool', badge: '[mcp:ok_tool]' }],
      hasAgentMcp: true,
    });
    collectSkillCommandsMock.mockResolvedValue([]);
    collectProjectCommandsMock.mockResolvedValue([]);

    const result = await collectAllCommands('/tmp/proj', 'agent-1');
    expect(result.warnings).toEqual([]);
    expect(result.commands).toHaveLength(1);
  });

  it('uses Promise.allSettled (does not short-circuit on first failure)', async () => {
    collectSystemCommandsMock.mockReturnValue([{ name: 's', description: '', source: 'system', target: 's', sourceLabel: 'system', badge: '[system]' }]);
    collectMcpCommandsMock.mockRejectedValue(new Error('first'));
    collectSkillCommandsMock.mockResolvedValue([{ name: 'k', description: '', source: 'skill:project', target: 'project:k', sourceLabel: 'skill:project', badge: '[skill:project]' }]);
    collectProjectCommandsMock.mockResolvedValue([]);

    const result = await collectAllCommands('/tmp/proj', 'agent-1');
    // system and skill should still be there; project is empty
    expect(result.commands.map((c) => c.name)).toEqual(['s', 'k']);
  });
});
