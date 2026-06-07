// Phase 08.3 — A-03 / B-06 / C-04 / F-02
//
// pathUtils is a pure-function utility module shared between the renderer
// `<AtMentionPopup>` (fuzzy filter) and the renderer `<AtToken>` overlay /
// history rendering (relative-path normalization + token parsing).
//
// All exports are pure: no React, no IPC, no fs. The renderer can safely
// import this module without bundling any Node-specific runtime.
//
// Design notes:
//   - VARIATION_SELECTORS / normForFilter are COPIED (not re-exported) from
//     08.1 `SlashCommandPopup.tsx:37-40` to keep the 08.1 file locked.
//     If 08.1 ever drops the local copy, this file becomes the single
//     source of truth (Pitfall #5 / Pitfall #7 — see RESEARCH.md).
//   - getRelativePath uses Node's `path.relative` (available in the renderer
//     through electron-vite's polyfill) + 3-step normalize: backslash-to-
//     forward, strip leading `./`, strip leading `/`.
//   - parseAtTokens uses a lookbehind for `@` at start-of-string or after
//     whitespace — does NOT match email-like `user@host` patterns (T-08.3-05).
//   - isPathIgnored uses the `ignore@5` package (same one Plan 01 uses on
//     main). Pure JS, no native bindings — works in both Node and the
//     renderer build.

import path from 'path';
import ignore from 'ignore';

/**
 * Phase 8 — D-05d: Unicode variation selector removal so `/🎉` and `/🎉︎`
 * (U+FE0F VS16) match identically. Range covers BMP VS1–VS16 and the
 * Variation Selectors Supplement block (U+E0100–U+E01EF). MUST have `gu`
 * flags (PITFALL P8-8: astral plane needs the `u` flag).
 *
 * Copied verbatim from `SlashCommandPopup.tsx:37` (08.1 file is locked).
 */
export const VARIATION_SELECTORS = /[︀-️\u{E0100}-\u{E01EF}]/gu;

/**
 * NFKC + variation-selector strip + lowercase. Used by `<AtMentionPopup>`
 * to match `@café` query against `café` candidate paths (A-03).
 */
export const normForFilter = (s: string): string =>
  s.normalize('NFKC').replace(VARIATION_SELECTORS, '').toLowerCase();

/**
 * Compute a POSIX-relative path from an absolute path + project root.
 *
 * 3-step normalize:
 *   1. `path.relative` — compute the relative path (may contain backslashes on Windows)
 *   2. `.replace(/\\/g, '/')` — convert to forward slashes (Pitfall #5)
 *   3. `.replace(/^\.\//, '')` + `.replace(/^\//, '')` — strip leading `./` and `/`
 *
 * Example: `getRelativePath('/abs/proj/src/foo.ts', '/abs/proj')` → `'src/foo.ts'`
 */
export function getRelativePath(absolutePath: string, projectRoot: string): string {
  return path
    .relative(projectRoot, absolutePath)
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\//, '');
}

export interface AtTokenSpan {
  /** POSIX relative path captured from the text (no leading @). */
  path: string;
  /** Inferred kind: trailing `/` means dir, else file. */
  kind: 'file' | 'dir';
  /** Start offset of the `@` character in the original text. */
  start: number;
  /** End offset of the last path char (exclusive). */
  end: number;
}

/**
 * Scan a text string for `@relative/path` mentions.
 *
 * The regex `(?<=^|\s)@([\w./-]+)` uses a lookbehind to ensure `@` is at
 * start-of-string or after whitespace — this avoids matching email-like
 * `user@host` patterns (T-08.3-05 mitigation).
 *
 * Examples:
 *   `parseAtTokens('hello @src/foo.ts world')`
 *     → [{ path: 'src/foo.ts', kind: 'file', start: 6, end: 17 }]
 *   `parseAtTokens('see @docs/ for more')`
 *     → [{ path: 'docs/', kind: 'dir', start: 4, end: 10 }]
 *   `parseAtTokens('contact me at user@example.com')`
 *     → [] (email pattern, `@` is after a word char — skipped)
 *   `parseAtTokens('plain text')`
 *     → []
 *
 * The regex does NOT match `@` followed by whitespace (empty path) — the
 * popup is still open in that case and the user hasn't typed a path yet.
 */
export function parseAtTokens(text: string): AtTokenSpan[] {
  const regex = /(?<=^|\s)@([\w./-]+)/g;
  const tokens: AtTokenSpan[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const pathText = match[1];
    tokens.push({
      path: pathText,
      kind: pathText.endsWith('/') ? 'dir' : 'file',
      // `start` points AT the `@` character; `end` is exclusive of the last
      // path char. The `+1` in `end` accounts for the `@` prefix length.
      start: match.index,
      end: match.index + 1 + pathText.length,
    });
  }
  return tokens;
}

/**
 * Renderer-side check for the F-02 tooltip: returns `true` if the given
 * relative path is excluded by the project's `.gitignore` rules.
 *
 * Uses the same `ignore@5` package as Plan 01's `loadGitignore()` on main.
 * Pure JS, no native bindings — works in both Node and the renderer build.
 *
 * @param relativePath POSIX-relative path (e.g. `build/app.js`)
 * @param ignoreRules Raw `.gitignore` file CONTENT (a string). Empty string
 *                    or empty relativePath returns `false` (defensive).
 */
export function isPathIgnored(relativePath: string, ignoreRules: string): boolean {
  if (!relativePath || !ignoreRules) return false;
  const ig = ignore();
  ig.add(ignoreRules);
  return ig.ignores(relativePath);
}
