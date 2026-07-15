import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  invalidateSkillSourceCaches,
  resolveSkillCatalog,
  resolveSkillSourcePlan,
} from './skill-sources';

function writeSkill(
  skillsDir: string,
  name: string,
  description: string,
  frontmatter: string[] = []
): void {
  const skillDir = path.join(skillsDir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    [
      '---',
      `name: ${name}`,
      `description: ${description}`,
      ...frontmatter,
      '---',
      '',
      `# ${name}`,
    ].join('\n'),
    'utf-8'
  );
}

describe('resolveSkillSourcePlan', () => {
  const tempProjectPath = path.join(os.tmpdir(), `cdf-skill-source-test-${Math.random().toString(36).slice(2)}`);
  const tempHomePath = path.join(os.tmpdir(), `cdf-skill-source-home-${Math.random().toString(36).slice(2)}`);

  beforeEach(() => {
    invalidateSkillSourceCaches();
    fs.rmSync(tempProjectPath, { recursive: true, force: true });
    fs.rmSync(tempHomePath, { recursive: true, force: true });
    fs.mkdirSync(path.join(tempProjectPath, '.cdf', 'skills'), { recursive: true });
    fs.mkdirSync(path.join(tempHomePath, '.cdf', 'skills'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempProjectPath, { recursive: true, force: true });
    fs.rmSync(tempHomePath, { recursive: true, force: true });
  });

  it('returns built-in, Project, then Global sources when no Project config exists', () => {
    const builtInSkillDir = path.join(tempHomePath, 'built-in-skills', 'knowledge-base');

    const plan = resolveSkillSourcePlan(tempProjectPath, {
      builtInSkillDirs: [builtInSkillDir],
      userSkillsDir: path.join(tempHomePath, '.cdf', 'skills'),
    });

    expect(plan.sources.map((source) => source.path)).toEqual([
      builtInSkillDir,
      path.join(tempProjectPath, '.cdf', 'skills'),
      path.join(tempHomePath, '.cdf', 'skills'),
    ]);
    expect(plan.sources.map((source) => source.kind)).toEqual([
      'built-in',
      'project',
      'user',
    ]);
    expect(plan.config).toEqual({ version: 1, additionalSkillDirectories: [] });
    expect(plan.warnings).toEqual([]);
  });

  it('falls back to default config with a warning when Project config is malformed JSON', () => {
    fs.mkdirSync(path.join(tempProjectPath, '.cdf'), { recursive: true });
    fs.writeFileSync(path.join(tempProjectPath, '.cdf', 'skills.config.json'), '{ not json', 'utf-8');

    const plan = resolveSkillSourcePlan(tempProjectPath, {
      builtInSkillDirs: [],
      userSkillsDir: path.join(tempHomePath, '.cdf', 'skills'),
    });

    expect(plan.config).toEqual({ version: 1, additionalSkillDirectories: [] });
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain('skills.config.json');
  });

  it('places Project additional directories after Project Skills and before Global Skills', () => {
    fs.mkdirSync(path.join(tempProjectPath, 'docs', 'skills'), { recursive: true });
    fs.writeFileSync(
      path.join(tempProjectPath, '.cdf', 'skills.config.json'),
      JSON.stringify({ version: 1, additionalSkillDirectories: ['docs/skills'] }),
      'utf-8'
    );

    const plan = resolveSkillSourcePlan(tempProjectPath, {
      builtInSkillDirs: [],
      userSkillsDir: path.join(tempHomePath, '.cdf', 'skills'),
    });

    expect(plan.sources.map((source) => source.path)).toEqual([
      path.join(tempProjectPath, '.cdf', 'skills'),
      path.join(tempProjectPath, 'docs', 'skills'),
      path.join(tempHomePath, '.cdf', 'skills'),
    ]);
    expect(plan.sources.map((source) => source.kind)).toEqual([
      'project',
      'project-additional',
      'user',
    ]);
    expect(plan.config.additionalSkillDirectories).toEqual(['docs/skills']);
    expect(plan.warnings).toEqual([]);
  });

  it('rejects absolute and Project-escaping additional directories', () => {
    const outsideDir = path.join(tempHomePath, 'outside-skills');
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempProjectPath, '.cdf', 'skills.config.json'),
      JSON.stringify({
        version: 1,
        additionalSkillDirectories: [outsideDir, '../outside-skills', 'C:\\outside-skills'],
      }),
      'utf-8'
    );

    const plan = resolveSkillSourcePlan(tempProjectPath, {
      builtInSkillDirs: [],
      userSkillsDir: null,
    });

    expect(plan.sources.map((source) => source.path)).toEqual([
      path.join(tempProjectPath, '.cdf', 'skills'),
    ]);
    expect(plan.warnings).toHaveLength(3);
    expect(plan.warnings.every((warning) => warning.includes('additionalSkillDirectories'))).toBe(true);
  });

  it('warns when additional directories contain non-string entries', () => {
    fs.writeFileSync(
      path.join(tempProjectPath, '.cdf', 'skills.config.json'),
      JSON.stringify({ version: 1, additionalSkillDirectories: ['docs/skills', 42] }),
      'utf-8'
    );

    const plan = resolveSkillSourcePlan(tempProjectPath, {
      builtInSkillDirs: [],
      userSkillsDir: null,
    });

    expect(plan.config.additionalSkillDirectories).toEqual(['docs/skills']);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain('additionalSkillDirectories');
    expect(plan.warnings[0]).toContain('42');
  });

  it('falls back to default config with a warning for unsupported config versions', () => {
    fs.mkdirSync(path.join(tempProjectPath, 'docs', 'skills'), { recursive: true });
    fs.writeFileSync(
      path.join(tempProjectPath, '.cdf', 'skills.config.json'),
      JSON.stringify({ version: 2, additionalSkillDirectories: ['docs/skills'] }),
      'utf-8'
    );

    const plan = resolveSkillSourcePlan(tempProjectPath, {
      builtInSkillDirs: [],
      userSkillsDir: null,
    });

    expect(plan.config).toEqual({ version: 1, additionalSkillDirectories: [] });
    expect(plan.sources.map((source) => source.path)).toEqual([
      path.join(tempProjectPath, '.cdf', 'skills'),
    ]);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain('Unsupported');
    expect(plan.warnings[0]).toContain('skills.config.json');
  });

  it('orders Enterprise sources after Global sources as the highest-priority layer', () => {
    const builtInSkillDir = path.join(tempHomePath, 'built-in-skills', 'knowledge-base');
    const enterpriseSkillsDir = path.join(tempHomePath, 'managed-skills');
    fs.mkdirSync(path.join(tempProjectPath, 'docs', 'skills'), { recursive: true });
    fs.mkdirSync(enterpriseSkillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempProjectPath, '.cdf', 'skills.config.json'),
      JSON.stringify({ version: 1, additionalSkillDirectories: ['docs/skills'] }),
      'utf-8'
    );

    const plan = resolveSkillSourcePlan(tempProjectPath, {
      builtInSkillDirs: [builtInSkillDir],
      userSkillsDir: path.join(tempHomePath, '.cdf', 'skills'),
      enterpriseSkillDirs: [enterpriseSkillsDir],
    });

    expect(plan.sources.map((source) => source.kind)).toEqual([
      'built-in',
      'project',
      'project-additional',
      'user',
      'enterprise',
    ]);
    expect(plan.sources.map((source) => source.path)).toEqual([
      builtInSkillDir,
      path.join(tempProjectPath, '.cdf', 'skills'),
      path.join(tempProjectPath, 'docs', 'skills'),
      path.join(tempHomePath, '.cdf', 'skills'),
      enterpriseSkillsDir,
    ]);
  });
});

