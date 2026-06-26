import fs from 'fs';
import path from 'path';
import { isProtectedPath, resolveProjectFile } from '../utils/path-safety';
import { loadGitignore, toPosix } from '../at-mention/gitignore-loader';
import type { DirectoryEntry, FileContent, BinaryFileInfo, FileInfo } from '../../shared/types';

const MAX_TEXT_DETECT_BYTES = 8192;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const LARGE_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function isBinary(buffer: Buffer): boolean {
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

export function readDirectory(
  rootPath: string,
  dirPath: string,
  showHidden = false
): DirectoryEntry[] {
  const resolved = resolveProjectFile(rootPath, dirPath);
  const ig = loadGitignore(rootPath);

  const entries = fs.readdirSync(resolved, { withFileTypes: true });
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
      const stat = fs.statSync(fullPath);
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

export function readFile(
  rootPath: string,
  filePath: string
): FileContent | BinaryFileInfo {
  const resolved = resolveProjectFile(rootPath, filePath);
  const stat = fs.statSync(resolved);

  if (stat.size > MAX_FILE_SIZE) {
    throw { code: 'ETOOLARGE', message: `File exceeds 50MB limit: ${stat.size} bytes` };
  }

  const fd = fs.openSync(resolved, 'r');
  try {
    const detectBuf = Buffer.alloc(Math.min(MAX_TEXT_DETECT_BYTES, stat.size));
    fs.readSync(fd, detectBuf, 0, detectBuf.length, 0);

    if (isBinary(detectBuf)) {
      return { binary: true, size: stat.size, mtimeMs: stat.mtimeMs };
    }
  } finally {
    fs.closeSync(fd);
  }

  const content = fs.readFileSync(resolved, 'utf-8');
  return {
    content,
    encoding: 'utf-8',
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

export function getFileInfo(
  rootPath: string,
  filePath: string
): FileInfo {
  const resolved = resolveProjectFile(rootPath, filePath);
  const stat = fs.lstatSync(resolved);

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

export { isProtectedPath, resolveProjectFile, LARGE_FILE_SIZE };
