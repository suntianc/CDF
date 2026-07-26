import { useTranslation } from 'react-i18next';
import type { MCPServer } from '@shared/providers';
import {
  AGENT_BUILT_IN_TOOL_NAMES,
  type AgentToolScopeConfig,
} from '@shared/agents';

interface ToolScopeSectionProps {
  mode: AgentToolScopeConfig['mode'];
  builtInTools: string[];
  toolScopeMcpServerIds: string[];
  mcpServers: MCPServer[];
  onModeChange: (mode: AgentToolScopeConfig['mode']) => void;
  onToggleBuiltInTool: (toolName: string) => void;
  onToggleMcpServer: (serverId: string) => void;
}

/** Tool scope field group: inherit-vs-narrow toggle plus per-tool checkboxes. */
export function ToolScopeSection({
  mode,
  builtInTools,
  toolScopeMcpServerIds,
  mcpServers,
  onModeChange,
  onToggleBuiltInTool,
  onToggleMcpServer,
}: ToolScopeSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sidebar)]/30 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-[var(--color-text-primary)]">
            {t('agent.toolScopeLabel')}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
            {mode === 'inherit'
              ? t('agent.toolScopeInheritedDesc')
              : t('agent.toolScopeNarrowDesc')}
          </p>
        </div>
        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[10px] shrink-0">
          {(['inherit', 'narrow'] as const).map(candidate => (
            <button
              key={candidate}
              type="button"
              aria-label={candidate === 'inherit' ? t('agent.toolScopeInherit') : t('agent.toolScopeNarrow')}
              aria-pressed={mode === candidate}
              onClick={() => onModeChange(candidate)}
              className={`px-2.5 py-1.5 transition-colors ${
                mode === candidate
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
              }`}
            >
              {candidate === 'inherit' ? t('agent.toolScopeInherit') : t('agent.toolScopeNarrow')}
            </button>
          ))}
        </div>
      </div>

      {mode === 'narrow' && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              {t('agent.builtInToolsLabel')}
            </div>
            <div className="max-h-36 overflow-y-auto rounded-md border border-[var(--color-border)]/60 bg-[var(--color-bg-app)]/40 p-1.5 grid grid-cols-2 gap-1">
              {AGENT_BUILT_IN_TOOL_NAMES.map(toolName => (
                <label key={toolName} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]">
                  <input
                    type="checkbox"
                    checked={builtInTools.includes(toolName)}
                    onChange={() => onToggleBuiltInTool(toolName)}
                    aria-label={t('agent.allowBuiltInTool', { name: toolName })}
                    className="accent-[var(--color-accent)]"
                  />
                  <span className="truncate font-mono">{toolName}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              {t('agent.mcpToolScopeLabel')}
            </div>
            <div className="max-h-36 overflow-y-auto rounded-md border border-[var(--color-border)]/60 bg-[var(--color-bg-app)]/40 p-1.5 space-y-1">
              {mcpServers.map(server => (
                <label key={server.id} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]">
                  <input
                    type="checkbox"
                    checked={toolScopeMcpServerIds.includes(server.id)}
                    onChange={() => onToggleMcpServer(server.id)}
                    aria-label={t('agent.allowMcpServerTools', { name: server.name })}
                    className="accent-[var(--color-accent)]"
                  />
                  <span className="truncate">{server.name}</span>
                </label>
              ))}
              {mcpServers.length === 0 && (
                <div className="px-1.5 py-2 text-[10px] italic text-[var(--color-text-muted)]">
                  {t('agent.noMcpServers')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
