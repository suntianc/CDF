import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readDirectory, readFile, getFileInfo } from './file-system';

describe('FileSystemService', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-fs-test-'));
    fs.writeFileSync(path.join(tmpDir, 'hello.ts'), 'console.log("hello");');
    fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# Hello');
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), 'export {};');
    fs.writeFileSync(path.join(tmpDir, '.hidden'), 'secret');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('readDirectory', () => {
    it('lists files and directories sorted (dirs first)', () => {
      const entries = readDirectory(tmpDir, tmpDir);
      const names = entries.map((e) => e.name);
      expect(names[0]).toBe('src');
      expect(names).toContain('hello.ts');
      expect(names).toContain('readme.md');
    });

    it('hides dotfiles by default', () => {
      const entries = readDirectory(tmpDir, tmpDir);
      const names = entries.map((e) => e.name);
      expect(names).not.toContain('.hidden');
    });

    it('shows dotfiles when showHidden is true', () => {
      const entries = readDirectory(tmpDir, tmpDir, true);
      const names = entries.map((e) => e.name);
      expect(names).toContain('.hidden');
    });

    it('includes size and mtimeMs', () => {
      const entries = readDirectory(tmpDir, tmpDir);
      const file = entries.find((e) => e.name === 'hello.ts');
      expect(file).toBeDefined();
      expect(file!.size).toBeGreaterThan(0);
      expect(file!.mtimeMs).toBeGreaterThan(0);
    });

    it('reads subdirectories', () => {
      const entries = readDirectory(tmpDir, path.join(tmpDir, 'src'));
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('index.ts');
    });

    it('filters node_modules via gitignore', () => {
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\n');
      fs.mkdirSync(path.join(tmpDir, 'node_modules'));
      fs.writeFileSync(path.join(tmpDir, 'node_modules', 'pkg.json'), '{}');
      const entries = readDirectory(tmpDir, tmpDir);
      const names = entries.map((e) => e.name);
      expect(names).not.toContain('node_modules');
    });
  });

  describe('readFile', () => {
    it('reads text file content', () => {
      const result = readFile(tmpDir, path.join(tmpDir, 'hello.ts'));
      expect('content' in result).toBe(true);
      if ('content' in result) {
        expect(result.content).toBe('console.log("hello");');
        expect(result.encoding).toBe('utf-8');
      }
    });

    it('detects binary files', () => {
      const binPath = path.join(tmpDir, 'data.bin');
      const buf = Buffer.alloc(100);
      buf[50] = 0; // null byte
      fs.writeFileSync(binPath, buf);
      const result = readFile(tmpDir, binPath);
      expect('binary' in result && result.binary).toBe(true);
    });

    it('throws on path traversal', () => {
      expect(() => readFile(tmpDir, '/etc/passwd')).toThrow();
    });

    it('throws on oversized files', () => {
      const bigPath = path.join(tmpDir, 'big.dat');
      const fd = fs.openSync(bigPath, 'w');
      fs.ftruncateSync(fd, 51 * 1024 * 1024);
      fs.closeSync(fd);
      expect(() => readFile(tmpDir, bigPath)).toThrow(/50MB/);
    });
  });

  describe('getFileInfo', () => {
    it('returns file info', () => {
      const info = getFileInfo(tmpDir, path.join(tmpDir, 'hello.ts'));
      expect(info.name).toBe('hello.ts');
      expect(info.isDirectory).toBe(false);
      expect(info.isSymlink).toBe(false);
      expect(info.size).toBeGreaterThan(0);
    });

    it('returns directory info', () => {
      const info = getFileInfo(tmpDir, path.join(tmpDir, 'src'));
      expect(info.name).toBe('src');
      expect(info.isDirectory).toBe(true);
    });

    it('detects symlinks', () => {
      const linkPath = path.join(tmpDir, 'link.ts');
      fs.symlinkSync(path.join(tmpDir, 'hello.ts'), linkPath);
      const info = getFileInfo(tmpDir, linkPath);
      expect(info.isSymlink).toBe(true);
    });
  });
});
