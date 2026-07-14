import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';
import { useLLMStore } from '../../stores/llmStore';
import { useSkillStore } from '../../stores/skillStore';
import { useMcpServerStore } from '../../stores/mcpServerStore';
import { useProjectStore } from '../../stores/projectStore';
import { Agent } from '../../../../shared/types';
import {
  Plus, Trash2, Edit2, X, Bot, Layers, Code, Search
} from 'lucide-react';
import { AgentEditDialog } from './AgentEditDialog';
import { ProviderIcon } from '../ui/ProviderIcon';

const mapProviderTypeToIcon = (type: string): string => {
  if (type === 'glm-overseas') return 'zhipu';
  if (type === 'minimax-overseas') return 'minimax';
  return type;
};

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export function AgentLibrary() {
  const { t } = useTranslation();
  const { agents, error, fetchAgents, deleteAgent } = useAgentStore();
  const { providers, fetchProviders } = useLLMStore();
  const { fetchSkills } = useSkillStore();
  const { fetchMcpServers } = useMcpServerStore();
  const { currentProjectId } = useProjectStore();

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);

  // Search query state
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!currentProjectId) return;
    fetchAgents(currentProjectId);
    fetchProviders();
    fetchSkills(currentProjectId);
    fetchMcpServers();
  }, [currentProjectId]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const openCreateModal = () => {
    setEditingAgentId(null);
    setIsModalOpen(true);
  };

  const openEditModal = (agent: Agent) => {
    setEditingAgentId(agent.id);
    setIsModalOpen(true);
  };

  const handleDeleteAgent = async (id: string, name: string) => {
    if (confirm(t('agent.deleteConfirm', { name }))) {
      try {
        await deleteAgent(id);
        showToast(t('agent.deletedSuccess', { name }), 'success');
      } catch (err) {
        showToast(t('agent.deleteError'), 'error');
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--color-bg-app)] overflow-hidden">
      <header className="main-topbar shrink-0 h-10 flex items-center justify-between">
        <div className="main-topbar-left">
          <span className="text-xs text-[var(--color-text-muted)] font-normal">
            {t('sidebar.settings.agentsDesc')}
          </span>
        </div>
      </header>

      {/* Content */}
      <div className="settings-content overflow-y-auto flex-1 px-5 pb-6 pt-4">
        {/* 内置的操作 Toolbar 面板 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 shrink-0">
          <div className="text-[13px] font-semibold tabular-nums text-[var(--color-text-primary)]">
            {t('agent.listTitle', { count: agents.filter(agent =>
              agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              (agent.description || '').toLowerCase().includes(searchQuery.toLowerCase())
            ).length })}
          </div>
          <div className="flex items-center gap-2">
            {/* Search box */}
            <div className="flex h-8 items-center gap-2 bg-[var(--color-bg-sunken)] border border-[var(--color-border)] px-3 rounded-[var(--radius-sm)] w-[240px] focus-within:border-[var(--color-accent)]">
              <Search className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
              <input
                type="text"
                placeholder={t('agent.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent text-xs text-[var(--color-text-primary)] outline-none w-full"
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <button className="btn btn-primary flex items-center gap-1.5 cursor-pointer text-xs py-1.5" onClick={openCreateModal}>
              <Plus className="w-4 h-4" />
              <span>{t('agent.createAgent')}</span>
            </button>
          </div>
        </div>
        {error && (
          <div className="mb-4 p-3 bg-[var(--color-danger-dim)] border border-[var(--color-danger)]/20 rounded-lg flex items-start gap-2 text-xs text-[var(--color-danger)]">
            <span className="w-4 h-4 shrink-0 mt-0.5">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <div className="resource-card-grid">
          {agents.filter(agent =>
            agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (agent.description || '').toLowerCase().includes(searchQuery.toLowerCase())
          ).map((agent) => {
            const provider = providers.find(p => p.id === agent.provider_id);
            const isProtected = agent.is_protected === true || agent.slug === 'general-purpose';
            return (
              <div key={agent.id} className="provider-card resource-square-card flex flex-col p-4 border border-transparent hover:border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-bg-surface)] transition-colors group">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="provider-icon bg-transparent flex items-center justify-center p-0.5 border-0 shrink-0">
                      {provider ? (
                        <ProviderIcon provider={mapProviderTypeToIcon(provider.provider_type)} size={32} shape="square" />
                      ) : (
                        <Bot className="w-6 h-6 text-[var(--color-accent)]" />
                      )}
                    </div>
                    <div className="truncate">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="font-semibold text-sm text-[var(--color-text-primary)] truncate">{agent.name}</div>
                        {isProtected && (
                          <span className="shrink-0 rounded bg-[var(--color-accent-dim)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                            {t('agent.protectedBadge')}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[var(--color-text-secondary)] truncate">
                        {t('agent.modelLabel')}{provider
                          ? `${provider.name} (${provider.default_model})`
                          : isProtected ? t('agent.inheritedModelShort') : t('agent.noModel')}
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-3 line-clamp-2" title={agent.description}>
                    {agent.description || t('agent.noDescription')}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-0.5 rounded text-[11px] tabular-nums bg-[var(--color-bg-sunken)] text-[var(--color-text-secondary)] border border-[var(--color-border)] flex items-center gap-1 font-medium shrink-0">
                      <Layers className="w-3 h-3 text-[var(--color-text-muted)]" />
                      <span>{t('agent.mcpExclusions', { count: agent.mcpServerExclusionIds?.length || 0 })}</span>
                    </span>
                    <span className="px-2 py-0.5 rounded text-[11px] tabular-nums bg-[var(--color-bg-sunken)] text-[var(--color-text-secondary)] border border-[var(--color-border)] flex items-center gap-1 font-medium shrink-0">
                      <Code className="w-3 h-3 text-[var(--color-text-muted)]" />
                      <span>{t('agent.skillPreloads', { count: agent.skillNames?.length || 0 })}</span>
                    </span>
                  </div>
                </div>

                <div className="mt-auto flex shrink-0 justify-end gap-2 border-t border-[var(--color-border)]/30 pt-3">
                  <button
                    className="btn btn-secondary btn-sm flex items-center gap-1 cursor-pointer"
                    onClick={() => openEditModal(agent)}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>{t('common.edit')}</span>
                  </button>
                  {!isProtected && (
                    <button
                      className="btn btn-danger btn-sm flex items-center gap-1 cursor-pointer"
                      onClick={() => handleDeleteAgent(agent.id, agent.name)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{t('common.delete')}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {agents.filter(agent =>
            agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (agent.description || '').toLowerCase().includes(searchQuery.toLowerCase())
          ).length === 0 && (
            <div className="col-span-full flex flex-col items-start gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface)] px-6 py-10 text-sm text-[var(--color-text-muted)]">
              <span>{searchQuery ? t('agent.emptySearch') : t('agent.empty')}</span>
              {!searchQuery && <button className="btn btn-primary" onClick={openCreateModal}>{t('agent.createAgent')}</button>}
            </div>
          )}
        </div>
      </div>

      {/* Edit / Add Dialog */}
      <AgentEditDialog
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        agentId={editingAgentId}
        showToast={showToast}
      />

      {/* Toast Alert Portal */}
      <div className="toast-container z-50">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type} flex items-center gap-2`}>
            {t.type === 'success' && <span className="text-[var(--color-success)] font-bold">✓</span>}
            {t.type === 'error' && <span className="text-[var(--color-danger)] font-bold">✗</span>}
            {t.type === 'info' && <span className="text-[var(--color-info)] font-bold">i</span>}
            <span className="text-xs text-[var(--color-text-primary)]">{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
