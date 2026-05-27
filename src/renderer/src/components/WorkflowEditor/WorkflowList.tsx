import { useEffect, useState } from 'react';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useProjectStore } from '../../stores/projectStore';
import { Workflow } from '../../../../shared/types';
import { Plus, Trash2, GitBranch, Clock, Play, Info } from 'lucide-react';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface WorkflowListProps {
  onSelectWorkflow: (workflow: Workflow) => void;
  onCreateWorkflow: () => void;
}

export function WorkflowList({ onSelectWorkflow, onCreateWorkflow }: WorkflowListProps) {
  const { workflows, isLoading, error, fetchWorkflows, deleteWorkflow } = useWorkflowStore();
  const { currentProjectId } = useProjectStore();
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  };

  useEffect(() => {
    if (currentProjectId) {
      fetchWorkflows(currentProjectId);
    }
  }, [currentProjectId, fetchWorkflows]);

  const handleDelete = async (id: string, name: string) => {
    try {
      await deleteWorkflow(id, currentProjectId);
      showToast('✓ 工作流删除成功', 'success');
      setDeleteConfirmId(null);
    } catch (err: any) {
      showToast(err.message || '删除工作流失败', 'error');
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--bg-app)] overflow-hidden relative">
      {/* Toast Notification Container */}
      <div className="absolute top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div 
            key={t.id} 
            className={`p-3 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-lg transition-all duration-300 animate-slide-in pointer-events-auto border ${
              t.type === 'success' 
                ? 'bg-[var(--color-success-dim)] border-[var(--color-success)]/20 text-[var(--color-success)]' 
                : t.type === 'error'
                  ? 'bg-[var(--color-danger-dim)] border-[var(--color-danger)]/20 text-[var(--color-danger)]'
                  : 'bg-[var(--color-bg-active)] border-[var(--color-border)]/40 text-[var(--color-text-primary)]'
            }`}
          >
            <Info className="w-3.5 h-3.5" />
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="main-topbar shrink-0 h-9 border-b-0" />

      {/* Content */}
      <div className="settings-content overflow-y-auto flex-1 px-6 pb-6 pt-3">
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
            工作流列表 ({workflows.length})
          </div>
          <button
            className="btn btn-primary flex items-center gap-1.5 cursor-pointer text-xs py-1.5"
            onClick={onCreateWorkflow}
          >
            <Plus className="w-4 h-4" />
            <span>新建工作流</span>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-[var(--color-danger-dim)] border border-[var(--color-danger)]/20 rounded-lg flex items-start gap-2 text-xs text-[var(--color-danger)]">
            <span className="w-4 h-4 shrink-0 mt-0.5">!</span>
            <span>{error}</span>
          </div>
        )}

        {/* Workflow Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workflows.map((workflow) => (
            <div
              key={workflow.id}
              className="provider-card flex flex-col justify-between p-5 border border-[var(--color-border)] hover:border-[var(--color-accent)]/50 rounded-xl bg-[var(--color-bg-surface)] shadow-sm hover:shadow-md transition-all group cursor-pointer"
              onClick={() => onSelectWorkflow(workflow)}
            >
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="provider-icon bg-transparent flex items-center justify-center p-0.5 border-0 shrink-0 group-hover:scale-105 transition-transform">
                    <GitBranch className="w-6 h-6 text-[var(--color-accent)]" />
                  </div>
                  <div className="truncate">
                    <div className="font-semibold text-sm text-[var(--color-text-primary)] truncate">
                      {workflow.name}
                    </div>
                    <div className="text-xs text-[var(--color-text-secondary)] truncate">
                      {workflow.status === 'active' ? '已激活' : '草稿'}
                    </div>
                  </div>
                </div>

                <p
                  className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-4 line-clamp-2 h-8"
                  title={workflow.description}
                >
                  {workflow.description || '暂无描述信息'}
                </p>

                <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
                  <Clock className="w-3 h-3" />
                  <span>{formatDate(workflow.updated_at)}</span>
                  <span className="mx-1">·</span>
                  <span>{workflow.graph_data?.nodes?.length || 0} 个节点</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-[var(--color-border)]/30 pt-3 mt-2.5">
                <button
                  className="btn btn-primary btn-sm flex items-center gap-1 cursor-pointer hover:scale-105 active:scale-95 transition-all"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectWorkflow(workflow);
                  }}
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>打开</span>
                </button>
                <button
                  className="btn btn-danger btn-sm flex items-center gap-1 cursor-pointer hover:scale-105 active:scale-95 transition-all"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteConfirmId(workflow.id);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>删除</span>
                </button>
              </div>
            </div>
          ))}

          {workflows.length === 0 && !isLoading && (
            <div className="col-span-full text-center py-16 bg-[var(--color-bg-surface)] border border-[var(--color-border)] border-dashed rounded-xl text-sm text-[var(--color-text-muted)]">
              无可用工作流。尚未创建任何 Agent 工作流，点击上方"新建工作流"开始编排自动化流程。
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {deleteConfirmId && (
        <div className="modal-overlay visible z-50">
          <div className="modal animate-fade-in w-[400px] p-6">
            <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-2">
              删除工作流
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6">
              确定要删除该工作流吗？此操作无法撤销，所有关联的执行历史将被永久删除。
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="btn btn-secondary cursor-pointer"
                onClick={() => setDeleteConfirmId(null)}
              >
                取消
              </button>
              <button
                className="btn btn-danger cursor-pointer"
                onClick={() => handleDelete(deleteConfirmId, '')}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
