import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useProjectStore } from '../../stores/projectStore';
import { Workflow } from '../../../../shared/types';
import { Plus, Trash2, GitBranch, Clock, Play, Info, Edit } from 'lucide-react';

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
  const { t } = useTranslation();
  const { workflows, isLoading, error, fetchWorkflows, deleteWorkflow, saveWorkflow, runWorkflow } = useWorkflowStore();
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
      await deleteWorkflow(id, currentProjectId ?? undefined);
      showToast(t('workflow.list.deleteSuccess'), 'success');
      setDeleteConfirmId(null);
    } catch (err: any) {
      showToast(err.message || t('workflow.list.deleteFailed'), 'error');
    }
  };

  const handleToggleStatus = async (workflow: Workflow, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const nextStatus = workflow.status === 'active' ? 'draft' : 'active';
      await saveWorkflow({
        ...workflow,
        status: nextStatus,
      });
      showToast(t('workflow.list.statusChanged', { status: nextStatus === 'active' ? t('workflow.list.enabled') : t('workflow.list.disabled') }), 'success');
    } catch (err: any) {
      showToast(err.message || t('workflow.list.statusChangeFailed'), 'error');
    }
  };

  const handleRunWorkflow = async (workflow: Workflow, e: React.MouseEvent) => {
    e.stopPropagation();
    const startNode = workflow.graph_data?.nodes?.find((n) => n.type === 'start');
    const taskGoal = (startNode?.data?.taskGoal as string || '').trim();
    if (!taskGoal) {
      showToast(t('workflow.list.runRequiresGoal'), 'error');
      return;
    }

    try {
      showToast(t('workflow.list.startingWorkflow'), 'info');
      await runWorkflow(workflow.id, currentProjectId ?? '', 'editor', {
        taskGoal,
      });
      showToast(t('workflow.list.workflowStarted'), 'success');
    } catch (err: any) {
      showToast(err.message || t('workflow.list.runFailed'), 'error');
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
            {t('workflow.list.title', { count: workflows.length })}
          </div>
          <button
            className="btn btn-primary flex items-center gap-1.5 cursor-pointer text-xs py-1.5"
            onClick={onCreateWorkflow}
          >
            <Plus className="w-4 h-4" />
            <span>{t('workflow.list.newWorkflow')}</span>
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
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 truncate">
                    <div className="provider-icon bg-transparent flex items-center justify-center p-0.5 border-0 shrink-0 group-hover:scale-105 transition-transform">
                      <GitBranch className="w-6 h-6 text-[var(--color-accent)]" />
                    </div>
                    <div className="truncate">
                      <div className="font-semibold text-sm text-[var(--color-text-primary)] truncate">
                        {workflow.name}
                      </div>
                      <div className="text-[10px] font-medium mt-0.5">
                        {workflow.status === 'active' ? (
                          <span className="text-[var(--color-success)] bg-[var(--color-success-dim)]/20 px-1.5 py-0.5 rounded">{t('workflow.list.enabled')}</span>
                        ) : (
                          <span className="text-[var(--color-text-muted)] bg-[var(--color-bg-active)] px-1.5 py-0.5 rounded">{t('workflow.list.disabled')}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Status Toggle Switch */}
                  <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                    <button
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        workflow.status === 'active' ? 'bg-[var(--color-success)]' : 'bg-[var(--color-border)]/80'
                      }`}
                      onClick={(e) => handleToggleStatus(workflow, e)}
                      title={workflow.status === 'active' ? t('workflow.list.disableWorkflow') : t('workflow.list.enableWorkflow')}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          workflow.status === 'active' ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                <p
                  className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-4 line-clamp-2 h-8"
                  title={workflow.description}
                >
                  {workflow.description || t('workflow.list.noDescription')}
                </p>

                <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
                  <Clock className="w-3 h-3" />
                  <span>{formatDate(workflow.updated_at)}</span>
                  <span className="mx-1">·</span>
                  <span>{t('workflow.list.nodeCount', { count: workflow.graph_data?.nodes?.length || 0 })}</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-[var(--color-border)]/30 pt-3 mt-2.5">
                <button
                  className="btn btn-secondary btn-sm flex items-center gap-1 cursor-pointer hover:scale-105 active:scale-95 transition-all text-[var(--color-success)] hover:text-[var(--color-success)] hover:border-[var(--color-success)]/40 hover:bg-[var(--color-success-dim)]/20"
                  onClick={(e) => handleRunWorkflow(workflow, e)}
                  title={t('workflow.list.runDirectly')}
                >
                  <Play className="w-3.5 h-3.5 fill-[var(--color-success)]" />
                  <span>{t('workflow.list.run')}</span>
                </button>
                <button
                  className="btn btn-primary btn-sm flex items-center gap-1 cursor-pointer hover:scale-105 active:scale-95 transition-all"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectWorkflow(workflow);
                  }}
                >
                  <Edit className="w-3.5 h-3.5" />
                  <span>{t('workflow.list.edit')}</span>
                </button>
                <button
                  className="btn btn-danger btn-sm flex items-center gap-1 cursor-pointer hover:scale-105 active:scale-95 transition-all"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteConfirmId(workflow.id);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{t('workflow.list.delete')}</span>
                </button>
              </div>
            </div>
          ))}

          {workflows.length === 0 && !isLoading && (
            <div className="col-span-full text-center py-16 bg-[var(--color-bg-surface)] border border-[var(--color-border)] border-dashed rounded-xl text-sm text-[var(--color-text-muted)]">
              {t('workflow.list.empty')}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {deleteConfirmId && (
        <div className="modal-overlay visible z-50">
          <div className="modal animate-fade-in w-[400px] p-6">
            <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-2">
              {t('workflow.list.deleteConfirmTitle')}
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6">
              {t('workflow.list.deleteConfirmDesc')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="btn btn-secondary cursor-pointer"
                onClick={() => setDeleteConfirmId(null)}
              >
                {t('workflow.list.cancel')}
              </button>
              <button
                className="btn btn-danger cursor-pointer"
                onClick={() => handleDelete(deleteConfirmId, '')}
              >
                {t('workflow.list.confirmDelete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
