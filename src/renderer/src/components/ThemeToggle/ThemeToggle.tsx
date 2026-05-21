import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

const themes = [
  { value: 'light' as const, icon: Sun, label: '浅色' },
  { value: 'dark' as const, icon: Moon, label: '深色' },
  { value: 'system' as const, icon: Monitor, label: '跟随系统' },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const current = themes.find((t) => t.value === theme) || themes[2];
  const nextIndex = (themes.findIndex((t) => t.value === theme) + 1) % themes.length;
  const next = themes[nextIndex];

  return (
    <button
      onClick={() => setTheme(next.value)}
      className="flex items-center gap-2"
      title={current.label}
    >
      <current.icon className="w-4 h-4" />
      <span className="text-sm">{current.label}</span>
    </button>
  );
}
