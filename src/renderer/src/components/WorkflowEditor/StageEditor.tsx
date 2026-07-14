import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, GripVertical, Save, Loader2, Info } from 'lucide-react';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useAgentStore } from '../../stores/agentStore';
import { CustomSelect } from '../ui/CustomSelect';
import type { Workflow, WorkflowStage } from '../../../../shared/types';
import { validateWorkflowStages } from '../../../../shared/workflow-routing';

interface StageEditorProps {
  workflow: Workflow;
  onBack: () => void;
}

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

/**
 * Stage Editor — C-lite 工作流阶段编辑器
 *
 * 将工作流表现为顺序阶段列表，替代旧版图编辑器的 ReactFlow 画布。
 * 每个阶段含：name / taskDescription / acceptanceCriteria / gateEnabled 四个字段。
 */
export function StageEditor({ workflow, onBack }: StageEditorProps) {
  const { t } = useTranslation();
  const storeWorkflow = useWorkflowStore(s => s.currentWorkflow);
  const addStage = useWorkflowStore(s => s.addStage);
  const removeStage = useWorkflowStore(s => s.removeStage);
  const updateStage = useWorkflowStore(s => s.updateStage);
  const moveStageUp = useWorkflowStore(s => s.moveStageUp);
  const moveStageDown = useWorkflowStore(s => s.moveStageDown);
  const reorderStages = useWorkflowStore(s => s.reorderStages);
  const saveWorkflow = useWorkflowStore(s => s.saveWorkflow);
  const setCurrentWorkflow = useWorkflowStore(s => s.setCurrentWorkflow);
  const isLoading = useWorkflowStore(s => s.isLoading);

  const agents = useAgentStore(s => s.agents);
  const fetchAgents = useAgentStore(s => s.fetchAgents);
  const [name, setName] = useState(workflow.name);
  const [workflowId, setWorkflowId] = useState(workflow.id);
  const [masterAgentId, setMasterAgentId] = useState(workflow.master_agent_id ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [isDraggable, setIsDraggable] = useState<number | null>(null);
  const initialised = useRef(false);

  // Sync prop workflow into store on mount (once)
  useEffect(() => {
    if (!initialised.current) {
      initialised.current = true;
      setCurrentWorkflow(workflow);
    }
  }, [workflow, setCurrentWorkflow]);

  // Use stages from store, falling back to prop for initial render
  const stages = storeWorkflow?.stages ?? workflow.stages ?? [];
  const projectAgents = useMemo(
    () => agents.filter(agent => agent.project_id === workflow.project_id),
    [agents, workflow.project_id],
  );

  const agentOptions = useMemo(() => {
    return [
      { value: '', label: t('workflow.editor.selectMasterAgentPlaceholder') },
      ...projectAgents.map(agent => ({ value: agent.id, label: agent.name }))
    ];
  }, [projectAgents, t]);

  useEffect(() => {
    void fetchAgents(workflow.project_id);
  }, [fetchAgents, workflow.project_id]);

  useEffect(() => {
    if (masterAgentId) return;
    const defaultAgent = projectAgents.find(agent => agent.is_default === 1);
    if (defaultAgent) setMasterAgentId(defaultAgent.id);
  }, [masterAgentId, projectAgents]);

  const showToast = (message: string, type: Toast['type'] = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  };

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      showToast(t('workflow.editor.nameEmpty'), 'error');
      return;
    }
    setIsSaving(true);
    try {
      const routeErrors = validateWorkflowStages(stages);
      if (routeErrors.length > 0) {
        showToast(routeErrors.join('\n'), 'error');
        return;
      }
      const saved = await saveWorkflow({
        id: workflowId,
        project_id: workflow.project_id,
        name: name.trim(),
        description: undefined,
        stages,
        master_agent_id: masterAgentId,
        status: workflow.status,
      });
      setWorkflowId(saved.id);
      setCurrentWorkflow(saved);
      showToast(t('workflow.editor.saveSuccess'), 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('workflow.editor.saveFailed'), 'error');
    } finally {
      setIsSaving(false);
    }
  }, [name, workflow, workflowId, stages, masterAgentId, saveWorkflow, setCurrentWorkflow, t]);

  const handleUpdateStage = (stageId: string, field: keyof Pick<WorkflowStage, 'name' | 'taskDescription' | 'acceptanceCriteria' | 'gateEnabled' | 'terminal' | 'routes'>, value: WorkflowStage[typeof field]) => {
    updateStage(stageId, { [field]: value });
  };

  const setStageTerminal = (stage: WorkflowStage, terminal: boolean) => {
    const fallbackTarget = stages.find((candidate) => candidate.id !== stage.id)?.id ?? '';
    updateStage(stage.id, {
      terminal,
      routes: terminal
        ? []
        : (stage.routes?.length ? stage.routes : [{ id: crypto.randomUUID(), targetStageId: fallbackTarget, condition: '' }]),
    });
  };

  const updateRoute = (stage: WorkflowStage, routeId: string, patch: { targetStageId?: string; condition?: string }) => {
    updateStage(stage.id, {
      routes: (stage.routes ?? []).map((route) => route.id === routeId ? { ...route, ...patch } : route),
    });
  };

  const addRoute = (stage: WorkflowStage) => updateStage(stage.id, {
    terminal: false,
    routes: [...(stage.routes ?? []), { id: crypto.randomUUID(), targetStageId: '', condition: '' }],
  });

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDragIdx(idx);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', idx.toString());
    }
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    setDragOverIdx(idx);
  };

  const handleDrop = (e: React.DragEvent, toIdx: number) => {
    e.preventDefault();
    if (dragIdx !== null && dragIdx !== toIdx) {
      reorderStages(dragIdx, toIdx);
    }
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--color-bg-app)] overflow-hidden workflow-stage-editor">
      {/* Top bar */}
      <div className="main-topbar shrink-0 h-12 border-b border-[var(--color-border)]/60 px-4 pl-36 flex justify-between items-center bg-[var(--color-bg-surface)]/80 backdrop-blur-md">
        <div className="main-topbar-left flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] border border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-bg-hover)] text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{t('workflow.editor.back')}</span>
          </button>
          <input
            className="bg-transparent text-[13px] font-bold text-[var(--color-text-primary)] outline-none border-b border-transparent hover:border-[var(--color-border-strong)]/40 focus:border-[var(--color-accent)] transition-all px-1.5 py-0.5 w-[220px] placeholder:text-[var(--color-text-muted)] placeholder:font-normal"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('workflow.editor.workflowNamePlaceholder')}
            aria-label={t('workflow.editor.workflowName')}
          />
        </div>
        <div className="topbar-actions">
          <button
            className="btn btn-secondary btn-sm cursor-pointer animate-none active:scale-[0.97] transition-transform duration-100"
            onClick={handleSave}
            disabled={isSaving || isLoading}
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>{t('workflow.editor.save')}</span>
          </button>
        </div>
      </div>

      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none">
          {toasts.map(toast => (
            <div
              key={toast.id}
              className={`px-4 py-2.5 rounded-[var(--radius-md)] border shadow-[0_4px_12px_rgba(0,0,0,0.15)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.4)] text-xs font-semibold flex items-center gap-2 animate-in slide-in-from-top-2 duration-200 pointer-events-auto
                ${toast.type === 'success' ? 'bg-[var(--color-success-dim)] border-[var(--color-success)]/20 text-[var(--color-success)]' : ''}
                ${toast.type === 'error' ? 'bg-[var(--color-danger-dim)] border-[var(--color-danger)]/20 text-[var(--color-danger)]' : ''}
                ${toast.type === 'info' ? 'bg-[var(--color-accent-dim)] border-[var(--color-accent)]/20 text-[var(--color-accent)]' : ''}`}
            >
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>{toast.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Master Agent selector */}
          <div className="bg-[var(--color-bg-surface)] rounded-[var(--radius-lg)] border border-[var(--color-border)]/60 p-5 shadow-2xs space-y-2.5">
            <label className="block text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider px-0.5">
              {t('workflow.editor.selectMasterAgent')}
            </label>
            <CustomSelect
              id="select-master-agent"
              value={masterAgentId}
              onChange={setMasterAgentId}
              options={agentOptions}
              ariaLabel={t('workflow.editor.selectMasterAgent')}
              buttonClassName="!bg-[var(--color-bg-sunken)]/30 !border-[var(--color-border)]/60 focus:!border-[var(--color-accent)] focus-visible:!border-[var(--color-accent)] !rounded-[var(--radius-md)] !px-3.5 !py-2.5 !text-xs !text-[var(--color-text-primary)] !outline-none !transition-all !cursor-pointer focus-visible:!ring-0 focus-visible:!ring-offset-0 focus-visible:!outline-none"
            />
            <p className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1.5 pt-0.5 px-0.5">
              <Info className="w-3.5 h-3.5 text-[var(--color-accent)]" />
              <span>{t('workflow.editor.stageEditorHelp')}</span>
            </p>
          </div>

          {/* Stage list */}
          <div className="space-y-3.5">
            <div className="flex items-center justify-between px-0.5">
              <h3 className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                {t('workflow.editor.stageCount', { count: stages.length })}
              </h3>
              <button
                className="flex items-center gap-1 px-3 py-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)]/60 bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-hover)] text-xs font-semibold text-[var(--color-text-primary)] cursor-pointer shadow-3xs active:scale-[0.98] transition-all"
                onClick={addStage}
                title={t('workflow.editor.addStageHint')}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('workflow.editor.addStage')}</span>
              </button>
            </div>

            {stages.length === 0 ? (
              <div className="text-center py-16 rounded-[var(--radius-lg)] border border-[var(--color-border)]/60 bg-[var(--color-bg-surface)] text-xs text-[var(--color-text-muted)] shadow-2xs">
                <p>{t('workflow.editor.noStages')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {stages.map((stage, idx) => (
                  <div
                    key={stage.id}
                    className={`bg-[var(--color-bg-surface)] rounded-[var(--radius-lg)] border shadow-2xs transition-all duration-200
                      ${dragOverIdx === idx ? 'border-[var(--color-accent)] border-dashed bg-[var(--color-accent-dim)]/5' : 'border-[var(--color-border)]/60'}
                      ${dragIdx === idx ? 'opacity-40 shadow-inner bg-[var(--color-bg-sunken)]' : 'hover:border-[var(--color-border-strong)]/50 hover:shadow-xs'}`}
                    draggable={isDraggable === idx}
                    onDragStart={(e) => handleDragStart(e, idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDrop={(e) => handleDrop(e, idx)}
                    onDragEnd={() => {
                      handleDragEnd();
                      setIsDraggable(null);
                    }}
                  >
                    <div className="p-4 space-y-3.5">
                      {/* Stage header row */}
                      <div className="flex items-center gap-2.5">
                        <div
                          className="cursor-grab active:cursor-grabbing text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors p-0.5"
                          onMouseDown={() => setIsDraggable(idx)}
                          onMouseUp={() => setIsDraggable(null)}
                        >
                          <GripVertical className="w-4 h-4" />
                        </div>
                        <span className="flex items-center justify-center w-5.5 h-5.5 rounded-full bg-[var(--color-accent-dim)] text-[var(--color-accent)] font-bold text-[10px] font-mono shrink-0 shadow-3xs">
                          #{idx + 1}
                        </span>
                        <div className="flex-1">
                          <input
                            className="w-full bg-transparent text-sm font-semibold text-[var(--color-text-primary)] outline-none border-b border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-accent)] focus:bg-[var(--color-bg-sunken)]/20 rounded px-2 py-1 transition-all"
                            placeholder={t('workflow.editor.stageNamePlaceholder')}
                            value={stage.name}
                            onChange={(e) => handleUpdateStage(stage.id, 'name', e.target.value)}
                          />
                        </div>
                        <div className="flex items-center gap-1 bg-[var(--color-bg-sunken)]/40 p-0.5 rounded border border-[var(--color-border)]/30">
                          <button
                            className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed active:scale-90"
                            onClick={() => moveStageUp(stage.id)}
                            disabled={idx === 0}
                            title={t('workflow.editor.moveUp')}
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed active:scale-90"
                            onClick={() => moveStageDown(stage.id)}
                            disabled={idx === stages.length - 1}
                            title={t('workflow.editor.moveDown')}
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            className="p-1 rounded hover:bg-[var(--color-danger-dim)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors cursor-pointer active:scale-90"
                            onClick={() => removeStage(stage.id)}
                            title={t('workflow.editor.deleteStage')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Task description */}
                      <textarea
                        className="w-full bg-[var(--color-bg-sunken)]/30 border border-[var(--color-border)]/50 focus:border-[var(--color-accent)] rounded-[var(--radius-md)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none transition-all resize-none min-h-[70px] leading-relaxed placeholder:text-[var(--color-text-muted)]"
                        placeholder={t('workflow.editor.taskDescriptionPlaceholder')}
                        value={stage.taskDescription}
                        onChange={(e) => handleUpdateStage(stage.id, 'taskDescription', e.target.value)}
                      />

                      {/* Acceptance criteria + gate toggle */}
                      <div className="flex items-start gap-3">
                        <div className="flex-1">
                          <textarea
                            className="w-full bg-[var(--color-bg-sunken)]/30 border border-[var(--color-border)]/50 focus:border-[var(--color-accent)] rounded-[var(--radius-md)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none transition-all resize-none min-h-[56px] leading-relaxed placeholder:text-[var(--color-text-muted)]"
                            placeholder={t('workflow.editor.acceptanceCriteriaPlaceholder')}
                            value={stage.acceptanceCriteria}
                            onChange={(e) => handleUpdateStage(stage.id, 'acceptanceCriteria', e.target.value)}
                          />
                        </div>
                        <label className="flex items-center gap-2.5 shrink-0 mt-1 cursor-pointer select-none bg-[var(--color-bg-sunken)]/40 hover:bg-[var(--color-bg-sunken)]/80 px-3.5 py-2 rounded-[var(--radius-md)] border border-[var(--color-border)]/50 transition-colors">
                          <input
                            type="checkbox"
                            className="rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-0 focus:ring-offset-0 focus-visible:outline-none cursor-pointer"
                            checked={stage.gateEnabled}
                            onChange={(e) => handleUpdateStage(stage.id, 'gateEnabled', e.target.checked)}
                          />
                          <span className="text-xs font-semibold text-[var(--color-text-secondary)] whitespace-nowrap">
                            {t('workflow.editor.gateEnabled')}
                          </span>
                        </label>
                      </div>

                      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)]/50 bg-[var(--color-bg-sunken)]/20 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold text-[var(--color-text-primary)]">{t('workflow.editor.nextStep')}</span>
                          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={stage.terminal === true}
                              onChange={(event) => setStageTerminal(stage, event.target.checked)}
                            />
                            {t('workflow.editor.completeRun')}
                          </label>
                        </div>
                        {!stage.terminal && (
                          <div className="space-y-2">
                            {(stage.routes ?? []).map((route, routeIndex) => (
                              <div key={route.id} className="grid grid-cols-[minmax(0,1fr)_minmax(9rem,0.7fr)_auto] gap-2 items-center">
                                <input
                                  aria-label={t('workflow.editor.routeCondition', { index: routeIndex + 1 })}
                                  className="min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 py-1.5 text-xs"
                                  placeholder={(stage.routes?.length ?? 0) > 1 ? t('workflow.editor.routeConditionPlaceholder') : t('workflow.editor.onComplete')}
                                  value={route.condition}
                                  onChange={(event) => updateRoute(stage, route.id, { condition: event.target.value })}
                                />
                                <select
                                  aria-label={t('workflow.editor.routeTarget', { index: routeIndex + 1 })}
                                  className="min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 py-1.5 text-xs"
                                  value={route.targetStageId}
                                  onChange={(event) => updateRoute(stage, route.id, { targetStageId: event.target.value })}
                                >
                                  <option value="">{t('workflow.editor.selectRouteTarget')}</option>
                                  {stages.filter((candidate) => candidate.id !== stage.id).map((candidate) => (
                                    <option key={candidate.id} value={candidate.id}>→ {candidate.name || t('workflow.editor.unnamedStage')}</option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  aria-label={t('workflow.editor.removeRoute', { index: routeIndex + 1 })}
                                  className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
                                  onClick={() => updateStage(stage.id, { routes: (stage.routes ?? []).filter((item) => item.id !== route.id) })}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                            <button type="button" className="text-xs text-[var(--color-accent)] hover:underline" onClick={() => addRoute(stage)}>
                              {t('workflow.editor.addRoute')}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
