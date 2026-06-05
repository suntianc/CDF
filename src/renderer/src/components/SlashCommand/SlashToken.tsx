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
//   - **HOTFIX 2026-06-05:** `minWidth: ${name.length + 1}ch` (ch unit
//     inherited from the parent textarea's font) makes the pill's
//     visual width exactly equal to the text it replaces
//     (`/goal` = 5 chars in textarea's font). The textarea caret at the
//     end of `inputVal` now lands at the right edge of the pill + the
//     trailing space, NOT inside the pill. `font-size: inherit` keeps
//     the ch unit consistent with the textarea so the calculation
//     stays accurate across both textareas (welcome 15px, composer
//     14px).
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
  // The pill replaces the literal `/<name>` text in the textarea. The
  // `ch` unit is based on the current element's font — by inheriting
  // font-size from the parent (textarea wrapper), `1ch` matches the
  // textarea's per-character width. `+1` accounts for the leading `/`.
  const pillMinWidthCh = name.length + 1;

  return (
    <span
      data-testid={testId}
      data-slash-token=""
      contentEditable={false}
      onMouseDown={(e) => e.preventDefault()}
      style={{ minWidth: `${pillMinWidthCh}ch`, fontSize: 'inherit' }}
      className={cn(
        'inline-flex items-center gap-1 align-middle',
        'rounded-full px-1.5 py-0.5',
        'bg-[var(--color-bg-active)] border border-[var(--color-border)]',
        'font-medium text-[var(--color-text-primary)]',
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
