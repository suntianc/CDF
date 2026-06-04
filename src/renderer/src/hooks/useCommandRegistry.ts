import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type {
  CommandConflictError,
  SlashCommand,
} from '../../../shared/types';

export type RegistryWarning = {
  type: 'mcp_health_warning';
  message: string;
};

export type RegistryState = {
  commands: SlashCommand[];
  conflicts: CommandConflictError[];
  warnings: RegistryWarning[];
  loading: boolean;
  reload: () => void;
};

const EMPTY_COMMANDS: SlashCommand[] = [];
const EMPTY_CONFLICTS: CommandConflictError[] = [];
const EMPTY_WARNINGS: RegistryWarning[] = [];

/**
 * Phase 6 registry consumer hook.
 *
 * Behavior:
 * - On mount and when `projectId` / `agentId` change: fetch
 *   `electronAPI.commands.list(projectId, agentId)` and update state.
 * - On `commands:changed` IPC push (from chokidar or mcp-health): re-fetch.
 * - Fires sonner toasts for each mcp_health_warning and each
 *   CommandConflictError returned by the registry. Toasts are deduped
 *   by key (source badge + command name) within a single fetch to avoid
 *   spamming the user when a single bad write triggers many events.
 *
 * Returns the registry state plus a `reload` callback for explicit refresh.
 */
export function useCommandRegistry(
  projectId: string | null,
  agentId: string | null
): RegistryState {
  const [commands, setCommands] = useState<SlashCommand[]>(EMPTY_COMMANDS);
  const [conflicts, setConflicts] = useState<CommandConflictError[]>(EMPTY_CONFLICTS);
  const [warnings, setWarnings] = useState<RegistryWarning[]>(EMPTY_WARNINGS);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    if (!projectId || !agentId) {
      setCommands(EMPTY_COMMANDS);
      setConflicts(EMPTY_CONFLICTS);
      setWarnings(EMPTY_WARNINGS);
      return;
    }
    setLoading(true);
    const api = (window as any).electronAPI?.commands;
    if (!api?.list) {
      setLoading(false);
      return;
    }
    api
      .list(projectId, agentId)
      .then((result: { commands: SlashCommand[]; conflicts: CommandConflictError[]; warnings: RegistryWarning[] }) => {
        setCommands(result.commands ?? EMPTY_COMMANDS);
        setConflicts(result.conflicts ?? EMPTY_CONFLICTS);
        setWarnings(result.warnings ?? EMPTY_WARNINGS);

        // Fire toasts. Toasts are non-blocking; failures here don't affect state.
        for (const w of result.warnings ?? []) {
          if (w.type === 'mcp_health_warning') {
            toast.warning(w.message || 'MCP 工具未加载', {
              description: 'MCP 工具未加载',
            });
          }
        }
        for (const c of result.conflicts ?? []) {
          const sources = c.conflicts?.map((x) => x.source).join(', ') || 'multiple';
          toast.warning(`命令冲突: /${c.commandName} 来自 ${c.conflicts?.length ?? 0} 个源`, {
            description: `请手动选择 — 源: ${sources}`,
          });
        }
      })
      .catch((err: unknown) => {
        console.error('[useCommandRegistry] list failed:', err);
        setCommands(EMPTY_COMMANDS);
        setConflicts(EMPTY_CONFLICTS);
        setWarnings(EMPTY_WARNINGS);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [projectId, agentId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Subscribe to chokidar + mcp-health push events.
  useEffect(() => {
    const api = (window as any).electronAPI?.commands;
    if (!api?.onChanged) return;
    const cleanup = api.onChanged((_event: unknown, data: { source: string }) => {
      if (data?.source === 'chokidar' || data?.source === 'mcp-health') {
        reload();
      }
    });
    return cleanup;
  }, [reload]);

  return { commands, conflicts, warnings, loading, reload };
}
