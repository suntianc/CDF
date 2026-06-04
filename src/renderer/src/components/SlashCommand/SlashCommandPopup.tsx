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
import type { SlashCommand } from '../../../../shared/types';

const SYSTEM_COMMANDS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '/goal', label: '/goal' },
  { value: '/context', label: '/context' },
  { value: '/plan', label: '/plan' },
];

const filterCommands = (
  query: string,
  items: ReadonlyArray<SlashCommand>
): SlashCommand[] => {
  const normalized = query.normalize('NFKC').toLowerCase();
  if (!normalized) return items.slice();
  return items.filter((c) => {
    const name = c.name.normalize('NFKC').toLowerCase();
    // Match on the name itself OR the prefixed form `/${name}` so the
    // Phase 5 `//` smoke test still passes (PITFALLS P6c).
    return name.includes(normalized) || ('/' + name).includes(normalized);
  });
};

export interface SlashCommandPopupHandle {
  handleKeyDown: (e: { key: string; preventDefault: () => void }) => boolean;
}

export interface SlashCommandPopupProps {
  query: string;
  onSelect: (command: string) => void;
  onClose: () => void;
  /** Phase 6: optional registry commands (from useCommandRegistry). If undefined, falls back to SYSTEM_COMMANDS for back-compat. */
  commands?: SlashCommand[];
  /** Phase 6: when true, render a gray mcp_health_warning row at the top of the popup (C-02). */
  hasMcpWarning?: boolean;
  /** Phase 6: custom message for the mcp_health_warning row. */
  mcpWarningMessage?: string;
}

export const SlashCommandPopup = forwardRef<
  SlashCommandPopupHandle,
  SlashCommandPopupProps
>(({ query, onSelect, onClose, commands, hasMcpWarning, mcpWarningMessage }, ref) => {
  // Phase 6: when `commands` prop is provided, use it. Otherwise fall back to
  // the Phase 5 SYSTEM_COMMANDS (mapped from `{value, label}` to SlashCommand shape).
  const displayCommands = useMemo<SlashCommand[]>(() => {
    if (commands && commands.length > 0) return commands;
    return SYSTEM_COMMANDS.map((c) => ({
      name: c.value.replace(/^\//, ''),
      description: '',
      source: 'system' as const,
      target: c.value.replace(/^\//, ''),
      sourceLabel: 'system',
      badge: '[system]',
    }));
  }, [commands]);

  const filtered = useMemo(
    () => filterCommands(query, displayCommands),
    [query, displayCommands]
  );

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
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          onSelect('/' + selectedValue);
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
        {filtered.map((c) => (
          <Command.Item
            key={`${c.source}-${c.name}`}
            value={c.name}
            data-source={c.source}
            onSelect={() => onSelect('/' + c.name)}
            className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none data-[selected=true]:bg-[var(--color-accent)]/15 data-[selected=true]:text-[var(--color-text-primary)]"
          >
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">
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
          <div>试试输入 /goal · /context · /plan 查看可用命令</div>
        </Command.Empty>
      </Command.List>
    </Command>
  );
});

SlashCommandPopup.displayName = 'SlashCommandPopup';
