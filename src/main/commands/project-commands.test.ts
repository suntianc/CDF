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
        // D-10 defaults are applied even when not declared in frontmatter
        disableModelInvocation: undefined,
        userInvocable: true,
        allowedTools: [],
        whenToUse: '',
        arguments: [],
      });
    });

    it('preserves colons inside values (e.g. URLs)', () => {
      const f = path.join(tempProject, 'url.md');
      fs.writeFileSync(f, '---\ndescription: http://foo.com/bar\n---\n');
      expect(parseFrontmatter(f).description).toBe('http://foo.com/bar');
    });

    // ===== 08.2 P1: 4-field typed frontmatter parsing (D-07 / D-08 / D-10) =====

    it('coerces disable-model-invocation: true to boolean (D-08 yaml@2.9.0)', () => {
      const f = path.join(tempProject, 'bool.md');
      fs.writeFileSync(
        f,
        '---\nname: x\ndisable-model-invocation: true\n---\nbody'
      );
      const fm = parseFrontmatter(f);
      expect(fm.disableModelInvocation).toBe(true);
    });

    it('coerces disable-model-invocation: false to boolean (D-10 default)', () => {
      const f = path.join(tempProject, 'bool-false.md');
      fs.writeFileSync(
        f,
        '---\nname: x\ndisable-model-invocation: false\n---\nbody'
      );
      const fm = parseFrontmatter(f);
      expect(fm.disableModelInvocation).toBe(false);
    });

    it('coerces allowed-tools array correctly (D-08 yaml@2.9.0)', () => {
      const f = path.join(tempProject, 'tools.md');
      fs.writeFileSync(
        f,
        '---\nname: x\nallowed-tools:\n  - Read\n  - Grep\n  - Glob\n---\nbody'
      );
      const fm = parseFrontmatter(f);
      expect(fm.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
    });

    it('parses when_to_use string (D-09 soft hint)', () => {
      const f = path.join(tempProject, 'when.md');
      fs.writeFileSync(
        f,
        '---\nname: x\nwhen_to_use: 用户询问部署相关问题时调用\n---\nbody'
      );
      const fm = parseFrontmatter(f);
      expect(fm.whenToUse).toBe('用户询问部署相关问题时调用');
    });

    it('parses arguments list (D-02 named placeholder declaration)', () => {
      const f = path.join(tempProject, 'args.md');
      fs.writeFileSync(
        f,
        '---\nname: deploy\narguments:\n  - env\n  - flag\n---\nbody'
      );
      const fm = parseFrontmatter(f);
      expect(fm.arguments).toEqual(['env', 'flag']);
    });

    it('applies D-10 defaults when fields are missing', () => {
      const f = path.join(tempProject, 'defaults.md');
      fs.writeFileSync(f, '---\nname: x\n---\nbody');
      const fm = parseFrontmatter(f);
      expect(fm.userInvocable).toBe(true);
      expect(fm.allowedTools).toEqual([]);
      expect(fm.whenToUse).toBe('');
      expect(fm.arguments).toEqual([]);
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
