import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBuiltInSkillDirsMock, getScopePathMock, resolveSkillSourcePlanMock, resolveSkillCatalogMock } = vi.hoisted(() => ({
  getBuiltInSkillDirsMock: vi.fn(() => ['/tmp/built-in/knowledge-base']),
  getScopePathMock: vi.fn(() => '/tmp/global-skills'),
  resolveSkillSourcePlanMock: vi.fn(() => ({ config: { version: 1, additionalSkillDirectories: [] }, sources: [], warnings: [] })),
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

describe('collectSkillCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveSkillCatalogMock.mockReturnValue({ skills: [], warnings: [] });
  });

  it('resolves the live catalog from Built-in and Global sources when no snapshot exists', async () => {
    await expect(collectSkillCommands('/tmp/project')).resolves.toEqual([]);

    expect(resolveSkillSourcePlanMock).toHaveBeenCalledWith('/tmp/project', {
      builtInSkillDirs: ['/tmp/built-in/knowledge-base'],
      userSkillsDir: '/tmp/global-skills',
      includeNestedProjectSkills: undefined,
    });
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
    expect(resolveSkillSourcePlanMock).not.toHaveBeenCalled();
  });

  it('maps a Project Skill to an attributable command', async () => {
    resolveSkillCatalogMock.mockReturnValue({ skills: [{
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
    resolveSkillCatalogMock.mockReturnValue({ skills: [{
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
    resolveSkillCatalogMock.mockReturnValue({ skills: [{
      name: 'internal', description: 'Internal workflow', sourceKind: 'project',
      sourcePath: '/tmp/project/.cdf/skills', skillPath: '/tmp/project/.cdf/skills/internal/SKILL.md',
      modelDiscovery: 'full', userInvocable: false,
    }], warnings: [] });

    await expect(collectSkillCommands('/tmp/project')).resolves.toEqual([]);
  });
});
