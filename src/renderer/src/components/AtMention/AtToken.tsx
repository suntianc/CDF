// Phase 08.3 — A-02 / C-01 / C-04 / C-06 / F-02
//
// <AtToken> is the inline visual pill rendered by ChatArea's inline-flex
// overlay (Plan 03) and by MessageItem (history) for `@relative/path`
// references. Mirrors Phase 08.1 <SlashToken> visual contract literally:
//   - Same gradient + className palette (visual unity across slash and
//     at-mention pills).
//   - `onMouseDown={(e) => e.preventDefault()}` (C-06) so click-in-token
//     never moves the textarea caret (Phase 08.1 D-04 / SPEC R5).
//   - `contentEditable={false}` defensive attribute.
//   - `data-testid` defaults to 'at-token' and accepts an override.
//
// Differences from <SlashToken>:
//   - Icon: `File` (kind='file') or `Folder` (kind='dir') — NOT a 5-category
//     source dispatch. Lucide exports the 3 icons statically so Tailwind v4
//     static class scan picks them up.
//   - Label: raw `path` string in monospace (NOT Title-Cased — paths are
//     literal, paths look right in monospace).
//   - `data-at-token=""` semantic marker — distinguishes from `data-slash-token=""`.
//   - `data-at-token-kind={kind}` for test assertion + accessibility.
//   - Optional `ignored` prop (F-02): when true, renders AlertTriangle icon
//     + reduced opacity + native HTML `title` tooltip warning the user
//     the path is .gitignore-excluded.

import { AlertTriangle, File, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AtTokenProps {
  /** POSIX relative path. Dir paths conventionally end with '/'. */
  path: string;
  /** Explicit kind (caller infers from `path.endsWith('/')` in Plan 03). */
  kind: 'file' | 'dir';
  /** F-02: when true, render AlertTriangle + opacity-70 + native title tooltip. */
  ignored?: boolean;
  /** Optional test selector override. Defaults to 'at-token'. */
  'data-testid'?: string;
}

export function AtToken({ path, kind, ignored = false, ...rest }: AtTokenProps) {
  const Icon = ignored ? AlertTriangle : kind === 'dir' ? Folder : File;
  const testId = rest['data-testid'] ?? 'at-token';

  return (
    <span
      data-testid={testId}
      data-at-token=""
      data-at-token-kind={kind}
      {...(ignored ? { 'data-at-token-ignored': 'true' as const } : {})}
      contentEditable={false}
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        'inline-flex items-center gap-1 align-middle',
        'rounded-full px-2.5 py-0.5',
        'bg-gradient-to-r from-[var(--color-accent)]/12 to-[var(--color-accent)]/6 border border-[var(--color-accent)]/20',
        'font-semibold text-[var(--color-accent)] text-xs',
        'select-none whitespace-nowrap',
        'pointer-events-auto shadow-sm shadow-[var(--color-accent)]/5',
        ignored && 'opacity-70'
      )}
    >
      {ignored ? (
        <span title="该路径在 .gitignore 中被排除，发送后 LLM 可能读不到">
          <Icon
            className="w-3 h-3 text-[var(--color-accent)]"
            aria-hidden="true"
          />
        </span>
      ) : (
        <Icon
          className="w-3 h-3 text-[var(--color-accent)]"
          aria-hidden="true"
        />
      )}
      <span className="tracking-wide font-mono">{path}</span>
    </span>
  );
}
