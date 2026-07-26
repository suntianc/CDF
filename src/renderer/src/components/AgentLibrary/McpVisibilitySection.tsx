import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import type { MCPServer } from '@shared/providers';

interface McpVisibilitySectionProps {
  mcpServers: MCPServer[];
  exclusionIds: string[];
  onToggleExclusion: (serverId: string) => void;
}

/** MCP visibility field group: searchable list of servers with per-server visibility toggles. */
export function McpVisibilitySection({ mcpServers, exclusionIds, onToggleExclusion }: McpVisibilitySectionProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');

  const candidates = mcpServers.filter(server =>
    server.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const visibleCount = mcpServers.filter(server => !exclusionIds.includes(server.id)).length;

  return (
    <div className="form-group relative">
      <label className="form-label flex items-center justify-between">
        <span>{t('agent.mcpVisibilityLabel', { count: visibleCount, total: mcpServers.length })}</span>
        <span className="text-[10px] text-[var(--color-text-muted)] font-normal">{t('agent.defaultVisibleHint')}</span>
      </label>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sidebar)]/30 p-2">
        <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--color-border)]/50 mb-1">
          <Search className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
          <input
            type="text"
            placeholder={t('agent.searchMcpPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent text-xs text-[var(--color-text-primary)] outline-none w-full py-0.5"
          />
        </div>
        <div
          role="group"
          aria-label={t('agent.mcpVisibilityGroupLabel')}
          className="max-h-[178px] overflow-y-auto space-y-0.5 pr-0.5"
        >
          {candidates.map(server => {
            const isExcluded = exclusionIds.includes(server.id);
            const isVisible = !isExcluded;
            return (
              <label
                key={server.id}
                className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
                  isVisible
                    ? 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
                    : 'bg-[var(--color-danger-dim)]/40 text-[var(--color-text-secondary)]'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={() => onToggleExclusion(server.id)}
                    aria-label={t('agent.mcpVisibilityToggleLabel', { name: server.name })}
                    className="accent-[var(--color-accent)] cursor-pointer"
                  />
                  <span className="truncate">{server.name}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] scale-90 px-1 py-0.2 rounded bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)] font-mono">
                    {server.server_type}
                  </span>
                  <span className={`text-[10px] font-medium ${isVisible ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
                    {isVisible ? t('agent.mcpVisible') : t('agent.mcpExcluded')}
                  </span>
                </div>
              </label>
            );
          })}
          {mcpServers.length === 0 && (
            <div className="text-center py-4 text-xs text-[var(--color-text-muted)] italic">{t('agent.noMcpServers')}</div>
          )}
          {mcpServers.length > 0 && candidates.length === 0 && (
            <div className="text-center py-4 text-xs text-[var(--color-text-muted)] italic">{t('agent.noMcpMatch')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
