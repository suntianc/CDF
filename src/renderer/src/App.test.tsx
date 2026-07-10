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
  PluginsPanel: () => <div data-testid="plugins-panel" />,
}));
vi.mock('@/components/Settings/ModelSettings', () => ({
  ModelSettings: () => <div data-testid="model-settings" />,
}));
vi.mock('@/components/Settings/ToolSettings', () => ({
  ToolSettings: () => null,
}));
vi.mock('@/components/Settings/ResearchSettings', () => ({
  ResearchSettings: () => null,
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
  ChatArea: ({
    taskPanelOpen,
    onToggleTaskPanel,
    onOpenTaskPanel,
    onOpenSettings,
    onOpenPlugins,
  }: {
    taskPanelOpen?: boolean;
    onToggleTaskPanel?: () => void;
    onOpenTaskPanel?: () => void;
    onOpenSettings?: () => void;
    onOpenPlugins?: () => void;
  }) => (
    <div data-testid="conversation-workspace">
      <span data-testid="task-panel-state">{taskPanelOpen ? 'open' : 'closed'}</span>
      <button type="button" onClick={onToggleTaskPanel}>toggle task panel</button>
      <button type="button" onClick={onOpenTaskPanel}>go approve now</button>
      <button type="button" onClick={onOpenPlugins}>configure plugins</button>
      <button type="button" onClick={onOpenSettings}>configure models</button>
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
      if (!isOpen) return null;
      return <div data-testid="task-panel">{isOpen ? 'open' : 'closed'}</div>;
    },
  };
});
vi.mock('@/components/FilePanel/FilePanel', () => ({
  FilePanel: () => null,
}));

beforeAll(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }
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
  useProjectStore.setState({
    activeView: 'chat',
    taskPanelOpen: false,
    currentProjectId: null,
    projects: [],
  });
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
    await waitFor(() => expect(screen.queryByTestId('task-panel')).toBeNull());
    expect(taskPanelMountSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('toggle task panel'));
    await screen.findByTestId('task-panel');
    expect(screen.getByTestId('task-panel').textContent).toBe('open');
    expect(taskPanelMountSpy).toHaveBeenCalledTimes(1);
  });

  it('hides TaskPanel error fallback when closed and retries on reopen', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldThrowTaskPanel.current = true;

    render(<App />);
    fireEvent.click(screen.getByText('toggle task panel'));

    await screen.findByText(/Task panel failed to load\.|任务面板加载失败。/);

    fireEvent.click(screen.getByText('toggle task panel'));
    await waitFor(() => expect(screen.queryByText(/Task panel failed to load\.|任务面板加载失败。/)).toBeNull());

    shouldThrowTaskPanel.current = false;
    fireEvent.click(screen.getByText('toggle task panel'));

    await screen.findByTestId('task-panel');
    expect(screen.getByTestId('task-panel').textContent).toBe('open');
    consoleSpy.mockRestore();
  });

  it('routes welcome configuration entries to their dedicated destinations', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'configure plugins' }));
    await screen.findByTestId('plugins-panel');

    useProjectStore.setState({ activeView: 'chat' });
    await screen.findByTestId('conversation-workspace');

    fireEvent.click(screen.getByRole('button', { name: 'configure models' }));
    await screen.findByTestId('model-settings');
  });

  it('routes research projects to a research Scene Workspace while keeping Conversation available', () => {
    useProjectStore.setState({
      activeView: 'chat',
      currentProjectId: 'project-research',
      projects: [{
        id: 'project-research',
        name: 'AI Papers',
        path: '/tmp/ai-papers',
        scene: 'research',
        created_at: 1,
        updated_at: 1,
      }],
    });

    render(<App />);

    expect(screen.getByRole('tab', { name: /Conversation|对话/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Paper Library|论文库/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Writing|写作/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Experiments|实验记录/ })).toBeTruthy();
    expect(screen.getByTestId('conversation-workspace')).toBeTruthy();
  });

  it('falls back to the general Conversation workspace for unknown Scene values', () => {
    useProjectStore.setState({
      activeView: 'chat',
      currentProjectId: 'project-unknown',
      projects: [{
        id: 'project-unknown',
        name: 'Imported Project',
        path: '/tmp/imported',
        scene: 'archival' as never,
        created_at: 1,
        updated_at: 1,
      }],
    });

    render(<App />);

    expect(screen.getByTestId('conversation-workspace')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /Paper Library|论文库/ })).toBeNull();
  });

  it('keeps general projects on the existing Conversation workspace without Scene navigation', () => {
    useProjectStore.setState({
      activeView: 'chat',
      currentProjectId: 'project-general',
      projects: [{
        id: 'project-general',
        name: 'General Project',
        path: '/tmp/general',
        scene: 'general',
        created_at: 1,
        updated_at: 1,
      }],
    });

    render(<App />);

    expect(screen.getByTestId('conversation-workspace')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /Paper Library|论文库/ })).toBeNull();
  });
});
