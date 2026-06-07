import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const themes = [
    { value: 'light' as const, icon: Sun, label: t('theme.light', '浅色模式') },
    { value: 'dark' as const, icon: Moon, label: t('theme.dark', '深色模式') },
    { value: 'system' as const, icon: Monitor, label: t('theme.system', '跟随系统') },
  ];

  const current = themes.find((th) => th.value === theme) || themes[2];

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
            {themes.map((th) => {
              const Icon = th.icon;
              const isSelected = th.value === theme;
              return (
                <button
                  key={th.value}
                  type="button"
                  onClick={() => {
                    setTheme(th.value);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 text-left px-3 py-2 transition-colors cursor-pointer
                    ${isSelected ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)] font-medium' : 'hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)]'}
                  `}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{th.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
