import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { loadGitignore, toPosix } from './gitignore-loader';

describe('gitignore-loader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-gitignore-test-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('loadGitignore', () => {
    it('accepts a project without .gitignore and still applies defaults', () => {
      const ig = loadGitignore(tempDir);
      expect(ig.ignores('node_modules/foo.js')).toBe(true);
      expect(ig.ignores('src/index.ts')).toBe(false);
    });

    it('reads the project .gitignore and applies its rules', () => {
      fs.writeFileSync(path.join(tempDir, '.gitignore'), '*.log\nbuild/\n!important.log\n');
      const ig = loadGitignore(tempDir);
      expect(ig.ignores('debug.log')).toBe(true);
      expect(ig.ignores('build/output.js')).toBe(true);
      expect(ig.ignores('important.log')).toBe(false);
    });

    it('always applies default excludes even with empty .gitignore', () => {
      fs.writeFileSync(path.join(tempDir, '.gitignore'), '');
      const ig = loadGitignore(tempDir);
      expect(ig.ignores('node_modules')).toBe(true);
      expect(ig.ignores('out')).toBe(true);
      expect(ig.ignores('dist')).toBe(true);
      expect(ig.ignores('.git')).toBe(true);
      expect(ig.ignores('.next')).toBe(true);
      expect(ig.ignores('.cache')).toBe(true);
    });
  });

  describe('toPosix', () => {
    it('converts platform-native separators to POSIX style', () => {
      // On all platforms: toPosix replaces path.sep with '/'.
      // On macOS/Linux (path.sep === '/'), the result equals the input (idempotent).
      // On Windows (path.sep === '\\'), backslashes get converted to forward slashes.
      const input = path.sep === '\\' ? 'foo\\bar\\baz' : 'foo/bar/baz';
      const expected = 'foo/bar/baz';
      expect(toPosix(input)).toBe(expected);
    });

    it('is idempotent on POSIX paths', () => {
      expect(toPosix('foo/bar/baz')).toBe('foo/bar/baz');
      expect(toPosix('a')).toBe('a');
      expect(toPosix('')).toBe('');
    });
  });
});
