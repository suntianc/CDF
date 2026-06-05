import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getScopePath,
  listPhysicalSkills,
  resolveAgentSkillsConfig,
  savePhysicalSkill,
} from './skill-manager';

describe('skill-manager', () => {
  const tempProjectPath = path.join(os.tmpdir(), `cdf-skill-test-${Math.random().toString(36).slice(2)}`);

  beforeEach(() => {
    fs.rmSync(tempProjectPath, { recursive: true, force: true });
    fs.mkdirSync(tempProjectPath, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempProjectPath, { recursive: true, force: true });
  });

  it('should resolve .cdf skill scope paths', () => {
    expect(getScopePath(tempProjectPath, 'global')).toBe(path.join(os.homedir(), '.cdf', 'skills'));
    expect(getScopePath(tempProjectPath, 'project')).toBe(path.join(tempProjectPath, '.cdf', 'skills'));
  });

  it('should save and list physical skill bundles', () => {
    savePhysicalSkill(tempProjectPath, 'project', {
      name: 'test-js-skill',
      description: 'A JS skill',
      script_type: 'javascript',
      script_content: 'console.log("hello");',
    });

    const skillDir = path.join(tempProjectPath, '.cdf', 'skills', 'test-js-skill');
    expect(fs.existsSync(path.join(skillDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(skillDir, 'main.js'))).toBe(true);

    const skills = listPhysicalSkills(tempProjectPath);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: 'project:test-js-skill',
      name: 'test-js-skill',
      scope: 'project',
      script_type: 'javascript',
      entryScript: 'main.js',
    });
    expect(skills[0].script_content).toBe('console.log("hello");');
  });

  it('should resolve relative deepagents source paths with project taking precedence', () => {
    fs.mkdirSync(path.join(tempProjectPath, '.cdf', 'skills'), { recursive: true });

    const config = resolveAgentSkillsConfig(tempProjectPath);
    expect(config.skillsSources).toContain(path.join(tempProjectPath, '.cdf', 'skills'));
  });

  it('should always load all project skills regardless of enabled list', () => {
    fs.mkdirSync(path.join(tempProjectPath, '.cdf', 'skills', 'enabled-skill'), { recursive: true });
    fs.mkdirSync(path.join(tempProjectPath, '.cdf', 'skills', 'disabled-skill'), { recursive: true });

    const config = resolveAgentSkillsConfig(tempProjectPath, ['project:enabled-skill']);
    // 项目级 skills 始终全量加载，白名单只对全局 skills 生效
    expect(config.skillsSources).toContain(path.join(tempProjectPath, '.cdf', 'skills'));
  });

  it('should not grant host filesystem-wide permissions', () => {
    const config = resolveAgentSkillsConfig(tempProjectPath);
    const paths = config.permissions.flatMap((permission) => permission.paths);

    expect(paths).not.toContain('/**');
    expect(paths).toContain(path.join(tempProjectPath, '*'));
    expect(paths).toContain(path.join(tempProjectPath, '**', '*'));
  });

  // ===== 08.2 P4 D-09: disable-model-invocation + whenToUse enforcement =====

  it('resolveAgentSkillsConfig: skills with disable-model-invocation: true are filtered out (D-09)', () => {
    // Create two skills in project .cdf/skills: one disabled, one enabled
    const skillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    fs.mkdirSync(path.join(skillsDir, 'enabled-skill'), { recursive: true });
    fs.mkdirSync(path.join(skillsDir, 'secret-skill'), { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'enabled-skill', 'SKILL.md'),
      '---\nname: enabled-skill\ndescription: A normal skill\n---\n'
    );
    fs.writeFileSync(
      path.join(skillsDir, 'secret-skill', 'SKILL.md'),
      '---\nname: secret-skill\ndescription: A secret skill\ndisable-model-invocation: true\n---\n'
    );

    const config = resolveAgentSkillsConfig(tempProjectPath);
    const enabledPath = path.join(skillsDir, 'enabled-skill');
    const secretPath = path.join(skillsDir, 'secret-skill');

    expect(config.skillsSources).toContain(enabledPath);
    expect(config.skillsSources).not.toContain(secretPath);
  });

  it('resolveAgentSkillsConfig: skills with disable-model-invocation absent or false are kept (D-10 default)', () => {
    const skillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    fs.mkdirSync(path.join(skillsDir, 'no-frontmatter-skill'), { recursive: true });
    fs.mkdirSync(path.join(skillsDir, 'explicitly-enabled-skill'), { recursive: true });
    // No frontmatter at all — D-10 default: not disabled
    fs.writeFileSync(
      path.join(skillsDir, 'no-frontmatter-skill', 'SKILL.md'),
      '# Just a body, no frontmatter'
    );
    // Explicit disable-model-invocation: false
    fs.writeFileSync(
      path.join(skillsDir, 'explicitly-enabled-skill', 'SKILL.md'),
      '---\nname: explicitly-enabled-skill\ndescription: ok\ndisable-model-invocation: false\n---\n'
    );

    const config = resolveAgentSkillsConfig(tempProjectPath);
    // When no skill is disabled, the parent skills dir is kept (no expansion).
    expect(config.skillsSources).toContain(skillsDir);
  });

  it('listPhysicalSkills: whenToUse is appended to description in the returned view', () => {
    const skillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    fs.mkdirSync(path.join(skillsDir, 'hinted-skill'), { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, 'hinted-skill', 'SKILL.md'),
      '---\nname: hinted-skill\ndescription: A skill with a hint\nwhen_to_use: 当用户提到 cookie 时调用\n---\n'
    );

    const skills = listPhysicalSkills(tempProjectPath);
    const hinted = skills.find((s) => s.name === 'hinted-skill');
    expect(hinted).toBeTruthy();
    expect(hinted?.description).toContain('A skill with a hint');
    expect(hinted?.description).toContain('何时使用：当用户提到 cookie 时调用');
    expect(hinted?.frontmatter?.whenToUse).toBe('当用户提到 cookie 时调用');
  });
});
