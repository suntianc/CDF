import { useEffect } from 'react';
import { useThemeStore } from '@/stores/themeStore';

export function useTheme() {
  const { theme, setTheme } = useThemeStore();

  useEffect(() => {
    const applyTheme = (themeName: string) => {
      document.documentElement.setAttribute('data-theme', themeName);
    };

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mediaQuery.matches ? 'dark' : 'light');

      const handler = (e: MediaQueryListEvent) => {
        applyTheme(e.matches ? 'dark' : 'light');
      };
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    } else {
      applyTheme(theme);
    }
  }, [theme]);

  return { theme, setTheme };
}
