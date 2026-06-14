import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { Command } from 'cmdk';
import { AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { SlashCommand, CommandSource } from '../../../../shared/types';

const SYSTEM_COMMANDS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '/goal', label: '/goal' },
  { value: '/context', label: '/context' },
];

// Phase 8 — D-01..D-04: 7-color source badge palette (VS Code Dark+ style).
// Static string literals (Tailwind v4 static class scan [VERIFIED: tailwindcss.com]).
// D-02: text color only — no background/border change. D-04: no new CSS vars.
const SOURCE_TEXT_COLOR: Record<CommandSource, string> = {
  'system': 'text-blue-400',
  'skill:global': 'text-violet-300',
  'skill:project': 'text-purple-400',
  'workflow': 'text-green-400',
  'mcp': 'text-amber-400',
  'cmd:system': 'text-[var(--color-text-muted)]',
  'cmd:project': 'text-[var(--color-text-secondary)]',
};

// Phase 8 — D-05d: Unicode variation selector removal so `/🎉` and `/🎉︎`
// (U+FE0F VS16) match identically. Range covers BMP VS1–VS16 and the
// Variation Selectors Supplement block (U+E0100–U+E01EF). MUST have `gu`
// flags (PITFALL P8-8: astral plane needs the `u` flag).
const VARIATION_SELECTORS = /[︀-️\u{E0100}-\u{E01EF}]/gu;

const normForFilter = (s: string): string =>
  s.normalize('NFKC').replace(VARIATION_SELECTORS, '').toLowerCase();

export interface SlashCommandPopupHandle {
  handleKeyDown: (e: { key: string; preventDefault: () => void }) => boolean;
}

export interface SlashCommandPopupProps {
  query: string;
  /** Enter: dispatch/send the highlighted command (Phase 6 default behavior). */
  onSelect: (command: string) => void;
  /**
   * Tab: insert the highlighted command into the textarea (cmd + ' ') without
   * firing the dispatcher. v1.1 polish — keeps the user in the composer
   * to add args before sending. Falls back to onSelect if not provided
   * (so older call sites keep their existing Enter-or-Tab-sends behavior).
   */
  onInsert?: (command: string) => void;
  onClose: () => void;
  /** Phase 6: optional registry commands (from useCommandRegistry). If undefined, falls back to SYSTEM_COMMANDS for back-compat. */
  commands?: SlashCommand[];
  /** Phase 6: when true, render a gray mcp_health_warning row at the top of the popup (C-02). */
  hasMcpWarning?: boolean;
  /** Phase 6: custom message for the mcp_health_warning row. */
  mcpWarningMessage?: string;
  /** Phase 8 — D-09: when 'slow', render a 1-row Skeleton at the top of Command.List (D-08/D-12). The 'slow' state is set by useCommandRegistry after 500ms of pending commands:list IPC (D-07). */
  loading?: 'idle' | 'pending' | 'slow' | 'ready' | 'error';
}

export const SlashCommandPopup = forwardRef<
  SlashCommandPopupHandle,
  SlashCommandPopupProps
