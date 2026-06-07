import { ipcMain } from 'electron';
import db from '../database';

import { listCandidates } from './candidate-lister';

/**
 * Phase 08.3 Plan 01 — at-mention IPC handler (E-01, B-01, T-08.3-01)
 *
 * Exposes one IPC channel: `project:listAtMentionCandidates`. The renderer
 * sends a `projectId` (which it picked from `db.getProjects()`), main
 * resolves the project root via DB lookup, then delegates to
 * `listCandidates` (BFS + .gitignore filter) and returns
 * `{ candidates, truncated }`.
 *
 * The DB lookup is the security boundary (ASVS V4): an attacker
 * controlling the renderer cannot enumerate arbitrary FS roots because
 * `project.path` is the only value that ever reaches `listCandidates`.
 *
 * Contract: this handler NEVER throws. All error branches degrade to
 * `{ candidates: [], truncated: false }` so the renderer can render an
 * empty popup without try/catch boilerplate.
 */
export function registerAtMentionHandlers(): void {
  ipcMain.handle('project:listAtMentionCandidates', async (_evt, projectId: string) => {
    try {
      const project = db
        .prepare('SELECT path FROM projects WHERE id = ?')
        .get(projectId) as { path: string } | undefined;
      if (!project) {
        return { candidates: [], truncated: false };
      }
      return listCandidates(project.path);
    } catch (err) {
      console.error('[project:listAtMentionCandidates] failed:', err);
      return { candidates: [], truncated: false };
    }
  });
}
