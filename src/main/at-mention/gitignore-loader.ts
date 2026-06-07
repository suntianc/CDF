import ignore from 'ignore';
import fs from 'fs';
import path from 'path';

/**
 * Phase 08.3 Plan 01 — gitignore-loader (B-01..B-03, E-04)
 *
 * Factory that returns an `ignore@5` rule instance loaded from the
 * project's root `.gitignore`, plus a hardcoded set of default excludes
 * (B-03) that are applied even when the project has no `.gitignore`.
 *
 * The default excludes are common artifact / dependency directories that
 * should never appear in @-mention candidate lists, regardless of what
 * the project chose to commit or ignore.
 */

const DEFAULT_IGNORED = ['node_modules', 'out', 'dist', '.git', '.next', '.cache'];

export function loadGitignore(projectRoot: string): ReturnType<typeof ignore> {
  const ig = ignore();
  const rootGitignore = path.join(projectRoot, '.gitignore');
  if (fs.existsSync(rootGitignore)) {
    ig.add(fs.readFileSync(rootGitignore, 'utf-8'));
  }
  ig.add(DEFAULT_IGNORED);
  return ig;
}

/**
 * Convert a platform-native path to POSIX style by replacing the OS
 * separator (`path.sep`) with '/'. This is required for `ignore@5` which
 * only understands forward-slash paths (Pitfall #10 in 08.3-RESEARCH.md).
 */
export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}
