import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useWorkflowRunStore } from '../../stores/workflowRunStore';
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
  const { t, i18n } = useTranslation();
  const { workflows, isLoading, error, fetchWorkflows, deleteWorkflow, saveWorkflow } = useWorkflowStore();
  const startRun = useWorkflowRunStore((state) => state.startRun);
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
    if (!currentProjectId) return;
    try {
      await deleteWorkflow(id, currentProjectId);
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
    if (workflow.stages.length === 0) {
      showToast(t('workflow.list.runRequiresStage'), 'error');
      return;
    }

    if (!currentProjectId) return;
    try {
      showToast(t('workflow.list.startingWorkflow'), 'info');
      await startRun(workflow.id, currentProjectId);
      showToast(t('workflow.list.workflowStarted'), 'success');
    } catch (err: any) {
      showToast(err.message || t('workflow.list.runFailed'), 'error');
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(i18n.language, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--color-bg-app)] overflow-hidden relative">
      {/* Toast Notification Container */}
      <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[var(--z-toast)] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div 
            key={t.id} 
            className={`p-3 rounded-[var(--radius-md)] text-xs font-semibold flex items-center gap-2 transition-[opacity,transform] duration-200 animate-slide-in pointer-events-auto border ${
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

      <header className="main-topbar shrink-0 h-10 flex items-center justify-between">
        <div className="main-topbar-left">
          <span className="text-xs text-[var(--color-text-muted)] font-normal">
            {t('sidebar.settings.workflowsDesc')}
          </span>
        </div>
      </header>

      {/* Content */}
      <div className="settings-content overflow-y-auto flex-1 px-5 pb-6 pt-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div className="text-[13px] font-semibold tabular-nums text-[var(--color-text-primary)]">
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
        <div className="resource-card-grid">
          {isLoading && workflows.length === 0 && (
            <>
              <span className="sr-only" role="status">{t('workflow.list.loading')}</span>
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  aria-hidden="true"
                  className="provider-card resource-square-card flex min-h-[220px] flex-col gap-4 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-1 items-center gap-3">
                      <div className="h-8 w-8 rounded-[var(--radius-sm)] bg-[var(--color-bg-sunken)] animate-pulse" />
                      <div className="h-4 w-28 rounded-[var(--radius-xs)] bg-[var(--color-bg-sunken)] animate-pulse" />
                    </div>
                    <div className="h-5 w-9 rounded-full bg-[var(--color-bg-sunken)] animate-pulse" />
                  </div>
                  <div className="h-3 w-3/4 rounded-[var(--radius-xs)] bg-[var(--color-bg-sunken)] animate-pulse" />
                  <div className="h-3 w-1/2 rounded-[var(--radius-xs)] bg-[var(--color-bg-sunken)] animate-pulse" />
                  <div className="mt-auto flex justify-end gap-2 border-t border-[var(--color-border)]/30 pt-3">
                    <div className="h-7 w-14 rounded-[var(--radius-sm)] bg-[var(--color-bg-sunken)] animate-pulse" />
                    <div className="h-7 w-14 rounded-[var(--radius-sm)] bg-[var(--color-bg-sunken)] animate-pulse" />
                  </div>
                </div>
              ))}
            </>
          )}
          {workflows.map((workflow) => (
            <div
              key={workflow.id}
              className="provider-card resource-square-card flex flex-col p-4 border border-[var(--color-border)]/50 hover:border-[var(--color-border-strong)] rounded-[var(--radius-md)] bg-[var(--color-bg-surface)] transition-all duration-200 hover:shadow-sm group cursor-pointer relative"
              onClick={() => onSelectWorkflow(workflow)}
            >
              <div className="min-w-0 flex-1 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 truncate">
                    <div className="provider-icon bg-[var(--color-accent-dim)]/40 flex items-center justify-center p-1.5 rounded-[var(--radius-sm)] border-0 shrink-0">
                      <GitBranch className="w-5 h-5 text-[var(--color-accent)]" />
                    </div>
                    <div className="truncate">
                      <div className="font-semibold text-sm text-[var(--color-text-primary)] truncate">
                        {workflow.name}
                      </div>
                      <div className="text-[10px] font-medium mt-1">
                        {workflow.status === 'active' ? (
                          <span className="text-[var(--color-success)] bg-[var(--color-success-dim)] px-1.5 py-0.5 rounded-[var(--radius-xs)]">{t('workflow.list.enabled')}</span>
                        ) : (
                          <span className="text-[var(--color-text-muted)] bg-[var(--color-bg-active)] px-1.5 py-0.5 rounded-[var(--radius-xs)]">{t('workflow.list.disabled')}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Status Toggle Switch */}
                  <div className="flex items-center shrink-0" onClick={(e) => e.stopPropagation()}>
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

                {/* Workflow Description (Only render if it actually exists) */}
                {workflow.description && (
                  <p
                    className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-1 truncate"
                    title={workflow.description}
                  >
                    {workflow.description}
                  </p>
                )}

                {/* Metadata row */}
                <div className="flex flex-wrap items-center gap-2 mt-auto">
                  <div className="flex items-center gap-1.5 text-[11px] tabular-nums text-[var(--color-text-muted)]">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{formatDate(workflow.updated_at)}</span>
                  </div>
                  <span className="text-[var(--color-text-disabled)] text-[10px]">·</span>
                  <div className="inline-flex items-center text-[10px] font-semibold bg-[var(--color-bg-sunken)] text-[var(--color-text-secondary)] px-1.5 py-0.5 rounded-[var(--radius-sm)] border border-[var(--color-border)]/40">
                    {t('workflow.list.stageCount', { count: workflow.stages.length })}
                  </div>
                </div>
              </div>

              {/* Action buttons with silent default colors and semantic hover highlights */}
              <div 
                className="mt-4 flex shrink-0 items-center justify-end gap-2 border-t border-[var(--color-border)]/30 pt-3"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="btn btn-sm flex items-center gap-1 cursor-pointer border border-[var(--color-border)] bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-success-dim)] hover:text-[var(--color-success)] hover:border-[var(--color-success)]/40 transition-all duration-150 active:scale-95"
                  onClick={(e) => handleRunWorkflow(workflow, e)}
                  title={t('workflow.list.runDirectly')}
                >
                  <Play className="w-3.5 h-3.5 fill-current text-[var(--color-success)]" />
                  <span>{t('workflow.list.run')}</span>
                </button>
                <button
                  className="btn btn-sm flex items-center gap-1 cursor-pointer border border-[var(--color-border)] bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-dim)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/40 transition-all duration-150 active:scale-95"
                  onClick={() => onSelectWorkflow(workflow)}
                >
                  <Edit className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                  <span>{t('workflow.list.edit')}</span>
                </button>
                <button
                  className="btn btn-sm flex items-center gap-1 cursor-pointer border border-[var(--color-border)] bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-danger-dim)] hover:text-[var(--color-danger)] hover:border-[var(--color-danger)]/40 transition-all duration-150 active:scale-95"
                  onClick={() => setDeleteConfirmId(workflow.id)}
                >
                  <Trash2 className="w-3.5 h-3.5 text-[var(--color-danger)]" />
                  <span>{t('workflow.list.delete')}</span>
                </button>
              </div>
            </div>
          ))}

          {workflows.length === 0 && !isLoading && (
            <div className="col-span-full flex flex-col items-start gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface)] px-6 py-10 text-sm text-[var(--color-text-muted)]">
              <span>{t('workflow.list.empty')}</span>
              <button className="btn btn-primary" onClick={onCreateWorkflow}>{t('workflow.list.newWorkflow')}</button>
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
