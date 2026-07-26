import { describe, expect, it, vi } from 'vitest';
import { hardenWindowNavigation, isInternalNavigation } from './window-navigation-guard';

describe('isInternalNavigation', () => {
  it('allows the app internal protocols', () => {
    expect(isInternalNavigation('file:///out/renderer/index.html', null)).toBe(true);
    expect(isInternalNavigation('cdf-file:///project/clip.mp4', null)).toBe(true);
    expect(isInternalNavigation('devtools://devtools/bundled/x.html', null)).toBe(true);
  });

  it('allows same-origin as the dev renderer url', () => {
    expect(isInternalNavigation('http://localhost:5173/foo', 'http://localhost:5173')).toBe(true);
    expect(isInternalNavigation('http://localhost:5173', 'http://localhost:5173')).toBe(true);
  });

  it('blocks external and cross-origin navigations', () => {
    expect(isInternalNavigation('https://evil.example.com', 'http://localhost:5173')).toBe(false);
    expect(isInternalNavigation('http://localhost:9999/other', 'http://localhost:5173')).toBe(false);
    expect(isInternalNavigation('not a url', null)).toBe(false);
  });
});

describe('hardenWindowNavigation', () => {
  function fakeWindow() {
    const listeners: Record<string, (...args: any[]) => void> = {};
    let openHandler: ((d: { url: string }) => unknown) | undefined;
    return {
      openExternal: vi.fn(),
      emit: (eventName: string, ...args: any[]) => listeners[eventName]?.(...args),
      invokeOpenHandler: (url: string) => openHandler?.({ url }),
      window: {
        webContents: {
          setWindowOpenHandler: (fn: (d: { url: string }) => unknown) => {
            openHandler = fn;
          },
          on: (eventName: string, fn: (...args: any[]) => void) => {
            listeners[eventName] = fn;
          },
        },
      },
    };
  }

  it('routes new-window http(s) targets to the OS browser and denies the popup', () => {
    const f = fakeWindow();
    hardenWindowNavigation(f.window as any, { deps: { openExternal: f.openExternal } });
    const result = f.invokeOpenHandler('https://example.com/x');
    expect(result).toEqual({ action: 'deny' });
    expect(f.openExternal).toHaveBeenCalledWith('https://example.com/x');
  });

  it('prevents will-navigate to an external url and opens it externally', () => {
    const f = fakeWindow();
    hardenWindowNavigation(f.window as any, {
      allowedUrl: 'http://localhost:5173',
      deps: { openExternal: f.openExternal },
    });
    const event = { preventDefault: vi.fn() };
    f.emit('will-navigate', event, 'https://evil.example.com');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(f.openExternal).toHaveBeenCalledWith('https://evil.example.com');
  });

  it('allows will-navigate to same-origin internal routes', () => {
    const f = fakeWindow();
    hardenWindowNavigation(f.window as any, {
      allowedUrl: 'http://localhost:5173',
      deps: { openExternal: f.openExternal },
    });
    const event = { preventDefault: vi.fn() };
    f.emit('will-navigate', event, 'http://localhost:5173/settings');
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(f.openExternal).not.toHaveBeenCalled();
  });
});
