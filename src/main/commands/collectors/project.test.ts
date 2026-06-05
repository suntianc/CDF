import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock os.homedir to point at a temp dir so listSystemCommands is hermetic.
const tempHome = path.join(os.tmpdir(), `cdf-project-cmd-test-${Math.random().toString(36).slice(2)}`);

const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tempHome);

import { collectProjectCommands } from './project';

describe('collectors/project', () => {
  const projectPath = path.join(tempHome, 'fake-project');

  beforeEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.mkdirSync(tempHome, { recursive: true });
    fs.mkdirSync(path.join(tempHome, '.cdf', 'commands'), { recursive: true });
    fs.mkdirSync(path.join(projectPath, '.cdf', 'commands'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
    homedirSpy.mockClear();
  });

  it('returns [] when both project and system command dirs are empty', async () => {
    const result = await collectProjectCommands(projectPath);
    expect(result).toEqual([]);
  });

  it('parses frontmatter from project command .md files', async () => {
    fs.writeFileSync(
      path.join(projectPath, '.cdf', 'commands', 'review.md'),
      '---\nname: review\ndescription: Review PR\nargument-hint: <branch>\n---\nbody'
    );
    fs.writeFileSync(
      path.join(projectPath, '.cdf', 'commands', 'simplify.md'),
      '---\nname: simplify\ndescription: simplify code\n---\nbody'
    );
    const result = await collectProjectCommands(projectPath);
    const byName = Object.fromEntries(result.map((c) => [c.name, c]));
    expect(byName.review.argumentHint).toBe('<branch>');
    expect(byName.simplify.description).toBe('simplify code');
    expect(result.every((c) => c.source === 'cmd:project')).toBe(true);
  });

  it('falls back to filename (without .md) when name missing from frontmatter', async () => {
    fs.writeFileSync(
      path.join(projectPath, '.cdf', 'commands', 'fallback-name.md'),
      '---\ndescription: no name\n---\nbody'
    );
    const result = await collectProjectCommands(projectPath);
    expect(result[0].name).toBe('fallback-name');
  });

  it('skips non-.md files in the commands directory', async () => {
    fs.writeFileSync(path.join(projectPath, '.cdf', 'commands', 'real.md'), '---\nname: real\n---\n');
    fs.writeFileSync(path.join(projectPath, '.cdf', 'commands', 'notes.txt'), 'ignore me');
    fs.writeFileSync(path.join(projectPath, '.cdf', 'commands', 'README'), 'ignore me');
    const result = await collectProjectCommands(projectPath);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('real');
  });

  it('returns system commands (cmd:system) when present in mocked homedir', async () => {
    fs.writeFileSync(
      path.join(tempHome, '.cdf', 'commands', 'global-cmd.md'),
      '---\nname: global-cmd\ndescription: from system\n---\n'
    );
    const result = await collectProjectCommands(projectPath);
    expect(result.some((c) => c.source === 'cmd:system' && c.name === 'global-cmd')).toBe(true);
  });

  it('places project commands before system commands (D-21 ordering)', async () => {
    fs.writeFileSync(
      path.join(projectPath, '.cdf', 'commands', 'proj-cmd.md'),
      '---\nname: proj-cmd\n---\n'
    );
    fs.writeFileSync(
      path.join(tempHome, '.cdf', 'commands', 'sys-cmd.md'),
      '---\nname: sys-cmd\n---\n'
    );
    const result = await collectProjectCommands(projectPath);
    expect(result.map((c) => c.source)).toEqual(['cmd:project', 'cmd:system']);
  });

  // ===== 08.2 P1: SlashCommand.bodyPath + frontmatter wire (D-05 / D-07 / D-09) =====

  it('D-05: sets bodyPath to the absolute .md file path for project commands', async () => {
    fs.writeFileSync(
      path.join(projectPath, '.cdf', 'commands', 'review.md'),
      '---\nname: review\n---\nbody'
    );
    const result = await collectProjectCommands(projectPath);
    expect(result[0].bodyPath).toBe(
      path.join(projectPath, '.cdf', 'commands', 'review.md')
    );
  });

  it('D-05: sets bodyPath for system commands (cmd:system) too', async () => {
    fs.writeFileSync(
      path.join(tempHome, '.cdf', 'commands', 'global-cmd.md'),
      '---\nname: global-cmd\n---\n'
    );
    const result = await collectProjectCommands(projectPath);
    const sys = result.find((c) => c.source === 'cmd:system');
    expect(sys?.bodyPath).toBe(
      path.join(tempHome, '.cdf', 'commands', 'global-cmd.md')
    );
  });

  it('D-07: sets frontmatter with typed 5-field ParsedFrontmatter', async () => {
    fs.writeFileSync(
      path.join(projectPath, '.cdf', 'commands', 'deploy.md'),
      [
        '---',
        'name: deploy',
        'description: Deploy service',
        'disable-model-invocation: false',
        'user-invocable: true',
        'allowed-tools:',
        '  - Read',
        '  - Bash',
        'when_to_use: 用户询问部署相关问题时调用',
        'arguments:',
        '  - env',
        '  - flag',
        '---',
        'body',
      ].join('\n')
    );
    const result = await collectProjectCommands(projectPath);
    expect(result[0].frontmatter).toEqual({
      disableModelInvocation: false,
      userInvocable: true,
      allowedTools: ['Read', 'Bash'],
      whenToUse: '用户询问部署相关问题时调用',
      arguments: ['env', 'flag'],
    });
  });

  it('D-09: appends when_to_use to description (Claude Code alignment)', async () => {
    fs.writeFileSync(
      path.join(projectPath, '.cdf', 'commands', 'deploy.md'),
      [
        '---',
        'name: deploy',
        'description: Deploy service',
        'when_to_use: 用户询问部署相关问题时调用',
        '---',
        'body',
      ].join('\n')
    );
    const result = await collectProjectCommands(projectPath);
    expect(result[0].description).toContain('Deploy service');
    expect(result[0].description).toContain('何时使用：用户询问部署相关问题时调用');
  });

  it('D-09: does NOT append when_to_use when it is empty (description verbatim)', async () => {
    fs.writeFileSync(
      path.join(projectPath, '.cdf', 'commands', 'plain.md'),
      '---\nname: plain\ndescription: plain command\n---\nbody'
    );
    const result = await collectProjectCommands(projectPath);
    expect(result[0].description).toBe('plain command');
    expect(result[0].description).not.toContain('何时使用');
  });
});
