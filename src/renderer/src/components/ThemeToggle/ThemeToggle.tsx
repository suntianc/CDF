import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { useState } from 'react';

const themes = [
  { value: 'light' as const, icon: Sun, label: '白天' },
  { value: 'dark' as const, icon: Moon, label: '黑夜' },
  { value: 'system' as const, icon: Monitor, label: '系统' },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const current = themes.find((t) => t.value === theme) || themes[2];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2"
        title={current.label}
        type="button"
      >
        <current.icon className="w-4 h-4" />
        <span className="text-sm">{current.label}</span>
      </button>

      {isOpen && (
        <>
          {/* Backdrop for closing popover */}
          <div
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setIsOpen(false)}
          />
          {/* Dropup options content */}
          <div className="absolute left-0 bottom-full mb-2 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-md shadow-lg py-1 z-50 min-w-[120px] text-xs">
            {themes.map((t) => {
              const Icon = t.icon;
              const isSelected = t.value === theme;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => {
                    setTheme(t.value);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 text-left px-3 py-2 transition-colors cursor-pointer
                    ${isSelected ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)] font-medium' : 'hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)]'}
                  `}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
