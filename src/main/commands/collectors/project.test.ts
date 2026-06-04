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
});
