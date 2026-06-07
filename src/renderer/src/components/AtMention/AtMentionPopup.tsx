// Phase 08.3 — A-02 / A-03 / A-04 / F-03
//
// <AtMentionPopup> is the cmdk + Radix Popover popup rendered when the user
// types `@` in ChatArea. Mirrors the 08.1 <SlashCommandPopup> pattern:
//   - forwardRef + useImperativeHandle to expose `handleKeyDown` so ChatArea
//     can route keyboard events into the popup without losing focus (C-06)
//   - cmdk `<Command>` with shouldFilter={false} (we filter manually so
//     we control the filter algorithm — substring match, not fuzzy scoring)
//   - Up/Down/Enter/Tab/Escape all handled in handleKeyDown
//
// Differences from <SlashCommandPopup>:
//   - candidates is `string[]` (POSIX paths, dir paths end with `/`); kind
//     inferred from trailing slash (no separate `kind` field — same as
//     RESEARCH.md pitfall #4 plan)
//   - onSelect receives a raw path string (no leading `/`)
//   - Tab inserts the selected path (same as Enter — no dispatch concept
//     like slash commands have)
//   - Empty state text is "未找到匹配文件" (F-03)
//
// Threat model (from PLAN.md threat_model):
//   - T-08.3-06: at-tokens in message history are visual hints only — the
//     dispatcher / LLM downstream consumes the literal `@relative/path`
//     text. This component never re-renders untrusted HTML.

import { forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { File, Folder } from 'lucide-react';
import { normForFilter } from '@/lib/commands/pathUtils';
import { cn } from '@/lib/utils';

export interface AtMentionPopupHandle {
  /** Route a KeyboardEvent from the textarea. Returns true if consumed. */
  handleKeyDown: (e: KeyboardEvent) => boolean;
}

export interface AtMentionPopupProps {
  /** Current text after `@` (set by ChatArea onMount / onChange). */
  query: string;
  /** Candidate path strings. Dir paths end with `/`. */
  candidates: string[];
  /** `true` when main returned more than 5000 candidates (E-03). */
  truncated: boolean;
  /** `true` while the IPC call is in flight. */
  loading: boolean;
  /** Enter/Tab on the highlighted row, or click on a row. */
  onSelect: (path: string) => void;
  /** Escape pressed — close the popup. */
  onClose: () => void;
}

export const AtMentionPopup = forwardRef<AtMentionPopupHandle, AtMentionPopupProps>(
  ({ query, candidates, truncated, loading: _loading, onSelect, onClose }, ref) => {
    // Filter candidates by NFKC-normalized substring match (A-03).
    // KISS: substring match (not fuzzy scoring) — matches Phase 8 D-06's
    // "prefix > contains > fuzzy" decision tree at the "contains" level.
    const filtered = useMemo(() => {
      const q = normForFilter(query);
      if (!q) return candidates.slice();
      return candidates.filter((p) => normForFilter(p).includes(q));
    }, [query, candidates]);

    const [selectedValue, setSelectedValue] = useState<string>(
      filtered[0] ?? ''
    );

    // Keep the selected row valid when the filter changes.
    useMemo(() => {
      if (filtered.length > 0 && !filtered.includes(selectedValue)) {
        setSelectedValue(filtered[0]);
      }
    }, [filtered, selectedValue]);

    useImperativeHandle(
      ref,
      () => ({
        handleKeyDown: (e) => {
          if (filtered.length === 0) {
            // No candidates — Escape/Enter/Tab all close the popup.
            if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              onClose();
              return true;
            }
            return false;
          }
          const idx = filtered.findIndex((c) => c === selectedValue);
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedValue(filtered[(idx + 1) % filtered.length]);
            return true;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedValue(
              filtered[(idx - 1 + filtered.length) % filtered.length]
            );
            return true;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            onSelect(selectedValue);
            return true;
          }
          if (e.key === 'Tab') {
            // 08.3: Tab inserts the highlighted path, same as Enter
            // (no dispatch concept like slash commands have).
            e.preventDefault();
            onSelect(selectedValue);
            return true;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
            return true;
          }
          return false;
        },
      }),
      [filtered, selectedValue, onSelect, onClose]
    );

    return (
      <Command
        value={selectedValue}
        onValueChange={setSelectedValue}
        shouldFilter={false}
        label="At mention"
        className="w-full"
      >
        {truncated && (
          <div className="px-2 py-1 text-[10px] text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
            共 5000+ 个文件，已截断显示前 5000 个
          </div>
        )}
        <Command.List className="max-h-64 overflow-y-auto p-0">
          {filtered.map((path) => {
            const isDir = path.endsWith('/');
            const Icon = isDir ? Folder : File;
            return (
              <Command.Item
                key={path}
                value={path}
                onSelect={() => onSelect(path)}
                data-testid="at-mention-item"
                data-at-mention-kind={isDir ? 'dir' : 'file'}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1.5 text-xs cursor-pointer',
                  'aria-selected:bg-[var(--color-bg-active)]'
                )}
              >
                <Icon
                  className="w-3 h-3 text-[var(--color-text-secondary)]"
                  aria-hidden="true"
                />
                <span className="font-mono">{path}</span>
              </Command.Item>
            );
          })}
          <Command.Empty className="px-2 py-2 text-[12px] text-[var(--color-text-muted)]">
            未找到匹配文件
          </Command.Empty>
        </Command.List>
      </Command>
    );
  }
);

AtMentionPopup.displayName = 'AtMentionPopup';
