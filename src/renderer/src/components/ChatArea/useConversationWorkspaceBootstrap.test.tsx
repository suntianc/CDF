import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConversationWorkspaceBootstrap } from './useConversationWorkspaceBootstrap';

describe('useConversationWorkspaceBootstrap', () => {
  it('loads the global Agent Library even when no Project is selected', () => {
    const resetStaleStreamingState = vi.fn();
    const fetchProviders = vi.fn();
    const fetchAgents = vi.fn();

    renderHook(() => useConversationWorkspaceBootstrap({
      resetStaleStreamingState,
      fetchProviders,
      fetchAgents,
    }));

    expect(resetStaleStreamingState).toHaveBeenCalledTimes(1);
    expect(fetchProviders).toHaveBeenCalledTimes(1);
    expect(fetchAgents).toHaveBeenCalledTimes(1);
    expect(fetchAgents).toHaveBeenCalledWith();
  });
});
