import fs from 'fs';
import path from 'path';

import { loadGitignore, toPosix } from './gitignore-loader';

/**
 * Phase 08.3 Plan 01 — candidate-lister (B-04, B-05, E-03)
 *
 * Shallow breadth-first enumeration of files and directories under
 * `projectRoot`, with two hard caps:
 *   - MAX_DEPTH (6):  traverse at most 6 directory levels deep
 *   - MAX_COUNT (5000): stop adding results once we hit 5000 entries
 *
 * The BFS queue avoids stack-overflow risk on deep but narrow directory
 * trees (Pitfall #3 in 08.3-RESEARCH.md). Directories with read-permission
 * errors are silently skipped (chokidar-watcher pattern). The output
 * payload is a `string[]` of relative POSIX paths, with directories
 * suffixed by '/' (pitfall #4 minimal-payload recommendation); the
 * renderer infers `kind` from the trailing '/'.
 */

// Phase 08.3 fix #8+#9+#14: these caps are mirrored in the renderer's
// `MAX_AT_MENTION_CANDIDATES` constant (see `src/shared/types.ts`) and in
// the popup's truncated-banner text. Keep all three in lockstep when
// changing these values.
const MAX_DEPTH = 6;
const MAX_COUNT = 5000;

export interface ListResult {
  /** POSIX-relative paths; directories end with '/', files do not. */
  candidates: string[];
  /** True when MAX_COUNT was reached before the FS walk completed. */
  truncated: boolean;
}

export function listCandidates(projectRoot: string): ListResult {
  const ig = loadGitignore(projectRoot);
  const result: string[] = [];
  let truncated = false;

  // BFS queue — each entry is the absolute dir to scan + the depth at
  // which we entered it (depth 0 = projectRoot itself).
  const queue: Array<{ dir: string; depth: number }> = [{ dir: projectRoot, depth: 0 }];

  // Track outer-loop truncation — once MAX_COUNT is hit we must exit
  // both the inner `for` and the outer `while`.
  outer: while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    if (depth > MAX_DEPTH) continue;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      // Permission denied / broken symlink / ENOENT — skip silently
      // (mirrors chokidar-watcher readdirFallback degradation).
      continue;
    }

    for (const entry of entries) {
      if (result.length >= MAX_COUNT) {
        truncated = true;
        break outer;
      }

      const abs = path.join(dir, entry.name);
      const relPosix = toPosix(path.relative(projectRoot, abs));

      // Phase 08.3 fix #6: drop any path that escapes the project root.
      // (a) Symlinks (files or dirs) — follow them would let `path.relative`
      //     return strings starting with `..` and contradict the
      //     ASVS-V4 security boundary in at-mention-handler.
      // (b) Defensive: any relative path that already starts with `..`
      //     (should not happen after (a) is applied, but guards against
      //     entry names literally named `..`).
      let isSymlink = false;
      try {
        isSymlink = fs.lstatSync(abs).isSymbolicLink();
      } catch {
        // lstat may throw on broken symlinks; treat as a symlink to skip.
        isSymlink = true;
      }
      if (isSymlink) continue;
      if (relPosix === '..' || relPosix.startsWith('../')) continue;

      // B-05: cap at MAX_DEPTH levels of directory nesting. When we
      // are inside a directory at depth === MAX_DEPTH, child entries
      // would be at depth+1 which is past the cap, so we neither list
      // nor enqueue them. Files are always listed (the cap applies to
      // nesting depth, not to leaf files at any level).
      if (depth === MAX_DEPTH) {
        if (entry.isFile()) {
          const checkPath = relPosix;
          if (!ig.ignores(checkPath)) result.push(checkPath);
        }
        continue;
      }

      // ignore@5 matches directories only when the path has a trailing '/'.
      // For files we pass the bare relative path.
      const checkPath = entry.isDirectory() ? relPosix + '/' : relPosix;
      if (ig.ignores(checkPath)) continue;

      result.push(checkPath);

      if (entry.isDirectory()) {
        queue.push({ dir: abs, depth: depth + 1 });
      }
    }
  }

  return { candidates: result.sort(), truncated };
}
