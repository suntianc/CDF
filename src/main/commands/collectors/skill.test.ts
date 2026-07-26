import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveProjectSkillCatalogMock } = vi.hoisted(() => ({
  resolveProjectSkillCatalogMock: vi.fn((): any => ({ skills: [], warnings: [] })),
}));

vi.mock('../../deepagent/skill-catalog', async () => {
  const sources = await vi.importActual<
    typeof import('../../deepagent/skills-runtime/skill-sources')
  >('../../deepagent/skills-runtime/skill-sources');
  return {
    resolveProjectSkillCatalog: resolveProjectSkillCatalogMock,
    getSkillSourceLabel: sources.getSkillSourceLabel,
  };
});

import { collectSkillCommands } from './skill';

describe('collectSkillCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveProjectSkillCatalogMock.mockReturnValue({ skills: [], warnings: [] });
  });

  it('resolves the live catalog through the Skill Catalog when no snapshot exists', async () => {
    await expect(collectSkillCommands('/tmp/project', { includeNestedProjectSkills: true }))
      .resolves.toEqual([]);

    expect(resolveProjectSkillCatalogMock).toHaveBeenCalledWith(
      '/tmp/project',
      expect.objectContaining({ includeNestedProjectSkills: true }),
    );
  });

  it('uses the frozen Conversation Skill Snapshot without resolving a live catalog', async () => {
    const commands = await collectSkillCommands('/tmp/project', { catalog: [{
      name: 'review',
      description: 'Captured review workflow',
      sourceKind: 'project',
      sourcePath: '/tmp/project/.cdf/skills',
      skillPath: '/tmp/project/.cdf/skills/review/SKILL.md',
      modelDiscovery: 'full',
      userInvocable: true,
    }] });

    expect(commands).toEqual([expect.objectContaining({ name: 'review', target: 'project:review' })]);
    expect(resolveProjectSkillCatalogMock).not.toHaveBeenCalled();
  });

  it('maps a Project Skill to an attributable command', async () => {
    resolveProjectSkillCatalogMock.mockReturnValue({ skills: [{
      name: 'simplify', description: 'Simplify code', sourceKind: 'project',
      sourcePath: '/tmp/project/.cdf/skills', skillPath: '/tmp/project/.cdf/skills/simplify/SKILL.md',
      modelDiscovery: 'full', userInvocable: true, argumentHint: '<file>',
    }], warnings: [] });

    const commands = await collectSkillCommands('/tmp/project');

    expect(commands[0]).toMatchObject({
      name: 'simplify', skillName: 'simplify', skillSourceKind: 'project',
      source: 'skill:project', target: 'project:simplify', sourceLabel: 'Project Skill',
      modelDiscovery: 'full', userInvocable: true, argumentHint: '<file>',
    });
  });

  it('maps a Global Skill to a global attributable command', async () => {
    resolveProjectSkillCatalogMock.mockReturnValue({ skills: [{
      name: 'explore', description: 'Explore the repository', sourceKind: 'user',
      sourcePath: '/tmp/global-skills', skillPath: '/tmp/global-skills/explore/SKILL.md',
      modelDiscovery: 'full', userInvocable: true,
    }], warnings: [] });

    const commands = await collectSkillCommands('/tmp/project');

    expect(commands[0]).toMatchObject({
      name: 'explore', skillSourceKind: 'user', source: 'skill:global',
      target: 'global:explore', sourceLabel: 'Global Skill',
      skillPath: '/tmp/global-skills/explore/SKILL.md',
    });
  });

  it('omits Skills whose author disables explicit invocation', async () => {
    resolveProjectSkillCatalogMock.mockReturnValue({ skills: [{
      name: 'internal', description: 'Internal workflow', sourceKind: 'project',
      sourcePath: '/tmp/project/.cdf/skills', skillPath: '/tmp/project/.cdf/skills/internal/SKILL.md',
      modelDiscovery: 'full', userInvocable: false,
    }], warnings: [] });

    await expect(collectSkillCommands('/tmp/project')).resolves.toEqual([]);
  });
});
