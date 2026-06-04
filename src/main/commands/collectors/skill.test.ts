import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listPhysicalSkillsMock } = vi.hoisted(() => ({
  listPhysicalSkillsMock: vi.fn(),
}));

vi.mock('../../deepagent/skill-manager', () => ({
  listPhysicalSkills: listPhysicalSkillsMock,
}));

import { collectSkillCommands } from './skill';

describe('collectors/skill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns [] when no skills exist', async () => {
    listPhysicalSkillsMock.mockReturnValueOnce([]);
    const result = await collectSkillCommands('/tmp/proj');
    expect(result).toEqual([]);
  });

  it('maps project skill to source=skill:project with badge [skill:project]', async () => {
    listPhysicalSkillsMock.mockReturnValueOnce([
      {
        id: 'project:simplify',
        name: 'simplify',
        description: 'simplify code',
        scope: 'project',
        resourceFiles: [],
        created_at: 0,
        updated_at: 0,
      },
    ]);
    const result = await collectSkillCommands('/tmp/proj');
    expect(result).toEqual([
      {
        name: 'simplify',
        description: 'simplify code',
        source: 'skill:project',
        target: 'project:simplify',
        sourceLabel: 'skill:project',
        badge: '[skill:project]',
      },
    ]);
  });

  it('maps global skill to source=skill:global with badge [skill:global]', async () => {
    listPhysicalSkillsMock.mockReturnValueOnce([
      {
        id: 'global:explore',
        name: 'explore',
        description: 'explore repo',
        scope: 'global',
        resourceFiles: [],
        created_at: 0,
        updated_at: 0,
      },
    ]);
    const result = await collectSkillCommands('/tmp/proj');
    expect(result[0].source).toBe('skill:global');
    expect(result[0].badge).toBe('[skill:global]');
    expect(result[0].target).toBe('global:explore');
  });

  it('returns both project and global skills in the same call', async () => {
    listPhysicalSkillsMock.mockReturnValueOnce([
      {
        id: 'project:simplify',
        name: 'simplify',
        description: 'proj',
        scope: 'project',
        resourceFiles: [],
        created_at: 0,
        updated_at: 0,
      },
      {
        id: 'global:explore',
        name: 'explore',
        description: 'global',
        scope: 'global',
        resourceFiles: [],
        created_at: 0,
        updated_at: 0,
      },
    ]);
    const result = await collectSkillCommands('/tmp/proj');
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.source)).toEqual(['skill:project', 'skill:global']);
  });
});
