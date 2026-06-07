import { useState, useEffect } from 'react';
import { Drawer } from 'vaul';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';
import { useProjectStore } from '../../stores/projectStore';
import { Bot, Layers, ShieldCheck, Trash2, PlayCircle, Repeat2, Maximize2, X, ChevronDown, ChevronRight } from 'lucide-react';
import { CustomSelect } from '../ui/CustomSelect';

interface NodeConfigDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  node: {
    id: string;
    type?: string;
    data: {
      label: string;
      description?: string;
      taskDescription?: string;
      workspace?: string;
      workArea?: string;
      loopCount?: number;
      reviewSpec?: string;
      reviewRules?: string;
      agentId?: string;
      failureStrategy?: 'retry' | 'skip' | 'stop';
      retryCount?: number;
      bgColor?: string;
      taskGoal?: string;
      dataSource?: string;
      itemPrompt?: string;
      temperature?: number;
    };
  } | null;
  onUpdateNode: (nodeId: string, data: Record<string, unknown>) => void;
  onDeleteNode?: (nodeId: string) => void;
}

const colorPresets = [
  { nameKey: 'workflow.nodeConfig.colorDefault', value: '', class: 'bg-[var(--color-bg-surface)] border border-[var(--color-border)]' },
  { nameKey: 'workflow.nodeConfig.colorBlue', value: 'rgba(59, 130, 246, 0.12)', class: 'bg-[#3b82f6]' },
  { nameKey: 'workflow.nodeConfig.colorGreen', value: 'rgba(34, 197, 94, 0.12)', class: 'bg-[#10b981]' },
  { nameKey: 'workflow.nodeConfig.colorRed', value: 'rgba(239, 68, 68, 0.12)', class: 'bg-[#ef4444]' },
  { nameKey: 'workflow.nodeConfig.colorPurple', value: 'rgba(139, 92, 246, 0.12)', class: 'bg-[#8b5cf6]' },
  { nameKey: 'workflow.nodeConfig.colorYellow', value: 'rgba(245, 158, 11, 0.12)', class: 'bg-[#f59e0b]' },
];

import { getFolderName } from './utils';

