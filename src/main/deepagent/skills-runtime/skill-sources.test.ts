import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  invalidateSkillSourceCaches,
  resolveSkillCatalog,
  resolveSkillSourcePlan,
} from './skill-sources';

function writeSkill(skillsDir: string, name: string, description: string, frontmatter = ''): void {
  const skillDir = path.join(skillsDir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    frontmatter,
    '---',
    '',
    `# ${name}`,
  ].filter(Boolean).join('\n'), 'utf-8');
}

describe('Project Skill scope', () => {
  const projectPath = path.join(os.tmpdir(), `cdf-skill-source-${Math.random().toString(36).slice(2)}`);
  const globalPath = path.join(os.tmpdir(), `cdf-global-skill-${Math.random().toString(36).slice(2)}`);

  beforeEach(() => {
    invalidateSkillSourceCaches();
    fs.rmSync(projectPath, { recursive: true, force: true });
    fs.rmSync(globalPath, { recursive: true, force: true });
    fs.mkdirSync(path.join(projectPath, '.cdf', 'skills'), { recursive: true });
    fs.mkdirSync(globalPath, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectPath, { recursive: true, force: true });
    fs.rmSync(globalPath, { recursive: true, force: true });
  });

  it('reads only supported project skill configuration fields', () => {
    fs.mkdirSync(path.join(projectPath, 'docs', 'skills'), { recursive: true });
    fs.writeFileSync(path.join(projectPath, '.cdf', 'skills.config.json'), JSON.stringify({
      version: 1,
      additionalSkillDirectories: ['docs/skills'],
    }), 'utf-8');

    const plan = resolveSkillSourcePlan(projectPath, {
      builtInSkillDirs: [],
      userSkillsDir: globalPath,
    });

    expect(plan.config).toEqual({ version: 1, additionalSkillDirectories: ['docs/skills'] });
    expect(plan.sources.map((source) => source.kind)).toEqual(['project', 'project-additional', 'user']);
  });

  it('keeps same-name Project Skills alongside their qualified additional-directory fallback', () => {
    const rootSkills = path.join(projectPath, '.cdf', 'skills');
    const docsSkills = path.join(projectPath, 'docs', 'skills');
    writeSkill(rootSkills, 'review', 'Review the entire project');
    writeSkill(docsSkills, 'review', 'Review documentation');
    fs.writeFileSync(path.join(projectPath, '.cdf', 'skills.config.json'), JSON.stringify({
      version: 1,
      additionalSkillDirectories: ['docs/skills'],
    }), 'utf-8');

    const catalog = resolveSkillCatalog(resolveSkillSourcePlan(projectPath, {
      builtInSkillDirs: [],
      userSkillsDir: null,
    }));

    expect(catalog.skills.map((skill) => skill.qualifiedName)).toEqual(['review', 'docs:review']);
    expect(catalog.skills.map((skill) => skill.description)).toEqual([
      'Review the entire project',
      'Review documentation',
    ]);
  });

  it('uses Skill-authored invocation frontmatter without changing Project scope', () => {
    const rootSkills = path.join(projectPath, '.cdf', 'skills');
    writeSkill(rootSkills, 'manual-review', 'Review only when explicitly requested', 'disable-model-invocation: true\nuser-invocable: true');

    const catalog = resolveSkillCatalog(resolveSkillSourcePlan(projectPath, {
      builtInSkillDirs: [],
      userSkillsDir: null,
    }));

    expect(catalog.skills[0]).toMatchObject({
      name: 'manual-review',
      sourceKind: 'project',
      modelDiscovery: 'hidden',
      userInvocable: true,
    });
  });
});
