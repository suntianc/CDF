import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { collectSkillCommands } from './skill';
import { invalidateSkillSourceCaches } from '../../deepagent/skills-runtime/skill-sources';

function writeSkill(skillsDir: string, name: string, description: string): void {
  const skillDir = path.join(skillsDir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    [
      '---',
      `name: ${name}`,
      `description: ${description}`,
      '---',
      '',
      `# ${name}`,
    ].join('\n'),
    'utf-8'
  );
}

describe('collectSkillCommands integration', () => {
  const tempProjectPath = path.join(os.tmpdir(), `cdf-skill-command-test-${Math.random().toString(36).slice(2)}`);

  beforeEach(() => {
    invalidateSkillSourceCaches();
    fs.rmSync(tempProjectPath, { recursive: true, force: true });
    fs.mkdirSync(path.join(tempProjectPath, '.cdf', 'skills'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempProjectPath, { recursive: true, force: true });
  });

  it('returns a unique root Skill as an attributable slash command', async () => {
    const projectSkillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    writeSkill(projectSkillsDir, 'review', 'Review this project');

    const commands = await collectSkillCommands(tempProjectPath);
    const review = commands.find((command) => command.name === 'review');

    expect(review).toMatchObject({
      name: 'review',
      qualifiedName: 'review',
      skillName: 'review',
      skillSourceKind: 'project',
      sourcePath: projectSkillsDir,
      skillPath: path.join(projectSkillsDir, 'review', 'SKILL.md'),
      description: 'Review this project',
      source: 'skill:project',
      target: 'project:review',
      sourceLabel: 'Project Skill',
      badge: '[skill:project]',
    });
  });

  it('lists user-invocable-only Skills and omits off Skills', async () => {
    const projectSkillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    writeSkill(projectSkillsDir, 'manual-review', 'Manual review only');
    writeSkill(projectSkillsDir, 'disabled-review', 'Disabled review');
    fs.writeFileSync(
      path.join(tempProjectPath, '.cdf', 'skills.config.json'),
      JSON.stringify({
        version: 1,
        overrides: {
          'manual-review': 'user-invocable-only',
          'disabled-review': 'off',
        },
        additionalSkillDirectories: [],
      }),
      'utf-8'
    );

    const commands = await collectSkillCommands(tempProjectPath);
    const manual = commands.find((command) => command.name === 'manual-review');

    expect(manual).toMatchObject({
      name: 'manual-review',
      skillVisibility: 'user-invocable-only',
      modelDiscovery: 'hidden',
      userInvocable: true,
    });
    expect(commands.some((command) => command.name === 'disabled-review')).toBe(false);
  });

  it('lists additional-directory same-name Skills side by side with qualified names', async () => {
    const projectSkillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    const webSkillsDir = path.join(tempProjectPath, 'apps', 'web', '.cdf', 'skills');
    writeSkill(projectSkillsDir, 'deploy', 'Deploy the whole project');
    writeSkill(webSkillsDir, 'deploy', 'Deploy the web app');
    fs.writeFileSync(
      path.join(tempProjectPath, '.cdf', 'skills.config.json'),
      JSON.stringify({
        version: 1,
        overrides: {},
        additionalSkillDirectories: ['apps/web/.cdf/skills'],
      }),
      'utf-8'
    );

    const commands = await collectSkillCommands(tempProjectPath);
    const deployCommands = commands
      .filter((command) => command.skillName === 'deploy')
      .sort((a, b) => a.name.localeCompare(b.name));

    expect(deployCommands).toEqual([
      expect.objectContaining({
        name: 'apps/web:deploy',
        qualifiedName: 'apps/web:deploy',
        skillName: 'deploy',
        skillSourceKind: 'project-additional',
        sourcePath: webSkillsDir,
        sourceLabel: 'Project Skill: apps/web',
        target: 'project:apps/web:deploy',
      }),
      expect.objectContaining({
        name: 'deploy',
        qualifiedName: 'deploy',
        skillName: 'deploy',
        skillSourceKind: 'project',
        sourcePath: projectSkillsDir,
        sourceLabel: 'Project Skill',
        target: 'project:deploy',
      }),
    ]);
  });

  it('lists nested Project Skills side by side with root Skills without additional-directory config', async () => {
    const projectSkillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    const webSkillsDir = path.join(tempProjectPath, 'apps', 'web', '.cdf', 'skills');
    writeSkill(projectSkillsDir, 'deploy', 'Deploy the whole project');
    writeSkill(webSkillsDir, 'deploy', 'Deploy the web app');

    const commands = await collectSkillCommands(tempProjectPath);
    const deployCommands = commands
      .filter((command) => command.skillName === 'deploy')
      .sort((a, b) => a.name.localeCompare(b.name));

    expect(deployCommands).toEqual([
      expect.objectContaining({
        name: 'apps/web:deploy',
        qualifiedName: 'apps/web:deploy',
        skillName: 'deploy',
        skillSourceKind: 'project-nested',
        sourcePath: webSkillsDir,
        sourceLabel: 'Nested Project Skill: apps/web',
        target: 'project-nested:apps/web:deploy',
      }),
      expect.objectContaining({
        name: 'deploy',
        qualifiedName: 'deploy',
        skillName: 'deploy',
        skillSourceKind: 'project',
        sourcePath: projectSkillsDir,
        sourceLabel: 'Project Skill',
        target: 'project:deploy',
      }),
    ]);
  });

  it('ranks nested Project Skill slash commands first when path context matches', async () => {
    const projectSkillsDir = path.join(tempProjectPath, '.cdf', 'skills');
    const webSkillsDir = path.join(tempProjectPath, 'apps', 'web', '.cdf', 'skills');
    writeSkill(projectSkillsDir, 'deploy', 'Deploy the whole project');
    writeSkill(webSkillsDir, 'deploy', 'Deploy the web app');

    const commands = await collectSkillCommands(tempProjectPath, {
      pathContext: ['apps/web/src/App.tsx'],
    });
    const deployCommands = commands.filter((command) => command.skillName === 'deploy');

    expect(deployCommands.map((command) => command.name)).toEqual([
      'apps/web:deploy',
      'deploy',
    ]);
  });
});
