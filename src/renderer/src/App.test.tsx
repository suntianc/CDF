import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, waitFor, act, fireEvent, screen } from '@testing-library/react';
import { toast } from 'sonner';
import App from './App';
import { useProjectStore } from './stores/projectStore';

const { taskPanelRenderSpy, taskPanelMountSpy, shouldThrowTaskPanel } = vi.hoisted(() => ({
  taskPanelRenderSpy: vi.fn(),
  taskPanelMountSpy: vi.fn(),
  shouldThrowTaskPanel: { current: false },
}));

// Phase 8 — T-08-T9: latent bug fix verification.
// Phase 6/7 dispatcher.ts and useCommandRegistry.ts call `toast.warning/info/error`,
// but sonner requires an explicit `<Toaster />` mount in the React tree to render
// anything. This test pins the Toaster mount so future refactors cannot silently
// drop it.

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
  ChatArea: ({ taskPanelOpen, onToggleTaskPanel, onOpenTaskPanel }: {
    taskPanelOpen?: boolean;
    onToggleTaskPanel?: () => void;
    onOpenTaskPanel?: () => void;
  }) => (
    <div>
      <span data-testid="task-panel-state">{taskPanelOpen ? 'open' : 'closed'}</span>
      <button type="button" onClick={onToggleTaskPanel}>toggle task panel</button>
      <button type="button" onClick={onOpenTaskPanel}>go approve now</button>
    </div>
  ),
}));
vi.mock('@/components/TaskPanel/TaskPanel', async () => {
  const React = await import('react');
  return {
    TaskPanel: ({ isOpen }: { isOpen: boolean }) => {
      React.useEffect(() => {
        taskPanelMountSpy();
      }, []);
      taskPanelRenderSpy(isOpen);
      if (shouldThrowTaskPanel.current) {
        throw new Error('task panel render failed');
      }
      return <aside data-testid="task-panel">{isOpen ? 'open' : 'closed'}</aside>;
    },
  };
});

beforeAll(() => {
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
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    store: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
    },
  };
});

beforeEach(() => {
  taskPanelRenderSpy.mockClear();
  taskPanelMountSpy.mockClear();
  shouldThrowTaskPanel.current = false;
  useProjectStore.setState({ activeView: 'chat', taskPanelOpen: false });
});

describe('App', () => {
  it('mounts <Toaster /> from sonner in the DOM (Phase 8 T-08-T9 latent fix)', async () => {
    render(<App />);
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

  it('keeps go approve now as an open action instead of a toggle', async () => {
    render(<App />);

    fireEvent.click(screen.getByText('go approve now'));
    await screen.findByTestId('task-panel');
    expect(screen.getByTestId('task-panel-state').textContent).toBe('open');

    fireEvent.click(screen.getByText('go approve now'));
    expect(screen.getByTestId('task-panel-state').textContent).toBe('open');
  });

  it('keeps TaskPanel mounted after close so local state can survive reopen', async () => {
    render(<App />);

    fireEvent.click(screen.getByText('toggle task panel'));
    await screen.findByTestId('task-panel');
    expect(taskPanelMountSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('task-panel').textContent).toBe('open');

    fireEvent.click(screen.getByText('toggle task panel'));
    await waitFor(() => expect(screen.getByTestId('task-panel').textContent).toBe('closed'));
    expect(taskPanelMountSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('toggle task panel'));
    await waitFor(() => expect(screen.getByTestId('task-panel').textContent).toBe('open'));
    expect(taskPanelMountSpy).toHaveBeenCalledTimes(1);
  });

  it('collapses TaskPanel error fallback when closed and retries on reopen', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldThrowTaskPanel.current = true;

    render(<App />);
    fireEvent.click(screen.getByText('toggle task panel'));

    const failedPanel = await screen.findByText(/Task panel failed to load\.|任务面板加载失败。/);
    expect(failedPanel.closest('aside')?.style.width).toBe('340px');

    fireEvent.click(screen.getByText('toggle task panel'));
    await waitFor(() => expect(failedPanel.closest('aside')?.style.width).toBe('0px'));

    shouldThrowTaskPanel.current = false;
    fireEvent.click(screen.getByText('toggle task panel'));

    await screen.findByTestId('task-panel');
    expect(screen.getByTestId('task-panel').textContent).toBe('open');
    consoleSpy.mockRestore();
  });
});
