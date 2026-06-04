import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { Command } from 'cmdk';

const SYSTEM_COMMANDS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '/goal', label: '/goal' },
  { value: '/context', label: '/context' },
  { value: '/plan', label: '/plan' },
];

const filterCommands = (
  query: string,
  items: typeof SYSTEM_COMMANDS
): typeof SYSTEM_COMMANDS => {
  const normalized = query.normalize('NFKC').toLowerCase();
  if (!normalized) return items;
  return items.filter((c) =>
    c.value.normalize('NFKC').toLowerCase().includes(normalized)
  );
};

export interface SlashCommandPopupHandle {
  handleKeyDown: (e: { key: string; preventDefault: () => void }) => boolean;
}

export interface SlashCommandPopupProps {
  query: string;
  onSelect: (command: string) => void;
  onClose: () => void;
}

export const SlashCommandPopup = forwardRef<
  SlashCommandPopupHandle,
  SlashCommandPopupProps
>(({ query, onSelect, onClose }, ref) => {
  const [selectedValue, setSelectedValue] = useState<string>(
    SYSTEM_COMMANDS[0].value
  );

  const filtered = useMemo(
    () => filterCommands(query, SYSTEM_COMMANDS),
    [query]
  );

  useEffect(() => {
    if (filtered[0]) {
      setSelectedValue(filtered[0].value);
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
        const idx = filtered.findIndex((c) => c.value === selectedValue);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedValue(filtered[(idx + 1) % filtered.length].value);
          return true;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedValue(
            filtered[(idx - 1 + filtered.length) % filtered.length].value
          );
          return true;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
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
      label="Slash commands"
      className="w-full"
    >
      <Command.List className="max-h-64 overflow-y-auto p-0">
        {filtered.map((c) => (
          <Command.Item
            key={c.value}
            value={c.value}
            onSelect={() => onSelect(c.value)}
            className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none data-[selected=true]:bg-[var(--color-accent)]/15 data-[selected=true]:text-[var(--color-text-primary)]"
          >
            {c.label}
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
