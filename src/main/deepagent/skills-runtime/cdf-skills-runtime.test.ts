import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildCdfSkillsRuntime } from './cdf-skills-runtime';
import { invalidateSkillSourceCaches } from './skill-sources';

describe('buildCdfSkillsRuntime', () => {
  const tempProjectPath = path.join(os.tmpdir(), `cdf-skills-runtime-test-${Math.random().toString(36).slice(2)}`);

  beforeEach(() => {
    invalidateSkillSourceCaches();
    fs.rmSync(tempProjectPath, { recursive: true, force: true });
    fs.mkdirSync(path.join(tempProjectPath, '.cdf', 'skills', 'secret-review'), { recursive: true });
    fs.writeFileSync(
      path.join(tempProjectPath, '.cdf', 'skills', 'secret-review', 'SKILL.md'),
      [
        '---',
        'name: secret-review',
        'description: Sensitive trigger text',
        '---',
        '',
        '# Secret Review',
        '',
        'Full secret review instructions',
      ].join('\n'),
      'utf-8'
    );
  });

  afterEach(() => {
    fs.rmSync(tempProjectPath, { recursive: true, force: true });
  });

  it('builds a CDF-owned skills prompt from resolved catalog metadata', () => {
    const runtime = buildCdfSkillsRuntime(tempProjectPath, {
      agentOverrides: {
        'secret-review': 'name-only',
      },
      preloadSkillNames: ['secret-review'],
    });

    expect(runtime.skills).toHaveLength(1);
    expect(runtime.prompt).toContain('secret-review');
    expect(runtime.prompt).toContain('name-only');
    expect(runtime.prompt).not.toContain('Sensitive trigger text');
    expect(runtime.prompt).not.toContain('Full secret review instructions');
    expect(runtime.attributions).toEqual([
      expect.objectContaining({
        phase: 'model-discovery',
        name: 'secret-review',
        qualifiedName: 'secret-review',
        sourceLabel: 'Project Skill',
        visibility: 'name-only',
      }),
    ]);
    expect(runtime.warnings).toEqual([]);
  });

  it('uses a frozen catalog without discovering later Skills and fails explicitly when a preloaded source disappears', () => {
    const skillPath = path.join(tempProjectPath, '.cdf', 'skills', 'secret-review', 'SKILL.md');
    const catalog = [{
      name: 'secret-review',
      qualifiedName: 'secret-review',
      description: 'Captured discovery metadata',
      sourceKind: 'project' as const,
      sourcePath: path.dirname(skillPath),
      skillPath,
      visibility: 'on' as const,
      visibilitySource: 'default' as const,
      modelDiscovery: 'full' as const,
      userInvocable: true,
    }];
    fs.mkdirSync(path.join(tempProjectPath, '.cdf', 'skills', 'later-skill'), { recursive: true });
    fs.writeFileSync(path.join(tempProjectPath, '.cdf', 'skills', 'later-skill', 'SKILL.md'), '---\nname: later-skill\ndescription: Later\n---\n', 'utf-8');

    expect(buildCdfSkillsRuntime(tempProjectPath, { catalog }).skills.map((skill) => skill.name))
      .toEqual(['secret-review']);

    fs.rmSync(skillPath);
    expect(() => buildCdfSkillsRuntime(tempProjectPath, {
      catalog,
      preloadSkillNames: ['secret-review'],
    })).toThrow('Snapshotted Skill source is unavailable (secret-review)');
  });

  it('filters Global Skills by the current Scene without suppressing same-named Project Skills', () => {
    const builtInSkillDir = path.join(tempProjectPath, 'built-in', 'paper-search');
    const userSkillsDir = path.join(tempProjectPath, 'user-skills');
    const projectSkillDir = path.join(tempProjectPath, '.cdf', 'skills', 'shared');
    const userSharedSkillDir = path.join(userSkillsDir, 'shared');
    const userVisibleSkillDir = path.join(userSkillsDir, 'personal-review');
    for (const [skillDir, name, description] of [
      [builtInSkillDir, 'paper-search', 'Research-only Built-in'] as const,
      [projectSkillDir, 'shared', 'Project-owned shared workflow'] as const,
      [userSharedSkillDir, 'shared', 'Disabled Global shared workflow'] as const,
      [userVisibleSkillDir, 'personal-review', 'Visible Global workflow'] as const,
    ]) {
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
        '---',
        `name: ${name}`,
        `description: ${description}`,
        '---',
        '',
        `# ${name}`,
      ].join('\n'), 'utf-8');
    }

    const runtime = buildCdfSkillsRuntime(tempProjectPath, {
      builtInSkillDirs: [builtInSkillDir],
      userSkillsDir,
      userOverrides: { 'personal-review': 'off' },
      sceneId: 'general',
      isGlobalSkillExposed: ({ sourceKind, name }) => !(
        (sourceKind === 'built-in' && name === 'paper-search')
        || (sourceKind === 'user' && name === 'shared')
      ),
    });

    expect(runtime.skills.map((skill) => [skill.name, skill.sourceKind])).toEqual([
      ['secret-review', 'project'],
      ['shared', 'project'],
      ['personal-review', 'user'],
    ]);
    expect(runtime.prompt).not.toContain('paper-search');
    expect(runtime.prompt).toContain('Project-owned shared workflow');
    expect(runtime.prompt).not.toContain('Disabled Global shared workflow');
    expect(runtime.skills.find((skill) => skill.name === 'personal-review')).toMatchObject({
      modelDiscovery: 'full',
      visibilitySource: 'default',
    });
  });

  it('attributes preloaded Skills separately from model discovery', () => {
    const skillDir = path.join(tempProjectPath, '.cdf', 'skills', 'preload-review');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: preload-review',
        'description: Preload review',
        '---',
        '',
        '# Preload Review',
      ].join('\n'),
      'utf-8'
    );

    const runtime = buildCdfSkillsRuntime(tempProjectPath, {
      preloadSkillNames: ['preload-review'],
    });

    expect(runtime.attributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: 'model-discovery',
          qualifiedName: 'preload-review',
        }),
        expect.objectContaining({
          phase: 'preload',
          qualifiedName: 'preload-review',
          sourceLabel: 'Project Skill',
          modelDiscovery: 'full',
        }),
      ])
    );
  });

  it('orders nested Project Skills before root Skills when path context matches', () => {
    const rootSkillDir = path.join(tempProjectPath, '.cdf', 'skills', 'deploy');
    const nestedSkillDir = path.join(tempProjectPath, 'apps', 'web', '.cdf', 'skills', 'deploy');
    fs.mkdirSync(rootSkillDir, { recursive: true });
    fs.mkdirSync(nestedSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(rootSkillDir, 'SKILL.md'),
      [
        '---',
        'name: deploy',
        'description: Deploy the whole project',
        '---',
        '',
        '# Deploy',
      ].join('\n'),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(nestedSkillDir, 'SKILL.md'),
      [
        '---',
        'name: deploy',
        'description: Deploy the web app',
        '---',
        '',
        '# Web Deploy',
      ].join('\n'),
      'utf-8'
    );

    const runtime = buildCdfSkillsRuntime(tempProjectPath, {
      pathContext: ['apps/web/src/App.tsx'],
      includeNestedProjectSkills: true,
    });

    expect(runtime.skills.map((skill) => skill.qualifiedName)).toEqual([
      'apps/web:deploy',
      'deploy',
      'secret-review',
    ]);
    expect(runtime.prompt.indexOf('**apps/web:deploy**')).toBeLessThan(
      runtime.prompt.indexOf('**deploy**')
    );
  });
});
