import { describe, it, expect } from 'vitest';
import { useThemeStore } from './themeStore';

describe('themeStore', () => {
  it('should have default theme as system', () => {
    expect(useThemeStore.getState().theme).toBe('system');
  });

  it('should update theme via setTheme', () => {
    useThemeStore.getState().setTheme('dark');
    expect(useThemeStore.getState().theme).toBe('dark');
    useThemeStore.getState().setTheme('light');
    expect(useThemeStore.getState().theme).toBe('light');
  });
});
