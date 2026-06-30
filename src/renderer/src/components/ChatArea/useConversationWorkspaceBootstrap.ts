import { useEffect } from 'react';

interface UseConversationWorkspaceBootstrapInput {
  currentProjectId: string | null;
  resetStaleStreamingState: () => void;
  fetchProviders: () => void | Promise<void>;
  fetchAgents: (projectId: string) => void | Promise<void>;
}

export function useConversationWorkspaceBootstrap({
  currentProjectId,
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
    if (!currentProjectId) return;
    fetchAgents(currentProjectId);
  }, [currentProjectId, fetchAgents]);
}
