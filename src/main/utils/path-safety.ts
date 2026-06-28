import fs from 'fs';
import path from 'path';

export function isProtectedPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const segments = lower.split('/');
  if (segments.some((s) => s === '.env' || s.startsWith('.env.'))) return true;
  return ['/.git/', '/node_modules/', '/out/', '/dist/'].some((prefix) =>
    lower.includes(prefix)
  );
}

export function resolveProjectFile(projectPath: string, filePath: string): string {
  if (!path.isAbsolute(filePath)) {
    throw new Error(`file_path must be an absolute path: ${filePath}`);
  }

  const segments = filePath.split(path.sep).filter(Boolean);
  if (segments.includes('..') || filePath.startsWith('~')) {
    throw new Error(`Path traversal is not allowed: ${filePath}`);
  }

  let resolved: string;
  const relative = path.relative(projectPath, filePath);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    resolved = filePath;
  } else {
    const virtualPath = path.join(projectPath, filePath.replace(/^[/\\]+/, ''));
    const virtualRelative = path.relative(projectPath, virtualPath);
    if (virtualRelative === '' || virtualRelative.startsWith('..') || path.isAbsolute(virtualRelative)) {
      throw new Error(`Path is outside project: ${filePath}`);
    }
    resolved = virtualPath;
  }

  // Symlink guard: if the path exists, resolve symlinks and verify it stays within project
  try {
    const realProjectPath = fs.realpathSync(projectPath);
    const real = fs.realpathSync(resolved);
    const realRelative = path.relative(realProjectPath, real);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new Error(`Symlink target is outside project: ${filePath}`);
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
    // Path doesn't exist yet (write scenario) — lexical check above is sufficient
  }

  return resolved;
}
