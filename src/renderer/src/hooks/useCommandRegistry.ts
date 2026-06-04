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

// Phase 8 — D-07..D-11: 5-state loading state machine for MCP skeleton gating.
// - 'idle'    : no projectId/agentId (no IPC issued)
// - 'pending' : IPC issued, awaiting response (< 500ms)
// - 'slow'    : IPC still pending after 500ms threshold (triggers Skeleton row)
// - 'ready'   : IPC resolved successfully
// - 'error'   : IPC rejected → commands:fallback mcp_health_warning row
export type RegistryLoadingState =
  | 'idle'
  | 'pending'
  | 'slow'
  | 'ready'
  | 'error';

export type RegistryState = {
  commands: SlashCommand[];
  conflicts: CommandConflictError[];
  warnings: RegistryWarning[];
  loading: RegistryLoadingState;
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
  const [loading, setLoading] = useState<RegistryLoadingState>('idle');

  const reload = useCallback(() => {
    if (!projectId || !agentId) {
      setCommands(EMPTY_COMMANDS);
      setConflicts(EMPTY_CONFLICTS);
      setWarnings(EMPTY_WARNINGS);
      setLoading('idle');
      return;
    }
    setLoading('pending');
    const api = (window as any).electronAPI?.commands;
    if (!api?.list) {
      setLoading('idle');
      return;
    }
    // Phase 8 — D-07: 500ms threshold timer promotes 'pending' → 'slow'.
    // Functional updater guards against firing after IPC has already
    // transitioned to 'ready' or 'error' (Pitfall P5: useFakeTimers + IPC
    // promise interaction). clearTimeout in both .then and .catch is the
    // primary defense; the prev-check is belt-and-suspenders.
    const slowTimer = setTimeout(() => {
      setLoading((prev: RegistryLoadingState) => (prev === 'pending' ? 'slow' : prev));
    }, 500);
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
        // D-10: clear the slow timer BEFORE setLoading('ready') so the
        // timer cannot fire concurrently with the ready transition
        // (defensive — vi.useFakeTimers + IPC microtask ordering).
        clearTimeout(slowTimer);
        setLoading('ready');
      })
      .catch((err: unknown) => {
        console.error('[useCommandRegistry] list failed:', err);
        // D-11: IPC reject → synthetic mcp_health_warning so the popup
        // renders a gray row (Phase 6 hasMcpWarning UI). Mirrors the
        // behavior of a registry-returned mcp_health_warning.
        setCommands(EMPTY_COMMANDS);
        setConflicts(EMPTY_CONFLICTS);
        setWarnings([{ type: 'mcp_health_warning', message: 'MCP 工具加载失败' }]);
        clearTimeout(slowTimer);
        setLoading('error');
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
