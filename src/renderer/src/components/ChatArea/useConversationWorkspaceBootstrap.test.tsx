import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConversationWorkspaceBootstrap } from './useConversationWorkspaceBootstrap';

describe('useConversationWorkspaceBootstrap', () => {
  it('resets stale streaming state and fetches providers on mount', () => {
    const resetStaleStreamingState = vi.fn();
    const fetchProviders = vi.fn();
    const fetchAgents = vi.fn();

    renderHook(() => useConversationWorkspaceBootstrap({
      currentProjectId: null,
      resetStaleStreamingState,
      fetchProviders,
      fetchAgents,
    }));

    expect(resetStaleStreamingState).toHaveBeenCalledTimes(1);
    expect(fetchProviders).toHaveBeenCalledTimes(1);
    expect(fetchAgents).not.toHaveBeenCalled();
  });

  it('fetches agents only when the current Project changes to a concrete id', () => {
    const resetStaleStreamingState = vi.fn();
    const fetchProviders = vi.fn();
    const fetchAgents = vi.fn();

    const { rerender } = renderHook(
      ({ currentProjectId }) => useConversationWorkspaceBootstrap({
        currentProjectId,
        resetStaleStreamingState,
        fetchProviders,
        fetchAgents,
      }),
      {
        initialProps: {
          currentProjectId: null as string | null,
        },
      },
    );

    expect(fetchAgents).not.toHaveBeenCalled();

    rerender({ currentProjectId: 'project-1' });
    expect(fetchAgents).toHaveBeenCalledTimes(1);
    expect(fetchAgents).toHaveBeenCalledWith('project-1');

    rerender({ currentProjectId: 'project-2' });
    expect(fetchAgents).toHaveBeenCalledTimes(2);
    expect(fetchAgents).toHaveBeenLastCalledWith('project-2');
  });
});
