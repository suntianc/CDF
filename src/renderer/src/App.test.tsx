import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { toast } from 'sonner';
import App from './App';

// Phase 8 — T-08-T9: latent bug fix verification.
// Phase 6/7 dispatcher.ts and useCommandRegistry.ts call `toast.warning/info/error`,
// but sonner requires an explicit `<Toaster />` mount in the React tree to render
// anything. This test pins the Toaster mount so future refactors cannot silently
// drop it.

// Mock the heavy view modules so the full App tree can render in jsdom without
// rendering their full contents. The views themselves are not the subject of
// this test — only the Toaster mount is. (ProviderIcon is now a thin shim
// over @lobehub/icons-static-svg SVGs via Vite ?raw imports, so the previous
// "@lobehub icon family peer-dep chain" concern is no longer relevant — we
// could unmock these views in a follow-up if desired.)
vi.mock('@/components/AgentLibrary/AgentLibrary', () => ({
  AgentLibrary: () => null,
}));
vi.mock('@/components/PluginsPanel/PluginsPanel', () => ({
  PluginsPanel: () => null,
}));
vi.mock('@/components/Settings/ModelSettings', () => ({
  ModelSettings: () => null,
}));
vi.mock('@/components/Settings/ToolSettings', () => ({
  ToolSettings: () => null,
}));
vi.mock('@/components/WorkflowEditor/WorkflowList', () => ({
  WorkflowList: () => null,
}));
vi.mock('@/components/WorkflowEditor/WorkflowEditor', () => ({
  WorkflowEditor: () => null,
}));
vi.mock('@/components/Sidebar/Sidebar', () => ({
  Sidebar: () => null,
}));
vi.mock('@/components/ChatArea/ChatArea', () => ({
  ChatArea: () => null,
}));
vi.mock('@/components/TaskPanel/TaskPanel', () => ({
  TaskPanel: () => null,
}));

beforeAll(() => {
  // jsdom does not implement ResizeObserver (cmdk) or scrollIntoView (cmdk) — polyfill.
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = globalThis.ResizeObserver;
  }
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {};
  }
  // App.tsx reads `window.electronAPI.store.get('theme')` on mount; provide a
  // minimal stub so the test does not crash before we can assert on the
  // Toaster DOM presence.
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    store: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
    },
  };
});

describe('App', () => {
  it('mounts <Toaster /> from sonner in the DOM (Phase 8 T-08-T9 latent fix)', async () => {
    render(<App />);
    // sonner 2.0.7 only renders the inner `<ol data-sonner-toaster>` after at
    // least one toast is added. Trigger a toast to make the toaster materialise,
    // then wait for the data attribute to appear. The callback must throw if
    // the element is not yet present so waitFor keeps polling until the
    // timeout — returning a falsy value would short-circuit immediately.
    act(() => {
      toast.info('phase 8 mount probe');
    });
    const toaster = await waitFor(
      () => {
        const el = document.querySelector('[data-sonner-toaster]');
        if (!el) throw new Error('toaster not yet mounted');
        return el as HTMLElement;
      },
      { timeout: 3000, interval: 50 }
    );
    expect(toaster).toBeTruthy();
  });
});
