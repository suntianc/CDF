import type { SlashCommand } from '../../../shared/types';
import { listProjectCommands, listSystemCommands } from '../project-commands';

/**
 * Phase 6 Custom Commands collector.
 *
 * - Thin wrapper over `project-commands.ts` (file IO happens there).
 * - D-21: project listed first so the conflict detector sees the project entry
 *   before the system entry when names collide (D-06 priority makes project
 *   (40) > system (30) in sort, but the `detectConflicts` runs on the raw list
 *   — the project-wins invariant is enforced by ordering).
 */
export async function collectProjectCommands(projectPath: string): Promise<SlashCommand[]> {
  return [...listProjectCommands(projectPath), ...listSystemCommands()];
}
