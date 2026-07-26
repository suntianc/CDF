import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Bot } from 'lucide-react';
import type { Agent } from '@shared/agents';
import type { SceneId } from '@shared/scenes';
import { useAgentStore } from '../../stores/agentStore';

interface MasterPromptDialogProps {
  agent: Agent;
  onClose: () => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  dialogRef: React.RefObject<HTMLDivElement | null>;
  initialFocusRef: React.RefObject<HTMLTextAreaElement | null>;
  onDialogKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Editing surface for the Master Agent: per-Scene system prompt drafts saved
 * atomically. Mounted only while the dialog is open, so closing it discards all
 * unsaved drafts by unmounting.
 */
export function MasterPromptDialog({
  agent,
  onClose,
  showToast,
  dialogRef,
  initialFocusRef,
  onDialogKeyDown,
}: MasterPromptDialogProps) {
  const { t } = useTranslation();
  const {
    masterScenePrompts,
    isLoading,
    isMasterPromptsLoading,
    masterPromptsError,
    fetchMasterScenePrompts,
    saveMasterScenePrompts,
  } = useAgentStore();

  const [masterScene, setMasterScene] = useState<SceneId>('general');
  const [masterDrafts, setMasterDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    void fetchMasterScenePrompts();
  }, [fetchMasterScenePrompts]);

  useEffect(() => {
    if (masterScenePrompts.length === 0) return;
    setMasterDrafts((drafts) => {
      const next = { ...drafts };
      for (const prompt of masterScenePrompts) {
        if (next[prompt.scene] === undefined) next[prompt.scene] = prompt.systemPrompt;
      }
      return next;
    });
  }, [masterScenePrompts]);

  const activeMasterPrompt = masterScenePrompts.find((prompt) => prompt.scene === masterScene);
  const masterPromptsUnavailable = masterScenePrompts.length === 0;
  const masterPromptsBlocked = isLoading
    || isMasterPromptsLoading
    || masterPromptsUnavailable
    || masterPromptsError !== null;

  const handleResetMasterPrompt = () => {
    if (!activeMasterPrompt) return;
    setMasterDrafts((drafts) => ({
      ...drafts,
      [masterScene]: activeMasterPrompt.defaultSystemPrompt,
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (masterPromptsUnavailable || isLoading || isMasterPromptsLoading || masterPromptsError) {
      showToast(t('agent.masterPromptsLoadError'), 'error');
      return;
    }
    try {
      await saveMasterScenePrompts(masterScenePrompts.map((prompt) => ({
        scene: prompt.scene,
        systemPrompt: masterDrafts[prompt.scene] ?? prompt.systemPrompt,
      })));
      showToast(t('agent.masterPromptSaved'), 'success');
      onClose();
    } catch {
      showToast(t('agent.saveError'), 'error');
    }
  };

  return (
    <div className="modal-overlay visible z-50">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="agent-edit-dialog-title" onKeyDown={onDialogKeyDown} className="modal animate-fade-in w-[95%] max-w-[760px] flex flex-col p-0">
        <div className="flex justify-between items-center px-6 py-4 border-b border-[var(--color-border)] shrink-0">
          <h2 id="agent-edit-dialog-title" className="font-semibold text-base text-[var(--color-text-primary)] flex items-center gap-2">
            <Bot className="w-5 h-5 text-[var(--color-accent)]" />
            <span>{t('agent.editTitle', { name: agent.name })}</span>
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-[background-color,color] duration-150 cursor-pointer"
            aria-label={t('common.closeModal')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSave} className="p-6 space-y-4">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sidebar)]/30 p-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">
            {t('agent.masterPromptOnlyHint')}
          </div>
          <div className="form-group">
            <label className="form-label">{t('agent.nameLabel')}</label>
            <input
              className="form-input"
              value={agent.name}
              placeholder={t('agent.namePlaceholder')}
              disabled
            />
          </div>
          {isMasterPromptsLoading && (
            <p role="status" className="text-xs text-[var(--color-text-muted)]">
              {t('agent.masterPromptsLoading')}
            </p>
          )}
          {masterPromptsError && !isMasterPromptsLoading && (
            <p role="alert" className="text-xs text-[var(--color-danger)]">
              {t('agent.masterPromptsLoadError')}
            </p>
          )}
          <div className="flex gap-1 border-b border-[var(--color-border)]" role="tablist" aria-label={t('agent.masterSceneTabs')}>
            {masterScenePrompts.map((prompt) => (
              <button
                key={prompt.scene}
                type="button"
                role="tab"
                aria-selected={masterScene === prompt.scene}
                onClick={() => setMasterScene(prompt.scene)}
                className={`px-3 py-2 text-xs font-medium ${masterScene === prompt.scene
                  ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'}`}
              >
                {prompt.scene === 'general' ? t('agent.masterSceneGeneral') : t('agent.masterSceneResearch')}
              </button>
            ))}
          </div>
          <div className="form-group flex flex-col min-h-[280px]">
            <label className="form-label">{t('agent.systemPromptLabel')}</label>
            <textarea
              ref={initialFocusRef}
              className="form-input flex-1 font-mono text-xs leading-relaxed resize-none p-3 bg-[var(--color-bg-sidebar)]/30 border border-[var(--color-border)]"
              value={activeMasterPrompt ? masterDrafts[masterScene] ?? activeMasterPrompt.systemPrompt : ''}
              onChange={(e) => setMasterDrafts((drafts) => ({ ...drafts, [masterScene]: e.target.value }))}
              placeholder={t('agent.systemPromptPlaceholder')}
              disabled={masterPromptsBlocked}
            />
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
            {t('agent.masterPromptScopeHint')}
          </p>
          <div className="border-t border-[var(--color-border)]/50 pt-4 flex justify-between gap-2">
            <button
              type="button"
              onClick={handleResetMasterPrompt}
              disabled={masterPromptsBlocked}
              className="btn btn-secondary cursor-pointer disabled:cursor-not-allowed"
            >
              {t('agent.resetMasterPrompt')}
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="btn btn-secondary cursor-pointer">
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={masterPromptsBlocked}
                className="btn btn-primary cursor-pointer disabled:cursor-not-allowed"
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