>(({ query, onSelect, onInsert, onClose, commands, hasMcpWarning, mcpWarningMessage, loading }, ref) => {
  // Phase 6: when `commands` prop is provided, use it. Otherwise fall back to
  // the Phase 5 SYSTEM_COMMANDS (mapped from `{value, label}` to SlashCommand shape).
  const displayCommands = useMemo<SlashCommand[]>(() => {
    let base: SlashCommand[];
    if (commands && commands.length > 0) {
      base = commands;
    } else {
      base = SYSTEM_COMMANDS.map((c) => ({
        name: c.value.replace(/^\//, ''),
        description: '',
        source: 'system' as const,
        target: c.value.replace(/^\//, ''),
        sourceLabel: 'system',
        badge: '[system]',
      }));
    }
    // 08.2 D-09: filter out commands declared as non-invocable by users
    // (frontmatter `user-invocable: false`). Missing frontmatter defaults
    // to invocable (true) per D-10.
    // 08.2 polish: also filter out commands that opted into `hideFromPopup`
    // (system commands whose primary entry is a persistent UI button, e.g.
    // `<ContextButton>` for /context). Slash input still dispatches via the
    // dispatcher; this only affects popup visibility.
    return base.filter(
      (c) => c.frontmatter?.userInvocable !== false && !c.hideFromPopup
    );
  }, [commands]);

  // Phase 8 — D-06: pre-normalize every command name into a Map so the
  // per-keystroke filter is O(1) per item (Map.get) instead of re-running
  // NFKC + variation-selector stripping on every keystroke × N items.
  const normalizedMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of displayCommands) {
      m.set(c.name, normForFilter(c.name));
    }
    return m;
  }, [displayCommands]);

  const filtered = useMemo(() => {
    const normalizedQuery = normForFilter(query);
    if (!normalizedQuery) return displayCommands.slice();
    return displayCommands.filter((c) => {
      // Fallback to a direct normForFilter call if a command name was added
      // since the last normalizedMap rebuild (defensive — should not normally
      // happen because displayCommands is the upstream dependency).
      const name = normalizedMap.get(c.name) ?? normForFilter(c.name);
      return (
        name.includes(normalizedQuery) ||
        ('/' + name).includes(normalizedQuery)
      );
    });
  }, [query, displayCommands, normalizedMap]);

  const [selectedValue, setSelectedValue] = useState<string>(
    filtered[0]?.name ?? displayCommands[0]?.name ?? ''
  );

  useEffect(() => {
    if (filtered[0]) {
      setSelectedValue(filtered[0].name);
    }
  }, [query, filtered]);

  useImperativeHandle(
    ref,
    () => ({
      handleKeyDown: (e) => {
        if (filtered.length === 0) {
          if (
            e.key === 'Escape' ||
            e.key === 'Enter' ||
            e.key === 'Tab'
          ) {
            e.preventDefault();
            onClose();
            return true;
          }
          return false;
        }
        const idx = filtered.findIndex((c) => c.name === selectedValue);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedValue(filtered[(idx + 1) % filtered.length].name);
          return true;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedValue(
            filtered[(idx - 1 + filtered.length) % filtered.length].name
          );
          return true;
        }
        if (e.key === 'Enter') {
          // Enter: same as Tab — insert the command as a capsule and let the
          // user type args. handleSend dispatches when Enter is pressed again.
          e.preventDefault();
          (onInsert ?? onSelect)('/' + selectedValue);
          return true;
        }
        if (e.key === 'Tab') {
          // Tab: insert the highlighted command into the textarea with a
          // trailing space (so the user can keep typing args). v1.1 polish —
          // previously Tab was treated identically to Enter, which was
          // confusing because users expected Tab to "fill in" the command
          // (like shell completion) and then let them review/edit before
          // pressing Enter to actually send.
          e.preventDefault();
          (onInsert ?? onSelect)('/' + selectedValue);
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
    [filtered, selectedValue, onSelect, onInsert, onClose]
  );

  // IME z-index known issue (D-13..D-15, accepted as platform limitation):
  // macOS IME candidate windows (Pinyin/Hiragana/Kana) render in a separate
  // NSPanel at NSPopUpMenuWindowLevel (~101), which sits above any web-layer
  // z-index. PopoverContent uses z-50 (from popover.tsx), but web-layer
  // z-index cannot escape the NSWindow boundary. There is no Chromium/Electron
  // API to render above the IME panel (as of 2026-06-04).
  // Workaround: press Esc once to dismiss the IME candidate; the popup
  // remains visible underneath. Tracked for v1.2 if Apple ships an
  // IMKCandidates placement API.
  return (
    <Command
      value={selectedValue}
      onValueChange={setSelectedValue}
      shouldFilter={false}
      label="Slash commands"
      className="w-full"
    >
      <Command.List className="max-h-64 overflow-y-auto p-0">
        {hasMcpWarning && (
          <div
            data-testid="mcp-health-warning"
            className="px-2 py-1.5 text-[11px] text-[var(--color-text-muted)] bg-[var(--color-bg-surface)] border-b border-[var(--color-border)] flex items-center gap-2 select-none"
          >
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            <span>{mcpWarningMessage || 'MCP 工具未加载，请检查服务器连接'}</span>
          </div>
        )}
        {loading === 'slow' && (
          <Command.Loading>
            <div
              data-testid="mcp-skeleton"
              className="flex items-center gap-2 px-2 py-1.5 select-none"
            >
              <Skeleton className="h-3 w-12 rounded" />
              <Skeleton className="h-3 w-24 rounded" />
            </div>
          </Command.Loading>
        )}
        {filtered.map((c) => (
          <Command.Item
            key={`${c.source}-${c.name}`}
            value={c.name}
            data-source={c.source}
            onSelect={() => onSelect('/' + c.name)}
            className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none data-[selected=true]:bg-[var(--color-accent)]/15 data-[selected=true]:text-[var(--color-text-primary)]"
          >
            <Badge
              variant="secondary"
              className={cn(
                'text-[10px] px-1.5 py-0 font-mono',
                SOURCE_TEXT_COLOR[c.source]
              )}
            >
              {c.badge}
            </Badge>
            <span className="font-mono">/{c.name}</span>
            {c.source !== 'mcp' && c.description && (
              <span className="text-[11px] text-[var(--color-text-muted)] truncate max-w-[200px]">
                {c.description.slice(0, 60)}
              </span>
            )}
          </Command.Item>
        ))}
        <Command.Empty className="px-2 py-2 text-[12px] text-[var(--color-text-muted)]">
          <div>无匹配命令</div>
          <div>试试输入 /goal · /context 查看可用命令</div>
        </Command.Empty>
      </Command.List>
    </Command>
  );
});

SlashCommandPopup.displayName = 'SlashCommandPopup';
