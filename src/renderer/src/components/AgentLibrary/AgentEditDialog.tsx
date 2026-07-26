import React, { useEffect, useMemo, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Bot, ShieldCheck } from 'lucide-react';
import { useAgentStore } from '../../stores/agentStore';
import { useAISubscriptionStore } from '../../stores/aiSubscriptionStore';
import { useLLMStore } from '../../stores/llmStore';
import { useSkillStore } from '../../stores/skillStore';
import { useMcpServerStore } from '../../stores/mcpServerStore';
import { ModelSelectionSurface } from '../ChatArea/modelSelection/ModelSelectionSurface';
import { buildModelSelectionGroups } from '../ChatArea/modelSelection/useModelSelectionController';
import { getAgentErrorTranslationKey } from './agentErrorI18n';
import {
  agentFormReducer,
  buildAgentSavePayload,
  createEmptyAgentFormState,
  deriveAgentFormState,
  findDefaultModelGroup,
  getAgentFormValidationError,
} from './agentEditForm';
import { MasterPromptDialog } from './MasterPromptDialog';
import { ToolScopeSection } from './ToolScopeSection';
import { McpVisibilitySection } from './McpVisibilitySection';
import { SkillPreloadSection } from './SkillPreloadSection';

interface AgentEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string | null; // Null means create, non-null means edit
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function AgentEditDialog({ isOpen, onClose, agentId, showToast }: AgentEditDialogProps) {
  const { t } = useTranslation();
  const {
    agents,
    createCustomAgent,
    updateCustomAgent,
    updateGeneralPurposeAgent,
  } = useAgentStore();
  const { providers, isLoading: providersLoading } = useLLMStore();
  const {
    entries: aiSubscriptionEntries,
    isLoading: aiSubscriptionsLoading,
  } = useAISubscriptionStore();
  const { skills } = useSkillStore();
  const { mcpServers } = useMcpServerStore();

  const [form, dispatch] = useReducer(agentFormReducer, undefined, createEmptyAgentFormState);

  const dialogRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<HTMLTextAreaElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const formInitializationKeyRef = useRef<string | null>(null);
  const editingAgent = agentId ? agents.find(agent => agent.id === agentId) : undefined;
  const isMasterAgent = editingAgent?.role === 'master';
  const isProtectedAgent = editingAgent !== undefined && editingAgent.role !== 'custom';
  const modelGroups = useMemo(
    () => buildModelSelectionGroups(providers, aiSubscriptionEntries),
    [aiSubscriptionEntries, providers],
  );

  useEffect(() => {
    if (!isOpen) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    initialFocusRef.current?.focus();
    return () => {
      returnFocusRef.current?.focus();
    };
  }, [isOpen]);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Initialize/Reset the form once per opened agent (or once per create session).
  useEffect(() => {
    if (!isOpen) {
      formInitializationKeyRef.current = null;
      return;
    }

    const initializationKey = agentId || '__create__';
    if (formInitializationKeyRef.current === initializationKey) return;
    const agent = agentId ? agents.find(candidate => candidate.id === agentId) : undefined;
    if (agentId && !agent) return;
    formInitializationKeyRef.current = initializationKey;

    dispatch({
      type: 'reset',
      state: deriveAgentFormState({ agent, modelGroups, providers, providersLoading, aiSubscriptionsLoading }),
    });
  }, [
    agentId,
    agents,
    aiSubscriptionsLoading,
    isOpen,
    modelGroups,
    providers,
    providersLoading,
  ]);

  // A fresh Custom Agent draft may start before model sources finish loading:
  // fill in the default selection once they arrive, without touching other fields.
  useEffect(() => {
    if (
      !isOpen
      || agentId
      || form.sourceId
      || providersLoading
      || aiSubscriptionsLoading
      || modelGroups.length === 0
    ) return;
    const selectedGroup = findDefaultModelGroup(modelGroups, providers);
    if (!selectedGroup) return;
    dispatch({
      type: 'selectModel',
      sourceType: selectedGroup.sourceType,
      sourceId: selectedGroup.sourceId,
      model: selectedGroup.candidates[0]?.model || '',
    });
  }, [
    agentId,
    aiSubscriptionsLoading,
    form.sourceId,
    isOpen,
    modelGroups,
    providers,
    providersLoading,
  ]);

  const handleSaveAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = getAgentFormValidationError(form, isProtectedAgent);
    if (validationError) {
      showToast(t(validationError), 'error');
      return;
    }

    const existingAgent = agentId ? agents.find((item) => item.id === agentId) : null;
    const payload = buildAgentSavePayload(form, {
      id: agentId || window.crypto.randomUUID(),
      existingConfig: existingAgent?.config,
    });

    try {
      if (!existingAgent) await createCustomAgent(payload);
      else if (existingAgent.role === 'general-purpose') {
        const { id: _id, name: _name, ...capabilities } = payload;
        await updateGeneralPurposeAgent(capabilities);
      } else await updateCustomAgent(existingAgent.id, payload);
      showToast(t('agent.savedSuccess', { name: form.name }), 'success');
      onClose();
    } catch (error) {
      showToast(t(getAgentErrorTranslationKey(error)), 'error');
    }
  };

  const selectedModelGroup = modelGroups.find(group => (
    group.sourceType === form.modelSource && group.sourceId === form.sourceId
  ));
  const selectedModelCandidate = selectedModelGroup?.candidates.find(candidate => candidate.model === form.model);

  if (!isOpen) return null;

  if (isMasterAgent && editingAgent) {
    return (
      <MasterPromptDialog
        agent={editingAgent}
        onClose={onClose}
        showToast={showToast}
        dialogRef={dialogRef}
        initialFocusRef={initialFocusRef}
        onDialogKeyDown={handleDialogKeyDown}
      />
    );
  }

  return (
    <div className="modal-overlay visible z-50">
      <div className="modal animate-fade-in w-[95%] max-w-[1200px] h-[90vh] flex flex-col p-0">
        {/* Modal Title */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-[var(--color-border)] shrink-0">
          <span className="font-semibold text-base text-[var(--color-text-primary)] flex items-center gap-2">
            <Bot className="w-5 h-5 text-[var(--color-accent)]" />
            <span>{agentId ? t('agent.editTitle', { name: form.name }) : t('agent.createTitle')}</span>
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-[background-color,color] duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            aria-label={t('common.closeModal')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content - Two Columns */}
        <form onSubmit={handleSaveAgent} className="flex-1 flex overflow-hidden min-h-0">
          {/* Left Column - Core Configuration (40%) */}
          <div className="w-[40%] border-r border-[var(--color-border)] p-6 overflow-y-auto space-y-4">
            <div className="text-[12px] font-semibold text-[var(--color-text-secondary)] mb-2 flex items-center gap-1.5">
              <span>{t('agent.sectionBasic')}</span>
            </div>

            <div className="form-group">
              <label className="form-label">{t('agent.nameLabel')} <span className="text-[var(--color-danger)]">*</span></label>
              <input
                className="form-input"
                value={form.name}
                onChange={(e) => dispatch({ type: 'patch', patch: { name: e.target.value } })}
                placeholder={t('agent.namePlaceholder')}
                disabled={isProtectedAgent}
                required
              />
              {isProtectedAgent && (
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                  {t('agent.protectedAgentHint')}
                </p>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">{t('agent.descLabel')}</label>
              <textarea
                className="form-input min-h-[80px] resize-none py-2"
                value={form.description}
                onChange={(e) => dispatch({ type: 'patch', patch: { description: e.target.value } })}
                placeholder={t('agent.descPlaceholder')}
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                {t('agent.providerLabel')}
                {!isProtectedAgent && <span className="text-[var(--color-danger)]"> *</span>}
              </label>
              <ModelSelectionSurface
                variant="welcome"
                modelGroups={modelGroups}
                selectedSourceType={form.modelSource || 'llm_provider'}
                selectedSourceId={form.sourceId}
                selectedModel={form.model}
                currentModelLabel={selectedModelCandidate?.label || form.model}
                currentProviderType={selectedModelCandidate?.providerType}
                onSelectModel={(sourceType, sourceId, model) => {
                  dispatch({ type: 'selectModel', sourceType, sourceId, model });
                }}
                selectedReasoningEffort={form.reasoningEffort}
                onSelectReasoningEffort={(effort) => dispatch({ type: 'setReasoningEffort', effort })}
                inheritOption={isProtectedAgent ? {
                  selected: !form.sourceId,
                  label: t('agent.inheritInvokingModel'),
                  onSelect: () => {
                    dispatch({ type: 'selectModel', sourceType: '', sourceId: '', model: '' });
                  },
                } : undefined}
              />
              {isProtectedAgent && !form.sourceId && (
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                  {t('agent.inheritedModelHint')}
                </p>
              )}
            </div>
          </div>

          {/* Right Column - Ability & Prompt Config (60%) */}
          <div className="w-[60%] p-6 overflow-y-auto flex flex-col min-h-0">
            <div className="text-[12px] font-semibold text-[var(--color-text-secondary)] mb-3 flex items-center gap-1.5">
              <span>{t('agent.sectionAbilities')}</span>
            </div>

            <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sidebar)]/30 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-primary)]">
                <ShieldCheck className="w-4 h-4 text-[var(--color-success)]" />
                {t('agent.safetyConfig')}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-[var(--color-text-secondary)]">
                <div className="rounded border border-[var(--color-border)]/50 p-2">
                  {t('agent.safetyFilePerms')}
                </div>
                <div className="rounded border border-[var(--color-border)]/50 p-2">
                  {t('agent.safetyApproval')}
                </div>
              </div>
            </div>

            {/* System Prompt Textarea */}
            <div className="form-group flex-1 flex flex-col mb-4 min-h-[160px]">
              <label className="form-label">{t('agent.systemPromptLabel')}</label>
              <textarea
                className="form-input flex-1 font-mono text-xs leading-relaxed resize-none p-3 bg-[var(--color-bg-sidebar)]/30 border border-[var(--color-border)]"
                value={form.systemPrompt}
                onChange={(e) => dispatch({ type: 'patch', patch: { systemPrompt: e.target.value } })}
                placeholder={t('agent.systemPromptPlaceholder')}
              />
            </div>

            <ToolScopeSection
              mode={form.toolScopeMode}
              builtInTools={form.builtInTools}
              toolScopeMcpServerIds={form.toolScopeMcpServerIds}
              mcpServers={mcpServers}
              onModeChange={(mode) => dispatch({ type: 'patch', patch: { toolScopeMode: mode } })}
              onToggleBuiltInTool={(toolName) => dispatch({ type: 'toggleListItem', field: 'builtInTools', id: toolName })}
              onToggleMcpServer={(serverId) => dispatch({ type: 'toggleListItem', field: 'toolScopeMcpServerIds', id: serverId })}
            />

            {/* MCP visibility and Skill Preload controls */}
            <div className="grid grid-cols-2 gap-4">
              <McpVisibilitySection
                mcpServers={mcpServers}
                exclusionIds={form.mcpExclusionIds}
                onToggleExclusion={(serverId) => dispatch({ type: 'toggleListItem', field: 'mcpExclusionIds', id: serverId })}
              />
              <SkillPreloadSection
                key={agentId || '__create__'}
                skills={skills}
                selectedSkillIds={form.skillIds}
                onToggleSkill={(skillId) => dispatch({ type: 'toggleListItem', field: 'skillIds', id: skillId })}
              />
            </div>

            {/* Submit actions inside columns */}
            <div className="border-t border-[var(--color-border)]/50 pt-4 mt-6 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="btn btn-secondary cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="btn btn-primary cursor-pointer"
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