describe('resolveSkillCatalog', () => {
  const tempProjectPath = path.join(os.tmpdir(), `cdf-skill-catalog-test-${Math.random().toString(36).slice(2)}`);
  const tempHomePath = path.join(os.tmpdir(), `cdf-skill-catalog-home-${Math.random().toString(36).slice(2)}`);

  beforeEach(() => {
    invalidateSkillSourceCaches();
    fs.rmSync(tempProjectPath, { recursive: true, force: true });
    fs.rmSync(tempHomePath, { recursive: true, force: true });
    fs.mkdirSync(path.join(tempProjectPath, '.cdf', 'skills'), { recursive: true });
    fs.mkdirSync(path.join(tempHomePath, '.cdf', 'skills'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempProjectPath, { recursive: true, force: true });
    fs.rmSync(tempHomePath, { recursive: true, force: true });
  });

  it('keeps the highest-priority same-name Skill from later sources with source attribution', () => {
    const builtInSkillsDir = path.join(tempHomePath, 'built-in-skills');
    const projectSkillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    const userSkillsDir = path.join(tempHomePath, '.cdf', 'skills');
    writeSkill(builtInSkillsDir, 'review', 'Built-in review instructions');
    writeSkill(projectSkillsDir, 'review', 'Project review instructions');
    writeSkill(userSkillsDir, 'review', 'Global review instructions');

    const catalog = resolveSkillCatalog(resolveSkillSourcePlan(tempProjectPath, {
      builtInSkillDirs: [builtInSkillsDir],
      userSkillsDir,
    }));

    expect(catalog.skills).toHaveLength(1);
    expect(catalog.skills[0]).toMatchObject({
      name: 'review',
      description: 'Global review instructions',
      sourceKind: 'user',
      sourcePath: userSkillsDir,
      skillPath: path.join(userSkillsDir, 'review', 'SKILL.md'),
      modelDiscovery: 'full',
      userInvocable: true,
    });
    expect(catalog.skills[0].shadowedSkills).toEqual([
      expect.objectContaining({
        name: 'review', description: 'Built-in review instructions',
        sourceKind: 'built-in', sourcePath: builtInSkillsDir,
      }),
      expect.objectContaining({
        name: 'review', description: 'Project review instructions',
        sourceKind: 'project', sourcePath: projectSkillsDir,
      }),
    ]);
    expect(catalog.warnings).toEqual([]);
  });

  it('reads an individual Skill directory source', () => {
    const builtInSkillDir = path.join(tempHomePath, 'built-in-skills', 'knowledge-base');
    writeSkill(path.dirname(builtInSkillDir), 'knowledge-base', 'Built-in knowledge base instructions');

    const catalog = resolveSkillCatalog(resolveSkillSourcePlan(tempProjectPath, {
      builtInSkillDirs: [builtInSkillDir],
      userSkillsDir: null,
    }));

    expect(catalog.skills).toHaveLength(1);
    expect(catalog.skills[0]).toMatchObject({
      name: 'knowledge-base',
      description: 'Built-in knowledge base instructions',
      sourceKind: 'built-in',
      sourcePath: builtInSkillDir,
      skillPath: path.join(builtInSkillDir, 'SKILL.md'),
    });
    expect(catalog.warnings).toEqual([]);
  });

  it('keeps Project additional same-name Skills beside root Skills with qualified names', () => {
    const projectSkillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    const additionalSkillsDir = path.join(tempProjectPath, 'docs', 'skills');
    fs.mkdirSync(additionalSkillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempProjectPath, '.cdf', 'skills.config.json'),
      JSON.stringify({ version: 1, additionalSkillDirectories: ['docs/skills'] }),
      'utf-8'
    );
    writeSkill(projectSkillsDir, 'review', 'Project root review instructions');
    writeSkill(additionalSkillsDir, 'review', 'Additional review instructions');

    const catalog = resolveSkillCatalog(resolveSkillSourcePlan(tempProjectPath, {
      builtInSkillDirs: [], userSkillsDir: null,
    }));

    expect(catalog.skills).toEqual([
      expect.objectContaining({
        name: 'review', qualifiedName: 'review', description: 'Project root review instructions',
        sourceKind: 'project', sourcePath: projectSkillsDir,
      }),
      expect.objectContaining({
        name: 'review', qualifiedName: 'docs:review', qualifier: 'docs',
        description: 'Additional review instructions', sourceKind: 'project-additional',
        sourcePath: additionalSkillsDir,
      }),
    ]);
    expect(catalog.skills.flatMap((skill) => skill.shadowedSkills ?? [])).toEqual([]);
  });

  it('discovers nested Project Skills as qualified entries alongside root Skills', () => {
    const projectSkillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    const nestedSkillsDir = path.join(tempProjectPath, 'apps', 'web', '.cdf', 'skills');
    writeSkill(projectSkillsDir, 'deploy', 'Deploy the whole project');
    writeSkill(nestedSkillsDir, 'deploy', 'Deploy the web app');

    const catalog = resolveSkillCatalog(resolveSkillSourcePlan(tempProjectPath, {
      builtInSkillDirs: [], userSkillsDir: null, includeNestedProjectSkills: true,
    }), { includeNestedProjectSkills: true });

    expect(catalog.skills).toEqual([
      expect.objectContaining({
        name: 'deploy', qualifiedName: 'deploy', description: 'Deploy the whole project',
        sourceKind: 'project', sourcePath: projectSkillsDir,
      }),
      expect.objectContaining({
        name: 'deploy', qualifiedName: 'apps/web:deploy', qualifier: 'apps/web',
        description: 'Deploy the web app', sourceKind: 'project-nested', sourcePath: nestedSkillsDir,
      }),
    ]);
  });

  it('ranks nested Project Skills above root Skills when path context matches the nested directory', () => {
    const projectSkillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    const nestedSkillsDir = path.join(tempProjectPath, 'apps', 'web', '.cdf', 'skills');
    writeSkill(projectSkillsDir, 'deploy', 'Deploy the whole project');
    writeSkill(nestedSkillsDir, 'deploy', 'Deploy the web app');

    const catalog = resolveSkillCatalog(resolveSkillSourcePlan(tempProjectPath, {
      builtInSkillDirs: [], userSkillsDir: null, includeNestedProjectSkills: true,
    }), { pathContext: ['apps/web/src/App.tsx'], includeNestedProjectSkills: true });

    expect(catalog.skills.map((skill) => skill.qualifiedName)).toEqual(['apps/web:deploy', 'deploy']);
  });

  it('skips nested Project Skill scans inside heavy generated directories', () => {
    const projectSkillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    const ignoredSkillsDir = path.join(tempProjectPath, 'node_modules', 'package', '.cdf', 'skills');
    writeSkill(projectSkillsDir, 'deploy', 'Deploy the whole project');
    writeSkill(ignoredSkillsDir, 'deploy', 'Deploy generated dependency');

    const catalog = resolveSkillCatalog(resolveSkillSourcePlan(tempProjectPath, {
      builtInSkillDirs: [], userSkillsDir: null, includeNestedProjectSkills: true,
    }), { includeNestedProjectSkills: true });

    expect(catalog.skills.map((skill) => skill.qualifiedName)).toEqual(['deploy']);
    expect(catalog.skills[0].sourcePath).toBe(projectSkillsDir);
  });

  it('reuses cached nested Project Skill discovery for rapid repeated source plans', () => {
    const nestedSkillsDir = path.join(tempProjectPath, 'apps', 'web', '.cdf', 'skills');
    writeSkill(nestedSkillsDir, 'deploy', 'Deploy the web app');
    const readdirSpy = vi.spyOn(fs, 'readdirSync');

    const firstPlan = resolveSkillSourcePlan(tempProjectPath, {
      builtInSkillDirs: [], userSkillsDir: null, includeNestedProjectSkills: true,
    });
    readdirSpy.mockClear();
    const secondPlan = resolveSkillSourcePlan(tempProjectPath, {
      builtInSkillDirs: [], userSkillsDir: null, includeNestedProjectSkills: true,
    });

    expect(secondPlan.sources).toEqual(firstPlan.sources);
    expect(readdirSpy).not.toHaveBeenCalled();
  });

  it('returns a warning when a Skill is missing required metadata', () => {
    const skillDir = path.join(tempProjectPath, '.cdf', 'skills', 'broken-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: broken-skill\n---\n\n# Broken Skill', 'utf-8');

    const catalog = resolveSkillCatalog(resolveSkillSourcePlan(tempProjectPath, {
      builtInSkillDirs: [], userSkillsDir: null,
    }));

    expect(catalog.skills).toEqual([]);
    expect(catalog.warnings).toHaveLength(1);
    expect(catalog.warnings[0]).toContain('broken-skill');
    expect(catalog.warnings[0]).toContain('description');
  });

  it('surfaces metadata parser warnings for valid catalog entries', () => {
    const projectSkillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    writeSkill(projectSkillsDir, 'long-description', 'x'.repeat(1100));

    const catalog = resolveSkillCatalog(resolveSkillSourcePlan(tempProjectPath, {
      builtInSkillDirs: [], userSkillsDir: null,
    }));

    expect(catalog.skills[0].description).toHaveLength(1024);
    expect(catalog.warnings.join('\n')).toContain('description');
  });

  it('preserves Skill-authored invocation metadata in the resolved catalog', () => {
    const projectSkillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    writeSkill(projectSkillsDir, 'manual-review', 'Explicit review workflow', [
      'disable-model-invocation: true',
      'user-invocable: true',
    ]);
    writeSkill(projectSkillsDir, 'model-only', 'Model-only workflow', ['user-invocable: false']);

    const catalog = resolveSkillCatalog(resolveSkillSourcePlan(tempProjectPath, {
      builtInSkillDirs: [], userSkillsDir: null,
    }));

    expect(catalog.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'manual-review', modelDiscovery: 'hidden', userInvocable: true }),
      expect.objectContaining({ name: 'model-only', modelDiscovery: 'full', userInvocable: false }),
    ]));
  });
});
