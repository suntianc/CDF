import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn().mockResolvedValue(undefined) },
}));

import { readDirectory, readFile, getFileInfo, writeFile, createFile, createDirectory, renameEntry, trashEntry } from './file-system';

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
    it('lists files and directories sorted (dirs first)', async () => {
      const entries = await readDirectory(tmpDir, tmpDir);
      const names = entries.map((e) => e.name);
      expect(names[0]).toBe('src');
      expect(names).toContain('hello.ts');
      expect(names).toContain('readme.md');
    });

    it('hides dotfiles by default', async () => {
      const entries = await readDirectory(tmpDir, tmpDir);
      const names = entries.map((e) => e.name);
      expect(names).not.toContain('.hidden');
    });

    it('shows dotfiles when showHidden is true', async () => {
      const entries = await readDirectory(tmpDir, tmpDir, true);
      const names = entries.map((e) => e.name);
      expect(names).toContain('.hidden');
    });

    it('includes size and mtimeMs', async () => {
      const entries = await readDirectory(tmpDir, tmpDir);
      const file = entries.find((e) => e.name === 'hello.ts');
      expect(file).toBeDefined();
      expect(file!.size).toBeGreaterThan(0);
      expect(file!.mtimeMs).toBeGreaterThan(0);
    });

    it('reads subdirectories', async () => {
      const entries = await readDirectory(tmpDir, path.join(tmpDir, 'src'));
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('index.ts');
    });

    it('filters node_modules via gitignore', async () => {
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\n');
      fs.mkdirSync(path.join(tmpDir, 'node_modules'));
      fs.writeFileSync(path.join(tmpDir, 'node_modules', 'pkg.json'), '{}');
      const entries = await readDirectory(tmpDir, tmpDir);
      const names = entries.map((e) => e.name);
      expect(names).not.toContain('node_modules');
    });
  });

  describe('readFile', () => {
    it('reads text file content', async () => {
      const result = await readFile(tmpDir, path.join(tmpDir, 'hello.ts'));
      expect('content' in result).toBe(true);
      if ('content' in result) {
        expect(result.content).toBe('console.log("hello");');
        expect(result.encoding).toBe('utf-8');
      }
    });

    it('detects binary files', async () => {
      const binPath = path.join(tmpDir, 'data.bin');
      const buf = Buffer.alloc(100);
      buf[50] = 0; // null byte
      fs.writeFileSync(binPath, buf);
      const result = await readFile(tmpDir, binPath);
      expect('binary' in result && result.binary).toBe(true);
    });

    it('throws on path traversal', async () => {
      await expect(readFile(tmpDir, '/etc/passwd')).rejects.toThrow();
    });

    it('throws on oversized files', async () => {
      const bigPath = path.join(tmpDir, 'big.dat');
      const fd = fs.openSync(bigPath, 'w');
      fs.ftruncateSync(fd, 51 * 1024 * 1024);
      fs.closeSync(fd);
      await expect(readFile(tmpDir, bigPath)).rejects.toThrow(/50MB/);
    });
  });

  describe('getFileInfo', () => {
    it('returns file info', async () => {
      const info = await getFileInfo(tmpDir, path.join(tmpDir, 'hello.ts'));
      expect(info.name).toBe('hello.ts');
      expect(info.isDirectory).toBe(false);
      expect(info.isSymlink).toBe(false);
      expect(info.size).toBeGreaterThan(0);
    });

    it('returns directory info', async () => {
      const info = await getFileInfo(tmpDir, path.join(tmpDir, 'src'));
      expect(info.name).toBe('src');
      expect(info.isDirectory).toBe(true);
    });

    it('detects symlinks', async () => {
      const linkPath = path.join(tmpDir, 'link.ts');
      fs.symlinkSync(path.join(tmpDir, 'hello.ts'), linkPath);
      const info = await getFileInfo(tmpDir, linkPath);
      expect(info.isSymlink).toBe(true);
    });
  });

  describe('writeFile', () => {
    it('writes content to an existing file', async () => {
      const filePath = path.join(tmpDir, 'hello.ts');
      await writeFile(tmpDir, filePath, 'const x = 1;');
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('const x = 1;');
    });

    it('creates a new file when it does not exist', async () => {
      const filePath = path.join(tmpDir, 'new-file.txt');
      await writeFile(tmpDir, filePath, 'hello');
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello');
    });

    it('rejects a stale compare-and-swap save without overwriting disk content', async () => {
      const filePath = path.join(tmpDir, 'hello.ts');
      await expect(writeFile(tmpDir, filePath, 'stale edit', 'older content')).rejects.toMatchObject({
        code: 'ECONFLICT',
      });
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('console.log("hello");');
    });

    it('rejects path traversal', async () => {
      await expect(writeFile(tmpDir, '/etc/passwd', 'hack')).rejects.toThrow();
    });

    it('rejects protected paths', async () => {
      const envPath = path.join(tmpDir, '.env');
      await expect(writeFile(tmpDir, envPath, 'SECRET=x')).rejects.toThrow(/protected/i);
    });
  });

  describe('createFile', () => {
    it('creates an empty file', async () => {
      const filePath = path.join(tmpDir, 'new.ts');
      await createFile(tmpDir, filePath);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('');
    });

    it('rejects path traversal', async () => {
      await expect(createFile(tmpDir, '/etc/test')).rejects.toThrow();
    });

    it('rejects protected paths', async () => {
      await expect(createFile(tmpDir, path.join(tmpDir, '.env.local'))).rejects.toThrow(/protected/i);
    });

    it('throws if file already exists', async () => {
      const filePath = path.join(tmpDir, 'hello.ts');
      await expect(createFile(tmpDir, filePath)).rejects.toThrow(/exists/i);
    });
  });

  describe('createDirectory', () => {
    it('creates a new directory', async () => {
      const dirPath = path.join(tmpDir, 'new-dir');
      await createDirectory(tmpDir, dirPath);
      expect(fs.statSync(dirPath).isDirectory()).toBe(true);
    });

    it('rejects path traversal', async () => {
      await expect(createDirectory(tmpDir, '/etc/test-dir')).rejects.toThrow();
    });

    it('rejects protected paths', async () => {
      await expect(createDirectory(tmpDir, path.join(tmpDir, '.env'))).rejects.toThrow(/protected/i);
    });

    it('throws if directory already exists', async () => {
      await expect(createDirectory(tmpDir, path.join(tmpDir, 'src'))).rejects.toThrow(/exists/i);
    });
  });

  describe('renameEntry', () => {
    it('renames a file', async () => {
      await renameEntry(tmpDir, path.join(tmpDir, 'hello.ts'), 'renamed.ts');
      expect(fs.existsSync(path.join(tmpDir, 'renamed.ts'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'hello.ts'))).toBe(false);
    });

    it('renames a directory', async () => {
      await renameEntry(tmpDir, path.join(tmpDir, 'src'), 'lib');
      expect(fs.statSync(path.join(tmpDir, 'lib')).isDirectory()).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'src'))).toBe(false);
    });

    it('rejects path traversal', async () => {
      await expect(renameEntry(tmpDir, '/etc/passwd', 'newname')).rejects.toThrow();
    });

    it('rejects traversal in new name', async () => {
      await expect(renameEntry(tmpDir, path.join(tmpDir, 'hello.ts'), '../escape')).rejects.toThrow();
    });

    it('throws if target already exists', async () => {
      await expect(renameEntry(tmpDir, path.join(tmpDir, 'hello.ts'), 'readme.md')).rejects.toThrow(/exists/i);
    });

    it('rejects renaming to protected name', async () => {
      await expect(renameEntry(tmpDir, path.join(tmpDir, 'hello.ts'), '.env')).rejects.toThrow(/protected/i);
    });

    it('allows filenames containing double dots', async () => {
      await renameEntry(tmpDir, path.join(tmpDir, 'hello.ts'), 'backup..old');
      expect(fs.existsSync(path.join(tmpDir, 'backup..old'))).toBe(true);
    });
  });

  describe('trashEntry', () => {
    it('rejects path traversal', async () => {
      await expect(trashEntry(tmpDir, tmpDir + '/../escape')).rejects.toThrow();
    });

    it('rejects protected paths', async () => {
      const envPath = path.join(tmpDir, '.env');
      fs.writeFileSync(envPath, 'SECRET=1');
      await expect(trashEntry(tmpDir, envPath)).rejects.toThrow(/protected/i);
    });

    it('calls shell.trashItem for valid paths', async () => {
      const { shell } = await import('electron');
      vi.mocked(shell.trashItem).mockResolvedValueOnce();
      await trashEntry(tmpDir, path.join(tmpDir, 'hello.ts'));
      expect(shell.trashItem).toHaveBeenCalledWith(path.join(tmpDir, 'hello.ts'));
    });
  });
});
