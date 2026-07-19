import { useEffect } from 'react';

interface UseConversationWorkspaceBootstrapInput {
  resetStaleStreamingState: () => void;
  fetchProviders: () => void | Promise<void>;
  fetchAgents: () => void | Promise<void>;
}

export function useConversationWorkspaceBootstrap({
  resetStaleStreamingState,
  fetchProviders,
  fetchAgents,
}: UseConversationWorkspaceBootstrapInput): void {
  useEffect(() => {
    resetStaleStreamingState();
  }, [resetStaleStreamingState]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);
}
