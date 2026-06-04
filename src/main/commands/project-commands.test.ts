import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tempHome = path.join(os.tmpdir(), `cdf-proj-cmd-parser-test-${Math.random().toString(36).slice(2)}`);
const tempProject = path.join(tempHome, 'fake-project');

const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tempHome);

import {
  listProjectCommands,
  listSystemCommands,
  parseFrontmatter,
} from './project-commands';

describe('project-commands', () => {
  beforeEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.mkdirSync(tempHome, { recursive: true });
    fs.mkdirSync(path.join(tempHome, '.cdf', 'commands'), { recursive: true });
    fs.mkdirSync(path.join(tempProject, '.cdf', 'commands'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
    homedirSpy.mockClear();
  });

  describe('parseFrontmatter', () => {
    it('returns {} for non-existent file', () => {
      expect(parseFrontmatter('/does/not/exist.md')).toEqual({});
    });

    it('returns {} for file without leading ---', () => {
      const f = path.join(tempProject, 'no-fm.md');
      fs.writeFileSync(f, '# No frontmatter here');
      expect(parseFrontmatter(f)).toEqual({});
    });

    it('returns {} for file with start --- but missing closing ---', () => {
      const f = path.join(tempProject, 'broken-fm.md');
      fs.writeFileSync(f, '---\nname: oops\n');
      expect(parseFrontmatter(f)).toEqual({});
    });

    it('parses name/description/argument-hint from valid frontmatter', () => {
      const f = path.join(tempProject, 'good.md');
      fs.writeFileSync(
        f,
        '---\nname: review\ndescription: Review PR\nargument-hint: <branch>\n---\nbody'
      );
      expect(parseFrontmatter(f)).toEqual({
        name: 'review',
        description: 'Review PR',
        'argument-hint': '<branch>',
      });
    });

    it('preserves colons inside values (e.g. URLs)', () => {
      const f = path.join(tempProject, 'url.md');
      fs.writeFileSync(f, '---\ndescription: http://foo.com/bar\n---\n');
      expect(parseFrontmatter(f).description).toBe('http://foo.com/bar');
    });
  });

  describe('listSystemCommands', () => {
    it('returns [] when ~/.cdf/commands/ does not exist', () => {
      fs.rmSync(path.join(tempHome, '.cdf', 'commands'), { recursive: true, force: true });
      expect(listSystemCommands()).toEqual([]);
    });

    it('reads *.md from ~/.cdf/commands/ with source=cmd:system', () => {
      fs.writeFileSync(
        path.join(tempHome, '.cdf', 'commands', 'sys.md'),
        '---\nname: sys-cmd\ndescription: from system\n---\n'
      );
      const result = listSystemCommands();
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('cmd:system');
      expect(result[0].name).toBe('sys-cmd');
      expect(result[0].badge).toBe('[cmd:system]');
    });
  });

  describe('listProjectCommands', () => {
    it('returns [] when <projectPath>/.cdf/commands/ does not exist', () => {
      fs.rmSync(path.join(tempProject, '.cdf', 'commands'), { recursive: true, force: true });
      expect(listProjectCommands(tempProject)).toEqual([]);
    });

    it('reads *.md from <projectPath>/.cdf/commands/ with source=cmd:project', () => {
      fs.writeFileSync(
        path.join(tempProject, '.cdf', 'commands', 'proj.md'),
        '---\nname: proj-cmd\ndescription: from project\n---\n'
      );
      const result = listProjectCommands(tempProject);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('cmd:project');
      expect(result[0].badge).toBe('[cmd:project]');
      expect(result[0].target).toBe(path.join(tempProject, '.cdf', 'commands', 'proj.md'));
    });
  });
});
