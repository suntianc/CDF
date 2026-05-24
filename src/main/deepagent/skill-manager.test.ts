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
    expect(config.skillsSources).toContain('.cdf/skills');
  });
});
