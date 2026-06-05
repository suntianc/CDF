// Phase 08.1 — D-02 / D-04 / D-05 / D-06 / SPEC R1 / R3 / R5
//
// <SlashToken> is the inline visual pill rendered by the ChatArea inline-flex
// layout (Plan 03) BEFORE the textarea. The underlying `inputVal` is sliced
// to show only the tail (args) in the textarea; the full literal
// `/cmd-name args` is reconstructed in ChatArea's onChange. The dispatcher
// contract (`src/renderer/src/lib/commands/dispatcher.ts:resolve()`) is
// unchanged because the underlying state still holds the literal string.
//
// Contract (locked by CONTEXT D-02..D-07):
//   - Renders a <span> (inline context — flex sibling of the textarea).
//   - Icon comes from `getSlashTokenIcon(source)` which collapses the
//     7-source discriminator into 5 icons (D-02):
//       system  → Sparkles
//       skill:project  + skill:global  → GraduationCap
//       mcp     → Wrench
//       workflow → Play
//       cmd:project  + cmd:system  → Terminal
//   - Label comes from `formatTokenLabel(name)` (D-05: gsd-fast → Gsd-Fast).
//   - `onMouseDown={(e) => e.preventDefault()}` blocks any future
//     parent-attached click handlers from moving focus into the pill
//     (D-04 / SPEC R5 — defensive; the inline-flex layout doesn't need
//     this for cursor position, but it preserves the no-edit-in-token
//     guarantee if the pill is ever given a clickable child).
//   - `contentEditable={false}` defensive attribute.
//   - `data-testid` defaults to 'slash-token' and accepts an override
//     for compositional test selectors (SPEC R1).
//   - `data-slash-token=""` semantic marker for any future overlay or
//     accessibility tooling.
//
// Visual: gradient pill with accent color, semibold label, tracking-wide
// for a polished Claude Code-style "command pill" look. The pill is
// a static presentational component — no state, no useEffect, no useRef.
// All Tailwind utility classes are hardcoded (Phase 8 D-01..D-04 invariant:
// Tailwind v4 static class scan).

import { getSlashTokenIcon } from '@/lib/commands/iconMap';
import { formatTokenLabel } from '@/lib/commands/formatTokenLabel';
import { cn } from '@/lib/utils';
import type { CommandSource } from '../../../shared/types';

export interface SlashTokenProps {
  name: string;
  source: CommandSource;
  /** Optional test selector override. Defaults to 'slash-token'. */
  'data-testid'?: string;
}

export function SlashToken({ name, source, ...rest }: SlashTokenProps) {
  const Icon = getSlashTokenIcon(source);
  const testId = rest['data-testid'] ?? 'slash-token';

  return (
    <span
      data-testid={testId}
      data-slash-token=""
      contentEditable={false}
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        'inline-flex items-center gap-1 align-middle',
        'rounded-full px-2.5 py-0.5',
        'bg-gradient-to-r from-[var(--color-accent)]/12 to-[var(--color-accent)]/6 border border-[var(--color-accent)]/20',
        'font-semibold text-[var(--color-accent)] text-xs',
        'select-none whitespace-nowrap',
        'pointer-events-auto shadow-sm shadow-[var(--color-accent)]/5'
      )}
    >
      <Icon
        className="w-3 h-3 text-[var(--color-accent)]"
        aria-hidden="true"
      />
      <span className="tracking-wide">{formatTokenLabel(name)}</span>
    </span>
  );
}
