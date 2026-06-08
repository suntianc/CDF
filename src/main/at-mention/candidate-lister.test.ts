import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { listCandidates } from './candidate-lister';

describe('candidate-lister', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-attest-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns empty result on an empty directory', () => {
    const result = listCandidates(tempDir);
    expect(result).toEqual({ candidates: [], truncated: false });
  });

  it('lists files and directories with kind suffix', () => {
    fs.mkdirSync(path.join(tempDir, 'src'));
    fs.writeFileSync(path.join(tempDir, 'src', 'index.ts'), '// ts');
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Readme');
    fs.mkdirSync(path.join(tempDir, 'docs'));
    fs.writeFileSync(path.join(tempDir, 'docs', 'intro.md'), '# Intro');

    const result = listCandidates(tempDir);
    expect(result.truncated).toBe(false);
    expect(result.candidates).toEqual([
      'README.md',
      'docs/',
      'docs/intro.md',
      'src/',
      'src/index.ts',
    ]);
  });

  it('excludes paths matched by project .gitignore (B-02)', () => {
    fs.writeFileSync(path.join(tempDir, '.gitignore'), '*.log\nbuild/\n');
    fs.writeFileSync(path.join(tempDir, 'debug.log'), 'noise');
    fs.mkdirSync(path.join(tempDir, 'build'));
    fs.writeFileSync(path.join(tempDir, 'build', 'app.js'), '//');
    fs.mkdirSync(path.join(tempDir, 'src'));
    fs.writeFileSync(path.join(tempDir, 'src', 'index.ts'), '//');

    const result = listCandidates(tempDir);
    expect(result.candidates).not.toContain('debug.log');
    expect(result.candidates).not.toContain('build/');
    expect(result.candidates).not.toContain('build/app.js');
    expect(result.candidates).toContain('src/');
    expect(result.candidates).toContain('src/index.ts');
  });

  it('always excludes default artifact dirs even without .gitignore (B-03)', () => {
    // No .gitignore
    fs.mkdirSync(path.join(tempDir, 'node_modules', 'lodash'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'node_modules', 'lodash', 'index.js'), '//');
    fs.mkdirSync(path.join(tempDir, 'out'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'out', 'bundle.js'), '//');
    fs.mkdirSync(path.join(tempDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'dist', 'app.js'), '//');
    fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, '.git', 'HEAD'), '//');
    fs.mkdirSync(path.join(tempDir, '.next'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, '.next', 'cache.txt'), '//');
    fs.mkdirSync(path.join(tempDir, '.cache'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, '.cache', 'data.json'), '{}');
    fs.mkdirSync(path.join(tempDir, 'src'));
    fs.writeFileSync(path.join(tempDir, 'src', 'index.ts'), '//');

    const result = listCandidates(tempDir);
    expect(result.candidates).not.toContain('node_modules/');
    expect(result.candidates).not.toContain('node_modules/lodash/');
    expect(result.candidates).not.toContain('node_modules/lodash/index.js');
    expect(result.candidates).not.toContain('out/');
    expect(result.candidates).not.toContain('out/bundle.js');
    expect(result.candidates).not.toContain('dist/');
    expect(result.candidates).not.toContain('dist/app.js');
    expect(result.candidates).not.toContain('.git/');
    expect(result.candidates).not.toContain('.git/HEAD');
    expect(result.candidates).not.toContain('.next/');
    expect(result.candidates).not.toContain('.next/cache.txt');
    expect(result.candidates).not.toContain('.cache/');
    expect(result.candidates).not.toContain('.cache/data.json');
    // Real source files remain
    expect(result.candidates).toContain('src/');
    expect(result.candidates).toContain('src/index.ts');
  });

  it('enforces MAX_DEPTH = 6 (B-05)', () => {
    // 8 levels of nested directories
    const deepPath = path.join(tempDir, 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8');
    fs.mkdirSync(deepPath, { recursive: true });
    fs.writeFileSync(path.join(deepPath, 'leaf.txt'), 'leaf');

    const result = listCandidates(tempDir);
    // Depths 1-6 should appear
    expect(result.candidates).toContain('d1/');
    expect(result.candidates).toContain('d1/d2/');
    expect(result.candidates).toContain('d1/d2/d3/');
    expect(result.candidates).toContain('d1/d2/d3/d4/');
    expect(result.candidates).toContain('d1/d2/d3/d4/d5/');
    expect(result.candidates).toContain('d1/d2/d3/d4/d5/d6/');
    // Depth 7 and beyond should NOT appear
    expect(result.candidates).not.toContain('d1/d2/d3/d4/d5/d6/d7/');
    expect(result.candidates).not.toContain('d1/d2/d3/d4/d5/d6/d7/d8/');
    expect(result.candidates).not.toContain('d1/d2/d3/d4/d5/d6/d7/d8/leaf.txt');
  });

  it('enforces MAX_COUNT = 5000 and sets truncated = true (B-05/E-03)', { timeout: 30_000 }, () => {
    // Create 5001 files
    for (let i = 0; i < 5001; i++) {
      fs.writeFileSync(path.join(tempDir, `f${i}.txt`), '');
    }
    const result = listCandidates(tempDir);
    expect(result.candidates.length).toBe(5000);
    expect(result.truncated).toBe(true);
  });

  // Phase 08.3 fix #6: symlink-traversal guard.
  it('drops symlink paths that resolve outside the project root', () => {
    // Create an external dir and a symlink inside the project pointing to it.
    const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-external-'));
    try {
      fs.writeFileSync(path.join(externalDir, 'secret.txt'), 'shhh');
      // Symlink at top level of the project.
      try {
        fs.symlinkSync(externalDir, path.join(tempDir, 'outside'), 'dir');
      } catch {
        // Some CI sandboxes (Windows / restricted macOS) refuse symlinks.
        // Skip the test in that case — the runtime path is exercised on
        // macOS / Linux dev where symlinks work normally.
        return;
      }

      const result = listCandidates(tempDir);
      // 1. The symlink directory itself is dropped (it resolves outside
      //    `projectRoot`, so `path.relative` produces `../<basename>`).
      // 2. Any file path that starts with `..` (i.e. would have been
      //    reached through the symlink) is also dropped.
      expect(result.candidates).not.toContain('outside/');
      expect(result.candidates).not.toContain('outside/secret.txt');
      expect(result.candidates.some((c: string) => c.startsWith('..'))).toBe(false);
    } finally {
      if (fs.existsSync(externalDir)) {
        fs.rmSync(externalDir, { recursive: true, force: true });
      }
    }
  });
});
