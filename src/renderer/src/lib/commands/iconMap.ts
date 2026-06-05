import { Sparkles, GraduationCap, Wrench, Play, Terminal, type LucideIcon } from 'lucide-react';
import type { CommandSource } from '../../../../shared/types';

/**
 * Phase 08.1 — D-02: collapse 7 `CommandSource` types into 5 visual
 * categories for the inline `<SlashToken>` pill.
 *
 * The 7-source discriminator is preserved on `SlashCommand.source` (for the
 * popup badge color) — only the input-layer icon is collapsed:
 *
 *   - `system`                              → `Sparkles`
 *   - `skill:project`  AND  `skill:global`  → `GraduationCap`
 *   - `mcp`                                 → `Wrench`
 *   - `workflow`                            → `Play`
 *   - `cmd:project`   AND  `cmd:system`     → `Terminal`
 *
 * Uses an exhaustive `switch` on `source`. Adding a new variant to the
 * `CommandSource` union in `src/shared/types.ts` will surface as a
 * TypeScript error here, preventing silent fallback.
 */
export function getSlashTokenIcon(source: CommandSource): LucideIcon {
  switch (source) {
    case 'system':
      return Sparkles;
    case 'skill:project':
    case 'skill:global':
      return GraduationCap;
    case 'mcp':
      return Wrench;
    case 'workflow':
      return Play;
    case 'cmd:project':
    case 'cmd:system':
      return Terminal;
  }
}
