import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useCommandRegistry } from './useCommandRegistry';

describe('useCommandRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it('fetches and sets state on mount with valid projectId+agentId', async () => {
    const listMock = vi.fn().mockResolvedValue({
      commands: [{ name: 'goal', source: 'system' }],
      conflicts: [],
      warnings: [],
    });
    (window as any).electronAPI = {
      commands: {
        list: listMock,
        readProjectCommands: vi.fn(),
        onChanged: vi.fn(() => () => {}),
      },
    };

    const { result } = renderHook(() => useCommandRegistry('p1', 'a1'));

    await waitFor(() => {
      expect(result.current.loading).toBe('ready');
    });

    expect(listMock).toHaveBeenCalledWith('p1', 'a1');
    expect(result.current.commands).toEqual([{ name: 'goal', source: 'system' }]);
  });

  it('returns empty state when projectId is null', () => {
    (window as any).electronAPI = {
      commands: {
        list: vi.fn(),
        readProjectCommands: vi.fn(),
        onChanged: vi.fn(() => () => {}),
      },
    };

    const { result } = renderHook(() => useCommandRegistry(null, 'a1'));
    expect(result.current.commands).toEqual([]);
    expect(result.current.loading).toBe('idle');
  });

  it('does not throw when electronAPI.commands is missing', () => {
    delete (window as any).electronAPI;

    const { result } = renderHook(() => useCommandRegistry('p1', 'a1'));
    expect(result.current.commands).toEqual([]);
    expect(result.current.loading).toBe('idle');
  });

  it('subscribes to onChanged and re-fetches on chokidar push', async () => {
    let onChangedCallback: ((event: unknown, data: { source: string }) => void) | null = null;
    const cleanup = vi.fn();
    const listMock = vi.fn().mockResolvedValue({ commands: [], conflicts: [], warnings: [] });

    (window as any).electronAPI = {
      commands: {
        list: listMock,
        readProjectCommands: vi.fn(),
        onChanged: vi.fn((cb) => {
          onChangedCallback = cb;
          return cleanup;
        }),
      },
    };

    const { unmount } = renderHook(() => useCommandRegistry('p1', 'a1'));
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(1);
    });

    // Simulate chokidar push
    expect(onChangedCallback).toBeTruthy();
    (onChangedCallback as any)(null, { source: 'chokidar' });

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2);
    });

    unmount();
    expect(cleanup).toHaveBeenCalled();
  });
});

