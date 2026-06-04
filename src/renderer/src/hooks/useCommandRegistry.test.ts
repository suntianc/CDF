import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
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
      expect(result.current.loading).toBe(false);
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
    expect(result.current.loading).toBe(false);
  });

  it('does not throw when electronAPI.commands is missing', () => {
    delete (window as any).electronAPI;

    const { result } = renderHook(() => useCommandRegistry('p1', 'a1'));
    expect(result.current.commands).toEqual([]);
    expect(result.current.loading).toBe(false);
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