export function NodeConfigDrawer({ isOpen, onClose, node, onUpdateNode, onDeleteNode }: NodeConfigDrawerProps) {
  const { t } = useTranslation();
  const { agents, fetchAgents } = useAgentStore();
  const { currentProjectId } = useProjectStore();

  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [loopCount, setLoopCount] = useState(3);
  const [reviewSpec, setReviewSpec] = useState('');
  const [reviewRules, setReviewRules] = useState('');
  const [agentId, setAgentId] = useState('');
  const [failureStrategy, setFailureStrategy] = useState<'retry' | 'skip' | 'stop'>('stop');
  const [retryCount, setRetryCount] = useState(3);
  const [taskGoal, setTaskGoal] = useState('');
  const [bgColor, setBgColor] = useState('');
  const [dataSource, setDataSource] = useState('');
  const [itemPrompt, setItemPrompt] = useState('');
  const [temperature, setTemperature] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalValue, setModalValue] = useState('');
  const [modalOnSave, setModalOnSave] = useState<((val: string) => void) | null>(null);

  const openEditModal = (title: string, currentValue: string, onSave: (val: string) => void) => {
    setModalTitle(title);
    setModalValue(currentValue);
    setModalOnSave(() => onSave);
    setModalOpen(true);
  };

  const handleSelectWorkspace = async () => {
    try {
      const path = await window.electronAPI.db.selectDirectory();
      if (path) {
        setWorkspace(path);
      }
    } catch (err) {
      console.error('Failed to select directory:', err);
    }
  };

  useEffect(() => {
    if (currentProjectId) {
      fetchAgents(currentProjectId);
    }
  }, [currentProjectId, fetchAgents]);

  useEffect(() => {
    if (node) {
      setLabel(node.data.label || '');
      setDescription(node.data.description || '');
      setTaskDescription(node.data.taskDescription || node.data.description || '');
      setWorkspace(node.data.workspace || '');
      setLoopCount(node.data.loopCount ?? 3);
      setReviewSpec(node.data.reviewSpec || '');
      setReviewRules(node.data.reviewRules || '');
      setAgentId(node.data.agentId || '');
      setFailureStrategy(node.data.failureStrategy || 'stop');
      setRetryCount(node.data.retryCount ?? 3);
      setTaskGoal(node.data.taskGoal || '');
      setBgColor(node.data.bgColor || '');
      setDataSource(node.data.dataSource || '');
      setItemPrompt(node.data.itemPrompt || '');
      setTemperature(node.data.temperature === undefined ? '' : String(node.data.temperature));
    }
  }, [node]);

  const nodeType = node?.type || 'task';
  const isStartNode = nodeType === 'start';
  const isLoopNode = nodeType === 'loop';
  const isForeachNode = nodeType === 'foreach';
  const isReviewNode = nodeType === 'review';
  const isTaskNode = nodeType === 'task' || nodeType === 'agent';
  const needsAgent = isTaskNode || isLoopNode || isReviewNode || isForeachNode;
  const titleIcon = isStartNode ? <PlayCircle className="w-5 h-5 text-[var(--color-success)]" />
    : isLoopNode ? <Repeat2 className="w-5 h-5 text-[var(--color-info)]" />
      : isForeachNode ? <Layers className="w-5 h-5 text-[var(--color-success)]" />
        : isReviewNode ? <ShieldCheck className="w-5 h-5 text-[var(--color-warning)]" />
          : <Bot className="w-5 h-5 text-[var(--color-accent)]" />;

  const handleSave = () => {
    if (!node) return;
    const temperatureNum = temperature === '' ? undefined : Number(temperature);
    onUpdateNode(node.id, {
      label,
      description,
      taskDescription,
      workspace,
      loopCount,
      reviewSpec,
      reviewRules,
      agentId,
      failureStrategy,
      retryCount,
      taskGoal,
      bgColor,
      dataSource,
      itemPrompt,
      ...(temperatureNum !== undefined && !Number.isNaN(temperatureNum) ? { temperature: temperatureNum } : {}),
    });
    onClose();
  };

  const handleClose = () => {
    handleSave();
    onClose();
  };

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          if (modalOpen) return;
          handleClose();
        }
      }}
      direction="right"
      dismissible={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Drawer.Content
          className="fixed right-0 top-0 bottom-0 w-[400px] bg-[var(--color-bg-surface)] border-l border-[var(--color-border)] z-50 flex flex-col"
          aria-label={t('workflow.nodeConfig.title')}
          onPointerDownOutside={(e) => {
            if (modalOpen) e.preventDefault();
          }}
          onFocusOutside={(e) => {
            if (modalOpen) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (modalOpen) e.preventDefault();
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] shrink-0">
            <Drawer.Title className="text-base font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
              {titleIcon}
              {t('workflow.nodeConfig.title')}
            </Drawer.Title>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div className="form-group">
              <label className="form-label">{t('workflow.nodeConfig.nodeName')}</label>
              <input
                className="form-input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t('workflow.nodeConfig.nodeNamePlaceholder')}
              />
            </div>
            <div className="form-group">
              <label className="form-label">{t('workflow.nodeConfig.bgColor')}</label>
              <div className="flex gap-2.5 items-center mt-2">
                {colorPresets.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    title={t(preset.nameKey)}
                    className={`w-6 h-6 rounded-full cursor-pointer transition-all duration-150 relative ${preset.class} ${
                      bgColor === preset.value
                        ? 'ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg-surface)] scale-110'
                        : 'hover:scale-105'
                    }`}
                    onClick={() => setBgColor(preset.value)}
                  >
                    {bgColor === preset.value && (
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white font-bold">
                        ✓
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {isStartNode && (
              <>
                <div className="rounded-lg border border-[var(--color-success)]/20 bg-[var(--color-success-dim)]/20 p-3 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
                  {t('workflow.nodeConfig.startNodeHint')}
                </div>
                <div className="form-group">
                  <label className="form-label">{t('workflow.nodeConfig.workspacePath')}</label>
                  <div className="flex gap-2">
                    <input
                      className="form-input flex-1 cursor-pointer"
                      readOnly
                      onClick={handleSelectWorkspace}
                      value={workspace ? getFolderName(workspace) : ''}
                      placeholder={t('workflow.nodeConfig.workspacePlaceholder')}
                      title={workspace}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary px-3 cursor-pointer shrink-0"
                      onClick={handleSelectWorkspace}
                    >
                      {t('workflow.nodeConfig.select')}
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">{t('workflow.nodeConfig.taskGoal')}</label>
                  <div className="relative group">
                    <textarea
                      className="form-input min-h-[120px] resize-none py-2 pr-10"
                      value={taskGoal}
                      onChange={(e) => setTaskGoal(e.target.value)}
                      placeholder={t('workflow.nodeConfig.taskGoalPlaceholder')}
                    />
                    <button
                      type="button"
                      onClick={() => openEditModal(t('workflow.nodeConfig.editTaskGoal'), taskGoal, setTaskGoal)}
                      className="absolute bottom-2 right-2 p-1.5 rounded bg-[var(--color-bg-sidebar)] border border-[var(--color-border)]/50 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer opacity-40 group-hover:opacity-100 hover:scale-105"
                      title={t('workflow.nodeConfig.fullscreenEdit')}
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </>
            )}

            {(isTaskNode || isLoopNode || isForeachNode) && (
              <div className="form-group">
                <label className="form-label">{t('workflow.nodeConfig.taskDescription')}</label>
                <div className="relative group">
                  <textarea
                    className="form-input min-h-[100px] resize-none py-2 pr-10"
                    value={taskDescription}
                    onChange={(e) => setTaskDescription(e.target.value)}
                    placeholder={t('workflow.nodeConfig.taskDescriptionPlaceholder')}
                  />
                  <button
                    type="button"
                    onClick={() => openEditModal(t('workflow.nodeConfig.editTaskDescription'), taskDescription, setTaskDescription)}
                    className="absolute bottom-2 right-2 p-1.5 rounded bg-[var(--color-bg-sidebar)] border border-[var(--color-border)]/50 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer opacity-40 group-hover:opacity-100 hover:scale-105"
                    title={t('workflow.nodeConfig.fullscreenEdit')}
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {isForeachNode && (
              <>
                <div className="form-group">
                  <label className="form-label">{t('workflow.nodeConfig.dataSourceFile')}</label>
                  <input
                    className="form-input"
                    value={dataSource}
                    onChange={(e) => setDataSource(e.target.value)}
                    placeholder={t('workflow.nodeConfig.dataSourcePlaceholder')}
                  />
                  <p className="mt-1 text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                    {t('workflow.nodeConfig.dataSourceDesc')}
                  </p>
                </div>
                <div className="form-group">
                  <label className="form-label">{t('workflow.nodeConfig.promptTemplate')}</label>
                  <div className="relative group">
                    <textarea
                      className="form-input min-h-[80px] resize-none py-2 pr-10"
                      value={itemPrompt}
                      onChange={(e) => setItemPrompt(e.target.value)}
                      placeholder={t('workflow.nodeConfig.promptTemplatePlaceholder')}
                    />
                    <button
                      type="button"
                      onClick={() => openEditModal(t('workflow.nodeConfig.editPromptTemplate'), itemPrompt, setItemPrompt)}
                      className="absolute bottom-2 right-2 p-1.5 rounded bg-[var(--color-bg-sidebar)] border border-[var(--color-border)]/50 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer opacity-40 group-hover:opacity-100 hover:scale-105"
                      title={t('workflow.nodeConfig.fullscreenEdit')}
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                    {t('workflow.nodeConfig.promptTemplateDesc')}
                  </p>
                </div>
              </>
            )}

            {isLoopNode && (
              <div className="form-group">
                <label className="form-label">{t('workflow.nodeConfig.loopCount')}</label>
                <input
                  type="number"
                  className="form-input"
                  value={loopCount}
                  onChange={(e) => setLoopCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                  min={1}
                  max={50}
                />
              </div>
            )}

            {isReviewNode && (
              <>
                <div className="form-group">
                  <label className="form-label">{t('workflow.nodeConfig.reviewSpec')}</label>
                  <div className="relative group">
                    <textarea
                      className="form-input min-h-[100px] resize-none py-2 pr-10"
                      value={reviewSpec}
                      onChange={(e) => setReviewSpec(e.target.value)}
                      placeholder={t('workflow.nodeConfig.reviewSpecPlaceholder')}
                    />
                    <button
                      type="button"
                      onClick={() => openEditModal(t('workflow.nodeConfig.editReviewSpec'), reviewSpec, setReviewSpec)}
                      className="absolute bottom-2 right-2 p-1.5 rounded bg-[var(--color-bg-sidebar)] border border-[var(--color-border)]/50 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer opacity-40 group-hover:opacity-100 hover:scale-105"
                      title={t('workflow.nodeConfig.fullscreenEdit')}
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">{t('workflow.nodeConfig.conditionRules')}</label>
                  <div className="relative group">
                    <textarea
                      className="form-input min-h-[110px] resize-none py-2 pr-10"
                      value={reviewRules}
                      onChange={(e) => setReviewRules(e.target.value)}
                      placeholder={t('workflow.nodeConfig.conditionRulesPlaceholder')}
                    />
                    <button
                      type="button"
                      onClick={() => openEditModal(t('workflow.nodeConfig.editConditionRules'), reviewRules, setReviewRules)}
                      className="absolute bottom-2 right-2 p-1.5 rounded bg-[var(--color-bg-sidebar)] border border-[var(--color-border)]/50 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer opacity-40 group-hover:opacity-100 hover:scale-105"
                      title={t('workflow.nodeConfig.fullscreenEdit')}
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </>
            )}


            {needsAgent && (
              <div className="form-group">
                <label className="form-label">{t('workflow.nodeConfig.selectAgent')}</label>
                <CustomSelect
                  value={agentId}
                  onChange={(val) => setAgentId(val)}
                  options={[
                    { value: '', label: t('workflow.nodeConfig.noAgent') },
                    ...agents.map((agent) => ({ value: agent.id, label: agent.name }))
                  ]}
                  placeholder={t('workflow.nodeConfig.selectAgentPlaceholder')}
                />
              </div>
            )}


            {needsAgent && <div className="form-group">
              <label className="form-label">{t('workflow.nodeConfig.failureStrategy')}</label>
              <CustomSelect
                value={failureStrategy}
                onChange={(val) => setFailureStrategy(val as 'retry' | 'skip' | 'stop')}
                options={[
                  { value: 'retry', label: t('workflow.nodeConfig.strategyRetry') },
                  { value: 'skip', label: t('workflow.nodeConfig.strategySkip') },
                  { value: 'stop', label: t('workflow.nodeConfig.strategyStop') },
                ]}
              />
            </div>}

            {needsAgent && failureStrategy === 'retry' && (
              <div className="form-group">
                <label className="form-label">{t('workflow.nodeConfig.retryCount')}</label>
                <input
                  type="number"
                  className="form-input"
                  value={retryCount}
                  onChange={(e) => setRetryCount(Math.max(1, parseInt(e.target.value) || 1))}
                  min={1}
                  max={10}
                />
              </div>
            )}

            {needsAgent && (
              <div className="form-group">
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
                  onClick={() => setAdvancedOpen((v) => !v)}
                >
                  {advancedOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  {t('workflow.nodeConfig.advancedLLM')}
                </button>
                {advancedOpen && (
                  <div className="mt-2 space-y-3 pl-1 border-l-2 border-[var(--color-border)]/30 pl-3">
                    <p className="text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                      {t('workflow.nodeConfig.advancedHint')}
                    </p>
                    <div className="form-group">
                      <label className="form-label">Temperature</label>
                      <input
                        type="number"
                        className="form-input"
                        value={temperature}
                        onChange={(e) => setTemperature(e.target.value)}
                        step="0.1"
                        min="0"
                        max="2"
                        placeholder={t('workflow.nodeConfig.temperaturePlaceholder')}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-[var(--color-border)] shrink-0">
            <button
              className="btn btn-danger cursor-pointer"
              onClick={() => node && onDeleteNode?.(node.id)}
              disabled={!node || !onDeleteNode || isStartNode}
            >
              <Trash2 className="w-4 h-4" />
              {t('workflow.nodeConfig.deleteNode')}
            </button>
            <div className="flex justify-end gap-2">
              <button className="btn btn-primary cursor-pointer" onClick={handleClose}>
                {t('workflow.nodeConfig.close')}
              </button>
            </div>
          </div>
        </Drawer.Content>

        {/* Large Text Edit Modal */}
        <Dialog.Root open={modalOpen} onOpenChange={setModalOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-6" />
            <Dialog.Content className="fixed left-[50%] top-[50%] z-[10000] translate-x-[-50%] translate-y-[-50%] bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl w-[640px] max-w-full h-[480px] flex flex-col shadow-2xl overflow-hidden focus:outline-none">
              {/* Modal Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]/50">
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">{modalTitle}</span>
                <Dialog.Close asChild>
                  <button
                    className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </Dialog.Close>
              </div>
              {/* Modal Body */}
              <div className="flex-1 p-5">
                <textarea
                  autoFocus
                  className="w-full h-full bg-black/15 border border-[var(--color-border)]/50 rounded-lg p-3 text-xs leading-relaxed text-[var(--color-text-primary)] font-mono resize-none focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]/30"
                  value={modalValue}
                  onChange={(e) => setModalValue(e.target.value)}
                  placeholder={t('workflow.nodeConfig.modalPlaceholder')}
                />
              </div>
              {/* Modal Footer */}
              <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[var(--color-border)]/50 bg-black/5">
                <Dialog.Close asChild>
                  <button
                    className="btn btn-secondary text-xs py-1.5 px-3 cursor-pointer"
                  >
                    {t('workflow.nodeConfig.cancel')}
                  </button>
                </Dialog.Close>
                <button
                  onClick={() => {
                    modalOnSave?.(modalValue);
                    setModalOpen(false);
                  }}
                  className="btn btn-primary text-xs py-1.5 px-4 cursor-pointer"
                >
                  {t('workflow.nodeConfig.save')}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