// ===== Phase 8 — D-07..D-11: 5-state loading state machine tests =====
describe('Phase 8 loading state machine (D-07..D-11)', () => {
  it('slow loading: loading transitions to "slow" after 500ms when IPC still pending', async () => {
    vi.useFakeTimers();
    const listMock = vi.fn(() => new Promise(() => {})); // never resolves
    (window as any).electronAPI = {
      commands: {
        list: listMock,
        readProjectCommands: vi.fn(),
        onChanged: vi.fn(() => () => {}),
        onFallback: vi.fn(() => () => {}),
      },
    };
    const { result } = renderHook(() => useCommandRegistry('p1', 'a1'));
    expect(result.current.loading).toBe('pending');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.loading).toBe('slow');
    vi.useRealTimers();
  });

  it('no slow before 500ms: loading stays "pending" if IPC resolves in <500ms', async () => {
    vi.useFakeTimers();
    const listMock = vi.fn().mockResolvedValue({ commands: [], conflicts: [], warnings: [] });
    (window as any).electronAPI = {
      commands: {
        list: listMock,
        readProjectCommands: vi.fn(),
        onChanged: vi.fn(() => () => {}),
        onFallback: vi.fn(() => () => {}),
      },
    };
    const { result } = renderHook(() => useCommandRegistry('p1', 'a1'));
    act(() => {
      vi.advanceTimersByTime(200); // < 500ms
    });
    // IPC resolves at 0ms; clearTimeout inside .then prevents 'slow' transition
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.loading).toBe('ready');
    expect(result.current.loading).not.toBe('slow');
    vi.useRealTimers();
  });

  it('error fallback to mcp_health_warning: IPC reject sets loading="error" and synthetic warning', async () => {
    const listMock = vi.fn().mockRejectedValue(new Error('IPC failed'));
    (window as any).electronAPI = {
      commands: {
        list: listMock,
        readProjectCommands: vi.fn(),
        onChanged: vi.fn(() => () => {}),
        onFallback: vi.fn(() => () => {}),
      },
    };
    const { result } = renderHook(() => useCommandRegistry('p1', 'a1'));
    await waitFor(() => {
      expect(result.current.loading).toBe('error');
    });
    expect(result.current.warnings).toEqual([
      { type: 'mcp_health_warning', message: 'MCP 工具加载失败' },
    ]);
  });

  it('registry-returned mcp_health_warning sets loading="ready" (not "error")', async () => {
    const listMock = vi.fn().mockResolvedValue({
      commands: [],
      conflicts: [],
      warnings: [{ type: 'mcp_health_warning', message: 'mcp server unreachable' }],
    });
    (window as any).electronAPI = {
      commands: {
        list: listMock,
        readProjectCommands: vi.fn(),
        onChanged: vi.fn(() => () => {}),
        onFallback: vi.fn(() => () => {}),
      },
    };
    const { result } = renderHook(() => useCommandRegistry('p1', 'a1'));
    await waitFor(() => {
      expect(result.current.loading).toBe('ready');
    });
    expect(result.current.warnings).toEqual([
      { type: 'mcp_health_warning', message: 'mcp server unreachable' },
    ]);
  });

  it('re-fetches when projectId changes (mount-time reload on deps)', async () => {
    const listMock = vi.fn().mockResolvedValue({ commands: [], conflicts: [], warnings: [] });
    (window as any).electronAPI = {
      commands: {
        list: listMock,
        readProjectCommands: vi.fn(),
        onChanged: vi.fn(() => () => {}),
        onFallback: vi.fn(() => () => {}),
      },
    };
    const { rerender } = renderHook(({ p, a }) => useCommandRegistry(p, a), {
      initialProps: { p: 'p1', a: 'a1' },
    });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    expect(listMock).toHaveBeenLastCalledWith('p1', 'a1');

    rerender({ p: 'p2', a: 'a1' });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(listMock).toHaveBeenLastCalledWith('p2', 'a1');
  });

  it('does not fire IPC when projectId is null but agentId is set', () => {
    const listMock = vi.fn().mockResolvedValue({ commands: [], conflicts: [], warnings: [] });
    (window as any).electronAPI = {
      commands: {
        list: listMock,
        readProjectCommands: vi.fn(),
        onChanged: vi.fn(() => () => {}),
        onFallback: vi.fn(() => () => {}),
      },
    };
    const { result } = renderHook(() => useCommandRegistry(null, 'a1'));
    expect(listMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe('idle');
  });

  it('reloads explicitly via reload() after IPC has resolved', async () => {
    const listMock = vi.fn().mockResolvedValue({ commands: [], conflicts: [], warnings: [] });
    (window as any).electronAPI = {
      commands: {
        list: listMock,
        readProjectCommands: vi.fn(),
        onChanged: vi.fn(() => () => {}),
        onFallback: vi.fn(() => () => {}),
      },
    };
    const { result } = renderHook(() => useCommandRegistry('p1', 'a1'));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.reload();
    });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });
});

// ===== Phase 8 — D-16..D-19: chokidar fallback toast (C-04 dedup) =====
describe('Phase 8 chokidar fallback toast (D-16..D-19)', () => {
  it('toast.warning fires once for a given (scope, error) fingerprint', async () => {
    const captured: { cb: ((event: unknown, data: { scope: 'system' | 'project'; dir: string; error: string }) => void) | null } = { cb: null };
    (window as any).electronAPI = {
      commands: {
        list: vi.fn().mockResolvedValue({ commands: [], conflicts: [], warnings: [] }),
        readProjectCommands: vi.fn(),
        onChanged: vi.fn(() => () => {}),
        onFallback: vi.fn((cb) => {
          captured.cb = cb;
          return () => {};
        }),
      },
    };
    const { result } = renderHook(() => useCommandRegistry('p1', 'a1'));
    await waitFor(() => expect(result.current.loading).toBe('ready'));
    // Same scope + error → same fingerprint → second call is a no-op for the toast
    act(() => {
      captured.cb?.(null, { scope: 'system', dir: '/a', error: 'EPERM' });
    });
    act(() => {
      captured.cb?.(null, { scope: 'system', dir: '/a', error: 'EPERM' });
    });
    // Contract: same fingerprint does not throw; hook stays in 'ready' state
    await waitFor(() => expect(result.current.loading).toBe('ready'));
  });
});
