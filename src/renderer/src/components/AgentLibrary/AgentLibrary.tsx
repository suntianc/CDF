import { useState, useEffect } from 'react';
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
import { ProviderIcon } from '@lobehub/icons';

const mapProviderTypeToIcon = (type: string): string => {
  if (type === 'glm' || type === 'glm-overseas') return 'zhipu';
  if (type === 'kimi') return 'moonshot';
  if (type === 'minimax-overseas') return 'minimax';
  if (type === 'mimo') return 'xiaomimimo';
  return type;
};

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export function AgentLibrary() {
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
    if (confirm(`确定要删除 Agent 「${name}」吗？`)) {
      try {
        await deleteAgent(id);
        showToast(`✓ Agent ${name} 已成功删除`, 'success');
      } catch (err) {
        showToast('删除 Agent 失败', 'error');
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--bg-app)] overflow-hidden">
      {/* Header */}
      <div className="main-topbar shrink-0 h-9 border-b-0" />

      {/* Content */}
      <div className="settings-content overflow-y-auto flex-1 px-6 pb-6 pt-3">
        {/* 内置的操作 Toolbar 面板 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 shrink-0">
          <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
            Agent 智能体角色列表 ({agents.filter(agent => 
              agent.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
              (agent.description || '').toLowerCase().includes(searchQuery.toLowerCase())
            ).length})
          </div>
          <div className="flex items-center gap-2">
            {/* Search box */}
            <div className="flex items-center gap-2 bg-[var(--color-bg-sidebar)]/80 border border-[var(--color-border)]/50 px-3 py-1.5 rounded-lg w-[240px]">
              <Search className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
              <input 
                type="text" 
                placeholder="搜索 Agent 名称或描述..." 
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
              <span>创建 Agent</span>
            </button>
          </div>
        </div>
        {error && (
          <div className="mb-4 p-3 bg-[var(--color-danger-dim)] border border-[var(--color-danger)]/20 rounded-lg flex items-start gap-2 text-xs text-[var(--color-danger)]">
            <span className="w-4 h-4 shrink-0 mt-0.5">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.filter(agent => 
            agent.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
            (agent.description || '').toLowerCase().includes(searchQuery.toLowerCase())
          ).map((agent) => {
            const provider = providers.find(p => p.id === agent.provider_id);
            return (
              <div key={agent.id} className="provider-card flex flex-col justify-between p-5 border border-[var(--color-border)] hover:border-[var(--color-accent)]/50 rounded-xl bg-[var(--color-bg-surface)] shadow-sm hover:shadow-md transition-all group">
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="provider-icon bg-transparent flex items-center justify-center p-0.5 border-0 shrink-0 group-hover:scale-105 transition-transform">
                      {provider ? (
                        <ProviderIcon provider={mapProviderTypeToIcon(provider.provider_type)} size={32} shape="square" />
                      ) : (
                        <Bot className="w-6 h-6 text-[var(--color-accent)]" />
                      )}
                    </div>
                    <div className="truncate">
                      <div className="font-semibold text-sm text-[var(--color-text-primary)] truncate">{agent.name}</div>
                      <div className="text-xs text-[var(--color-text-secondary)] truncate">
                        模型：{provider ? `${provider.name} (${provider.default_model})` : '未指定大脑'}
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-4 line-clamp-2 h-8" title={agent.description}>
                    {agent.description || '暂无描述信息'}
                  </p>

                  <div className="flex flex-wrap gap-2 mb-4">
                    <span className="px-2 py-0.5 rounded-full text-[11px] bg-[var(--color-accent-dim)] text-[var(--color-accent)] border border-[var(--color-accent)]/10 flex items-center gap-1 font-medium scale-95 origin-left shrink-0">
                      <Layers className="w-3 h-3 text-[var(--color-accent)]" />
                      <span>{agent.mcpServerIds?.length || 0} 个 MCP 绑定</span>
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] bg-[var(--color-success-dim)] text-[var(--color-success)] border border-[var(--color-success)]/10 flex items-center gap-1 font-medium scale-95 origin-left shrink-0">
                      <Code className="w-3 h-3 text-[var(--color-success)]" />
                      <span>{agent.skillNames?.length || 0} 个 Skills 绑定</span>
                    </span>
                  </div>
                </div>

                <div className="flex justify-end gap-2 border-t border-[var(--color-border)]/30 pt-3 mt-2.5">
                  <button 
                    className="btn btn-secondary btn-sm flex items-center gap-1 cursor-pointer hover:scale-105 active:scale-95 transition-all"
                    onClick={() => openEditModal(agent)}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>编辑</span>
                  </button>
                  <button 
                    className="btn btn-danger btn-sm flex items-center gap-1 cursor-pointer hover:scale-105 active:scale-95 transition-all"
                    onClick={() => handleDeleteAgent(agent.id, agent.name)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>删除</span>
                  </button>
                </div>
              </div>
            );
          })}

          {agents.filter(agent => 
            agent.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
            (agent.description || '').toLowerCase().includes(searchQuery.toLowerCase())
          ).length === 0 && (
            <div className="col-span-full text-center py-16 bg-[var(--color-bg-surface)] border border-[var(--color-border)] border-dashed rounded-xl text-sm text-[var(--color-text-muted)]">
              {searchQuery ? '没有找到符合搜索条件的 Agent 角色' : '暂无已定义的 Agent 角色，点击右上角「创建 Agent」按钮开始编排！'}
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
