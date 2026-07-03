import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getBuiltInSkillDirsMock,
  getScopePathMock,
  resolveSkillSourcePlanMock,
  resolveSkillCatalogMock,
} = vi.hoisted(() => ({
  getBuiltInSkillDirsMock: vi.fn(() => ['/tmp/built-in/knowledge-base']),
  getScopePathMock: vi.fn((_projectPath: string, scope: string) =>
    scope === 'global' ? '/tmp/global-skills' : `${_projectPath}/.cdf/skills`
  ),
  resolveSkillSourcePlanMock: vi.fn(() => ({
    config: { version: 1, overrides: {}, additionalSkillDirectories: [] },
    sources: [],
    warnings: [],
  })),
  resolveSkillCatalogMock: vi.fn((): any => ({ skills: [], warnings: [] })),
}));

vi.mock('../../deepagent/skill-manager', () => ({
  getBuiltInSkillDirs: getBuiltInSkillDirsMock,
  getScopePath: getScopePathMock,
}));

vi.mock('../../deepagent/skills-runtime/skill-sources', () => ({
  resolveSkillSourcePlan: resolveSkillSourcePlanMock,
  resolveSkillCatalog: resolveSkillCatalogMock,
}));

import { collectSkillCommands } from './skill';

describe('collectors/skill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBuiltInSkillDirsMock.mockReturnValue(['/tmp/built-in/knowledge-base']);
    getScopePathMock.mockImplementation((_projectPath: string, scope: string) =>
      scope === 'global' ? '/tmp/global-skills' : `${_projectPath}/.cdf/skills`
    );
    resolveSkillSourcePlanMock.mockReturnValue({
      config: { version: 1, overrides: {}, additionalSkillDirectories: [] },
      sources: [],
      warnings: [],
    });
    resolveSkillCatalogMock.mockReturnValue({ skills: [], warnings: [] });
  });

  it('returns [] when no user-invocable skills exist', async () => {
    const result = await collectSkillCommands('/tmp/proj');

    expect(result).toEqual([]);
    expect(resolveSkillSourcePlanMock).toHaveBeenCalledWith('/tmp/proj', {
      builtInSkillDirs: ['/tmp/built-in/knowledge-base'],
      userSkillsDir: '/tmp/global-skills',
    });
  });

  it('passes User and Agent Skill Overrides into catalog resolution', async () => {
    await collectSkillCommands('/tmp/proj', {
      userOverrides: {
        review: 'off',
      },
      agentOverrides: {
        'docs:review': 'user-invocable-only',
      },
    });

    expect(resolveSkillCatalogMock).toHaveBeenCalledWith(
      expect.any(Object),
      {
        userOverrides: {
          review: 'off',
        },
        agentOverrides: {
          'docs:review': 'user-invocable-only',
        },
      }
    );
  });

  it('maps project catalog entries to attributable Skill commands', async () => {
    resolveSkillCatalogMock.mockReturnValueOnce({
      skills: [
        {
          name: 'simplify',
          description: 'simplify code',
          sourceKind: 'project',
          sourcePath: '/tmp/proj/.cdf/skills',
          skillPath: '/tmp/proj/.cdf/skills/simplify/SKILL.md',
          visibility: 'on',
          visibilitySource: 'default',
          modelDiscovery: 'full',
          userInvocable: true,
          argumentHint: '<file>',
          allowedTools: ['read_file', 'grep'],
          whenToUse: 'Use for focused simplification',
          arguments: ['file'],
        },
      ],
      warnings: [],
    });

    const result = await collectSkillCommands('/tmp/proj');

    expect(result).toEqual([
      {
        name: 'simplify',
        qualifiedName: 'simplify',
        skillName: 'simplify',
        skillSourceKind: 'project',
        sourcePath: '/tmp/proj/.cdf/skills',
        skillPath: '/tmp/proj/.cdf/skills/simplify/SKILL.md',
        skillVisibility: 'on',
        modelDiscovery: 'full',
        userInvocable: true,
        argumentHint: '<file>',
        description: 'simplify code',
        source: 'skill:project',
        target: 'project:simplify',
        sourceLabel: 'Project Skill',
        badge: '[skill:project]',
        frontmatter: {
          allowedTools: ['read_file', 'grep'],
          whenToUse: 'Use for focused simplification',
          arguments: ['file'],
        },
      },
    ]);
  });

  it('maps global catalog entries to global Skill command labels', async () => {
    resolveSkillCatalogMock.mockReturnValueOnce({
      skills: [
        {
          name: 'explore',
          description: 'explore repo',
          sourceKind: 'user',
          sourcePath: '/tmp/global-skills',
          skillPath: '/tmp/global-skills/explore/SKILL.md',
          visibility: 'on',
          visibilitySource: 'default',
          modelDiscovery: 'full',
          userInvocable: true,
        },
      ],
      warnings: [],
    });

    const result = await collectSkillCommands('/tmp/proj');

    expect(result[0]).toMatchObject({
      name: 'explore',
      source: 'skill:global',
      target: 'global:explore',
      sourceLabel: 'Global Skill',
      badge: '[skill:global]',
    });
  });

  it('omits catalog entries that are not user-invocable', async () => {
    resolveSkillCatalogMock.mockReturnValueOnce({
      skills: [
        {
          name: 'disabled',
          description: 'off',
          sourceKind: 'project',
          sourcePath: '/tmp/proj/.cdf/skills',
          skillPath: '/tmp/proj/.cdf/skills/disabled/SKILL.md',
          visibility: 'off',
          visibilitySource: 'project',
          modelDiscovery: 'hidden',
          userInvocable: false,
        },
      ],
      warnings: [],
    });

    const result = await collectSkillCommands('/tmp/proj');

    expect(result).toEqual([]);
  });
});
