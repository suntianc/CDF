// Phase 08.1 — D-02 / D-04 / D-05 / D-06 / SPEC R1 / R3 / R5
//
// <SlashToken> is the inline visual pill rendered by the ChatArea overlay
// (Plan 03) in place of the leading `/cmd-name` text. The underlying
// `inputVal` remains the literal string so the dispatcher contract
// (`src/renderer/src/lib/commands/dispatcher.ts:resolve()`) is unchanged;
// only the visual surface is replaced.
//
// Contract (locked by CONTEXT D-02..D-07):
//   - Renders a <span> (NOT a <div> — inline context required so the
//     overlay can flow plain text around the pill).
//   - Icon comes from `getSlashTokenIcon(source)` which collapses the
//     7-source discriminator into 5 icons (D-02):
//       system  → Sparkles
//       skill:project  + skill:global  → GraduationCap
//       mcp     → Wrench
//       workflow → Play
//       cmd:project  + cmd:system  → Terminal
//   - Label comes from `formatTokenLabel(name)` (D-05: gsd-fast → Gsd-Fast).
//   - `onMouseDown={(e) => e.preventDefault()}` blocks the textarea
//     caret from entering the token (D-04 / SPEC R5).
//   - `pointer-events-auto` overrides the overlay parent's
//     `pointer-events-none` (Plan 03) so the onMouseDown handler can fire.
//     Without this, the click would pass through to the textarea and
//     the caret would land inside the token — the SPEC R5 violation
//     this component exists to prevent.
//   - `contentEditable={false}` defensive attribute (in case the parent
//     accidentally renders inside a contentEditable region).
//   - `data-testid` defaults to 'slash-token' and accepts an override
//     for compositional test selectors (SPEC R1).
//   - `data-slash-token=""` semantic marker for the overlay in Plan 03.
//
// This is a pure presentational component — no state, no useEffect, no
// useRef. All Tailwind utility classes are hardcoded (Phase 8 D-01..D-04
// invariant: Tailwind v4 static class scan).

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
        'rounded-full px-1.5 py-0.5',
        'bg-[var(--color-bg-active)] border border-[var(--color-border)]',
        'text-[11px] font-medium text-[var(--color-text-primary)]',
        'select-none whitespace-nowrap',
        'mx-0.5',
        'pointer-events-auto'
      )}
    >
      <Icon
        className="w-3 h-3 text-[var(--color-text-secondary)]"
        aria-hidden="true"
      />
      <span>{formatTokenLabel(name)}</span>
    </span>
  );
}
