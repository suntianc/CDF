import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { isProtectedPath, resolveProjectFile } from '../utils/path-safety';
import { loadGitignore, toPosix } from '../at-mention/gitignore-loader';
import type { DirectoryEntry, FileContent, BinaryFileInfo, FileInfo } from '../../shared/types';
import { runProjectFileMutation } from './project-file-mutation';

const MAX_TEXT_DETECT_BYTES = 8192;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const LARGE_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function isBinary(buffer: Buffer): boolean {
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

export async function readDirectory(
  rootPath: string,
  dirPath: string,
  showHidden = false
): Promise<DirectoryEntry[]> {
  const resolved = resolveProjectFile(rootPath, dirPath);
  const ig = loadGitignore(rootPath);

  const entries = await fsp.readdir(resolved, { withFileTypes: true });
  const result: DirectoryEntry[] = [];

  for (const entry of entries) {
    if (!showHidden && entry.name.startsWith('.')) continue;

    const fullPath = path.join(resolved, entry.name);
    const relPosix = toPosix(path.relative(rootPath, fullPath));
    const checkPath = entry.isDirectory() ? relPosix + '/' : relPosix;
    if (!showHidden && ig.ignores(checkPath)) continue;

    let size: number | undefined;
    let mtimeMs: number | undefined;

    try {
      const stat = await fsp.stat(fullPath);
      size = stat.size;
      mtimeMs = stat.mtimeMs;
    } catch {
      // stat failure — still include the entry
    }

    result.push({
      name: entry.name,
      path: fullPath,
      isDirectory: entry.isDirectory(),
      size,
      mtimeMs,
    });
  }

  result.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return result;
}

export async function readFile(
  rootPath: string,
  filePath: string
): Promise<FileContent | BinaryFileInfo> {
  const resolved = resolveProjectFile(rootPath, filePath);
  const stat = await fsp.stat(resolved);

  if (stat.size > MAX_FILE_SIZE) {
    throw { code: 'ETOOLARGE', message: `File exceeds 50MB limit: ${stat.size} bytes` };
  }

  const fh = await fsp.open(resolved, 'r');
  try {
    const detectBuf = Buffer.alloc(Math.min(MAX_TEXT_DETECT_BYTES, stat.size));
    await fh.read(detectBuf, 0, detectBuf.length, 0);

    if (isBinary(detectBuf)) {
      return { binary: true, size: stat.size, mtimeMs: stat.mtimeMs };
    }
  } finally {
    await fh.close();
  }

  const content = await fsp.readFile(resolved, 'utf-8');
  return {
    content,
    encoding: 'utf-8',
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

export async function getFileInfo(
  rootPath: string,
  filePath: string
): Promise<FileInfo> {
  const resolved = resolveProjectFile(rootPath, filePath);
  const stat = await fsp.lstat(resolved);

  return {
    name: path.basename(resolved),
    path: resolved,
    isDirectory: stat.isDirectory(),
    isSymlink: stat.isSymbolicLink(),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

export async function writeFile(
  rootPath: string,
  filePath: string,
  content: string,
  expectedContent?: string,
): Promise<void> {
  await runProjectFileMutation(rootPath, async () => {
    const resolved = resolveProjectFile(rootPath, filePath);
    if (isProtectedPath(resolved)) {
      throw new Error(`Cannot write to protected path: ${filePath}`);
    }
    if (expectedContent !== undefined) {
      const currentContent = await fsp.readFile(resolved, 'utf-8');
      if (currentContent !== expectedContent) {
        throw Object.assign(
          new Error('File changed on disk before this save could be applied.'),
          { code: 'ECONFLICT' },
        );
      }
    }
    await fsp.writeFile(resolved, content, 'utf-8');
  });
}

export async function createFile(
  rootPath: string,
  filePath: string
): Promise<void> {
  const resolved = resolveProjectFile(rootPath, filePath);
  if (isProtectedPath(resolved)) {
    throw new Error(`Cannot create protected path: ${filePath}`);
  }
  try {
    await fsp.access(resolved);
    throw new Error(`File already exists: ${filePath}`);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }
  await fsp.writeFile(resolved, '', 'utf-8');
}

export async function createDirectory(
  rootPath: string,
  dirPath: string
): Promise<void> {
  const resolved = resolveProjectFile(rootPath, dirPath);
  if (isProtectedPath(resolved)) {
    throw new Error(`Cannot create protected path: ${dirPath}`);
  }
  try {
    await fsp.access(resolved);
    throw new Error(`Directory already exists: ${dirPath}`);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }
  await fsp.mkdir(resolved);
}

export async function renameEntry(
  rootPath: string,
  oldPath: string,
  newName: string
): Promise<void> {
  if (newName.includes('/') || newName.includes('\\') || newName === '..' || newName === '.') {
    throw new Error(`Invalid new name: ${newName}`);
  }
  const resolvedOld = resolveProjectFile(rootPath, oldPath);
  if (isProtectedPath(resolvedOld)) {
    throw new Error(`Cannot rename protected path: ${oldPath}`);
  }
  const newPath = path.join(path.dirname(resolvedOld), newName);
  const resolvedNew = resolveProjectFile(rootPath, newPath);
  if (isProtectedPath(resolvedNew)) {
    throw new Error(`Cannot rename to protected path: ${newName}`);
  }
  try {
    await fsp.access(resolvedNew);
    throw new Error(`Target already exists: ${newName}`);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }
  await fsp.rename(resolvedOld, resolvedNew);
}

export async function trashEntry(
  rootPath: string,
  targetPath: string
): Promise<void> {
  const resolved = resolveProjectFile(rootPath, targetPath);
  if (isProtectedPath(resolved)) {
    throw new Error(`Cannot delete protected path: ${targetPath}`);
  }
  const { shell } = await import('electron');
  await shell.trashItem(resolved);
}

export { isProtectedPath, resolveProjectFile, LARGE_FILE_SIZE };
