import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => {
        set({ theme });
        try {
          if (window.electronAPI?.store?.set) {
            window.electronAPI.store.set('theme', theme).catch((err: unknown) => {
              console.error('Failed to save theme to store:', err);
            });
          }
        } catch (err) {
          console.error('Failed to save theme to store:', err);
        }
      },
    }),
    {
      name: 'theme-storage',
    }
  )
);
