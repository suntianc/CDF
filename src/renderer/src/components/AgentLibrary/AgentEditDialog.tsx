import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';
import { useLLMStore } from '../../stores/llmStore';
import { useSkillStore } from '../../stores/skillStore';
import { useMcpServerStore } from '../../stores/mcpServerStore';
import { useProjectStore } from '../../stores/projectStore';
import {
  AGENT_BUILT_IN_TOOL_NAMES,
  type AgentToolScopeConfig,
} from '../../../../shared/agents';
import {
  X, Bot, Brain, Layers, Cpu, ShieldCheck, Plus, Search
} from 'lucide-react';
import { CustomSelect } from '../ui/CustomSelect';

interface AgentEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string | null; // Null means create, non-null means edit
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

function readToolScopeFromConfig(config?: Record<string, unknown>): AgentToolScopeConfig {
  const raw = config?.toolScope;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { mode: 'inherit' };
  const value = raw as Record<string, unknown>;
  if (value.mode !== 'narrow') return { mode: 'inherit' };
  return {
    mode: 'narrow',
    builtInTools: Array.isArray(value.builtInTools)
      ? value.builtInTools.filter((item): item is string => typeof item === 'string')
      : [],
    mcpServerIds: Array.isArray(value.mcpServerIds)
      ? value.mcpServerIds.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function getSkillDisplayName(skill: { name: string; qualifiedName?: string | null }): string {
  return skill.qualifiedName?.trim() || skill.name;
}

export function AgentEditDialog({ isOpen, onClose, agentId, showToast }: AgentEditDialogProps) {
  const { t } = useTranslation();
  const { agents, saveAgent, resetMasterAgentPrompt } = useAgentStore();
  const { providers } = useLLMStore();
  const { skills } = useSkillStore();
  const { mcpServers } = useMcpServerStore();
  const { currentProjectId } = useProjectStore();

  // Form State
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formProviderId, setFormProviderId] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formSystemPrompt, setFormSystemPrompt] = useState('');
  const [formMcpExclusionIds, setFormMcpExclusionIds] = useState<string[]>([]);
  const [formSkillIds, setFormSkillIds] = useState<string[]>([]);
  const [formToolScopeMode, setFormToolScopeMode] = useState<AgentToolScopeConfig['mode']>('inherit');
  const [formBuiltInTools, setFormBuiltInTools] = useState<string[]>([]);
  const [formToolScopeMcpServerIds, setFormToolScopeMcpServerIds] = useState<string[]>([]);

  // Multi-selector dropdown states
  const [skillDropdownOpen, setSkillDropdownOpen] = useState(false);

  // Search query states for MCP visibility and Skill Preload controls
  const [mcpSearchQuery, setMcpSearchQuery] = useState('');
  const [skillSearchQuery, setSkillSearchQuery] = useState('');

  // Reset search queries when dropdowns close
  useEffect(() => {
    if (!skillDropdownOpen) setSkillSearchQuery('');
  }, [skillDropdownOpen]);

  const skillContainerRef = useRef<HTMLDivElement>(null);
  const editingAgent = agentId ? agents.find(agent => agent.id === agentId) : undefined;
  const isMasterAgent = editingAgent?.role === 'master' || editingAgent?.slug === 'master-agent';
  const isProtectedAgent = editingAgent?.is_protected === true || isMasterAgent || editingAgent?.slug === 'general-purpose';

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (skillContainerRef.current && !skillContainerRef.current.contains(event.target as Node)) {
        setSkillDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Initialize/Reset form states when agentId changes
  useEffect(() => {
    if (!isOpen) return;

    if (agentId) {
      const agent = agents.find(a => a.id === agentId);
      if (agent) {
        setFormName(agent.name);
        setFormDesc(agent.description || '');
        const activeProvider = providers.find(p => p.is_active === 1) || providers[0];
        setFormProviderId(agent.provider_id || (agent.is_protected || agent.role === 'master' || agent.slug === 'general-purpose' ? '' : activeProvider?.id || ''));
        setFormModel(typeof agent.config?.model === 'string' ? agent.config.model : '');
        setFormSystemPrompt(agent.system_prompt || '');
        setFormMcpExclusionIds(agent.mcpServerExclusionIds || []);
        setFormSkillIds(agent.skillNames || []);
        const toolScope = readToolScopeFromConfig(agent.config);
        setFormToolScopeMode(toolScope.mode);
        setFormBuiltInTools(toolScope.builtInTools ?? []);
        setFormToolScopeMcpServerIds(toolScope.mcpServerIds ?? []);
      }
    } else {
      setFormName('');
      setFormDesc('');
      const activeProvider = providers.find(p => p.is_active === 1) || providers[0];
      setFormProviderId(activeProvider?.id || '');
      setFormModel('');
      setFormSystemPrompt('');
      setFormMcpExclusionIds([]);
      setFormSkillIds([]);
      setFormToolScopeMode('inherit');
      setFormBuiltInTools([]);
      setFormToolScopeMcpServerIds([]);
    }
    setSkillDropdownOpen(false);
  }, [isOpen, agentId, agents, providers]);

  const handleSaveAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isMasterAgent && editingAgent) {
      try {
        await saveAgent({
          id: editingAgent.id,
          project_id: editingAgent.project_id,
          system_prompt: formSystemPrompt,
        });
        showToast(t('agent.masterPromptSaved'), 'success');
        onClose();
      } catch {
        showToast(t('agent.saveError'), 'error');
      }
      return;
    }
    if (!formName.trim()) {
      showToast(t('agent.nameRequired'), 'error');
      return;
    }

    const ENGLISH_NAME_REGEX = /^[A-Za-z0-9\s\-_]+$/;
    if (!ENGLISH_NAME_REGEX.test(formName.trim())) {
      showToast(t('agent.nameEnglishOnly'), 'error');
      return;
    }

    if (!formProviderId && !isProtectedAgent) {
      showToast(t('agent.providerRequired'), 'error');
      return;
    }

    const id = agentId || window.crypto.randomUUID();
    const existingAgent = agentId ? agents.find((item) => item.id === agentId) : null;
    const defaultExists = agents.some((item) => item.project_id === (currentProjectId || 'default-project') && item.is_default === 1);
    const nextConfig: Record<string, unknown> = {
      ...(existingAgent?.config ?? {}),
      permissionsPreset: 'project-safe',
      approvalPreset: 'write-operations',
      toolScope: formToolScopeMode === 'narrow'
        ? {
            mode: 'narrow',
            builtInTools: formBuiltInTools,
            mcpServerIds: formToolScopeMcpServerIds,
          }
        : { mode: 'inherit' },
    };
    if (formModel) nextConfig.model = formModel;
    else delete nextConfig.model;

    const payload = {
      id,
      project_id: currentProjectId || 'default-project',
      name: formName,
      description: formDesc,
      provider_id: formProviderId || null,
      system_prompt: formSystemPrompt,
      config: nextConfig,
      mcpServerExclusionIds: formMcpExclusionIds,
      skillNames: formSkillIds,
      is_default: existingAgent?.is_default ?? (defaultExists ? 0 : 1),
    };

    try {
      await saveAgent(payload);
      showToast(t('agent.savedSuccess', { name: formName }), 'success');
      onClose();
    } catch (err) {
      showToast(t('agent.saveError'), 'error');
    }
  };

  const toggleMcpExclusion = (mcpId: string) => {
    setFormMcpExclusionIds(prev =>
      prev.includes(mcpId) ? prev.filter(id => id !== mcpId) : [...prev, mcpId]
    );
  };

  const toggleSkillPreload = (skillId: string) => {
    setFormSkillIds(prev =>
      prev.includes(skillId) ? prev.filter(id => id !== skillId) : [...prev, skillId]
    );
  };

  const toggleBuiltInTool = (toolName: string) => {
    setFormBuiltInTools(prev => prev.includes(toolName)
      ? prev.filter(name => name !== toolName)
      : [...prev, toolName]);
  };

  const toggleToolScopeMcpServer = (serverId: string) => {
    setFormToolScopeMcpServerIds(prev => prev.includes(serverId)
      ? prev.filter(id => id !== serverId)
      : [...prev, serverId]);
  };

  const skillPreloadCandidates = skills.filter(sk => {
    const query = skillSearchQuery.toLowerCase();
    return sk.name.toLowerCase().includes(query)
      || getSkillDisplayName(sk).toLowerCase().includes(query)
      || (sk.sourceLabel || '').toLowerCase().includes(query);
  });

  const mcpVisibilityCandidates = mcpServers.filter(server =>
    server.name.toLowerCase().includes(mcpSearchQuery.toLowerCase())
  );
  const visibleMcpCount = mcpServers.filter(server => !formMcpExclusionIds.includes(server.id)).length;
  const selectedProvider = providers.find(provider => provider.id === formProviderId);
  const modelOptions = selectedProvider
    ? [
        { value: '', label: t('agent.providerDefaultModel', { model: selectedProvider.default_model }) },
        ...Array.from(new Set([selectedProvider.default_model, ...(selectedProvider.models ?? [])]))
          .map(model => ({ value: model, label: model })),
      ]
    : [];

  const getSkillSourceLabel = (skill: { scope: string; sourceLabel?: string | null }) =>
    skill.sourceLabel || (skill.scope === 'project' ? t('agent.skillSourceProject') : t('agent.skillSourceGlobal'));

  if (!isOpen) return null;

  if (isMasterAgent && editingAgent) {
    const handleResetMasterPrompt = async () => {
      try {
        await resetMasterAgentPrompt(editingAgent.project_id);
        setFormSystemPrompt(editingAgent.system_prompt || '');
        showToast(t('agent.masterPromptReset'), 'success');
        onClose();
      } catch {
        showToast(t('agent.masterPromptResetError'), 'error');
      }
    };

    return (
      <div className="modal-overlay visible z-50">
        <div className="modal animate-fade-in w-[95%] max-w-[760px] flex flex-col p-0">
          <div className="flex justify-between items-center px-6 py-4 border-b border-[var(--color-border)] shrink-0">
            <span className="font-semibold text-base text-[var(--color-text-primary)] flex items-center gap-2">
              <Bot className="w-5 h-5 text-[var(--color-accent)]" />
              <span>{t('agent.editTitle', { name: editingAgent.name })}</span>
            </span>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-[background-color,color] duration-150 cursor-pointer"
              aria-label={t('common.closeModal')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <form onSubmit={handleSaveAgent} className="p-6 space-y-4">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sidebar)]/30 p-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">
              {t('agent.masterPromptOnlyHint')}
            </div>
            <div className="form-group">
              <label className="form-label">{t('agent.nameLabel')}</label>
              <input
                className="form-input"
                value={editingAgent.name}
                placeholder={t('agent.namePlaceholder')}
                disabled
              />
            </div>
            <div className="form-group flex flex-col min-h-[280px]">
              <label className="form-label">{t('agent.systemPromptLabel')}</label>
              <textarea
                className="form-input flex-1 font-mono text-xs leading-relaxed resize-none p-3 bg-[var(--color-bg-sidebar)]/30 border border-[var(--color-border)]"
                value={formSystemPrompt}
                onChange={(e) => setFormSystemPrompt(e.target.value)}
                placeholder={t('agent.systemPromptPlaceholder')}
              />
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              {t('agent.masterPromptScopeHint')}
            </p>
            <div className="border-t border-[var(--color-border)]/50 pt-4 flex justify-between gap-2">
              <button
                type="button"
                onClick={handleResetMasterPrompt}
                className="btn btn-secondary cursor-pointer"
              >
                {t('agent.resetMasterPrompt')}
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} className="btn btn-secondary cursor-pointer">
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn btn-primary cursor-pointer">
                  {t('common.save')}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay visible z-50">
      <div className="modal animate-fade-in w-[95%] max-w-[1200px] h-[90vh] flex flex-col p-0">
        {/* Modal Title */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-[var(--color-border)] shrink-0">
          <span className="font-semibold text-base text-[var(--color-text-primary)] flex items-center gap-2">
            <Bot className="w-5 h-5 text-[var(--color-accent)]" />
            <span>{agentId ? t('agent.editTitle', { name: formName }) : t('agent.createTitle')}</span>
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
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
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
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder={t('agent.descPlaceholder')}
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                {t('agent.providerLabel')}
                {!isProtectedAgent && <span className="text-[var(--color-danger)]"> *</span>}
              </label>
              <CustomSelect
                value={formProviderId}
                onChange={(val) => {
                  setFormProviderId(val);
                  setFormModel('');
                }}
                options={[
                  ...(isProtectedAgent ? [{ value: '', label: t('agent.inheritInvokingModel') }] : []),
                  ...providers.map(p => ({
                    value: p.id,
                    label: `${p.name} (${p.default_model})`
                  })),
                ]}
                placeholder={providers.length === 0 ? t('agent.providerEmptyPlaceholder') : t('agent.providerPlaceholder')}
                disabled={providers.length === 0 && !isProtectedAgent}
              />
              {isProtectedAgent && !formProviderId && (
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                  {t('agent.inheritedModelHint')}
                </p>
              )}
            </div>

            {formProviderId && (
              <div className="form-group">
                <label className="form-label">{t('agent.modelOverrideLabel')}</label>
                <CustomSelect
                  value={formModel}
                  onChange={setFormModel}
                  options={modelOptions}
                  placeholder={t('agent.providerDefaultModel', { model: selectedProvider?.default_model ?? '' })}
                />
              </div>
            )}
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
                value={formSystemPrompt}
                onChange={(e) => setFormSystemPrompt(e.target.value)}
                placeholder={t('agent.systemPromptPlaceholder')}
              />
            </div>

            <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sidebar)]/30 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-[var(--color-text-primary)]">
                    {t('agent.toolScopeLabel')}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                    {formToolScopeMode === 'inherit'
                      ? t('agent.toolScopeInheritedDesc')
                      : t('agent.toolScopeNarrowDesc')}
                  </p>
                </div>
                <div className="grid grid-cols-2 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[10px] shrink-0">
                  {(['inherit', 'narrow'] as const).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      aria-label={mode === 'inherit' ? t('agent.toolScopeInherit') : t('agent.toolScopeNarrow')}
                      aria-pressed={formToolScopeMode === mode}
                      onClick={() => setFormToolScopeMode(mode)}
                      className={`px-2.5 py-1.5 transition-colors ${
                        formToolScopeMode === mode
                          ? 'bg-[var(--color-accent)] text-white'
                          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
                      }`}
                    >
                      {mode === 'inherit' ? t('agent.toolScopeInherit') : t('agent.toolScopeNarrow')}
                    </button>
                  ))}
                </div>
              </div>

              {formToolScopeMode === 'narrow' && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                      {t('agent.builtInToolsLabel')}
                    </div>
                    <div className="max-h-36 overflow-y-auto rounded-md border border-[var(--color-border)]/60 bg-[var(--color-bg-app)]/40 p-1.5 grid grid-cols-2 gap-1">
                      {AGENT_BUILT_IN_TOOL_NAMES.map(toolName => (
                        <label key={toolName} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]">
                          <input
                            type="checkbox"
                            checked={formBuiltInTools.includes(toolName)}
                            onChange={() => toggleBuiltInTool(toolName)}
                            aria-label={t('agent.allowBuiltInTool', { name: toolName })}
                            className="accent-[var(--color-accent)]"
                          />
                          <span className="truncate font-mono">{toolName}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                      {t('agent.mcpToolScopeLabel')}
                    </div>
                    <div className="max-h-36 overflow-y-auto rounded-md border border-[var(--color-border)]/60 bg-[var(--color-bg-app)]/40 p-1.5 space-y-1">
                      {mcpServers.map(server => (
                        <label key={server.id} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[10px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]">
                          <input
                            type="checkbox"
                            checked={formToolScopeMcpServerIds.includes(server.id)}
                            onChange={() => toggleToolScopeMcpServer(server.id)}
                            aria-label={t('agent.allowMcpServerTools', { name: server.name })}
                            className="accent-[var(--color-accent)]"
                          />
                          <span className="truncate">{server.name}</span>
                        </label>
                      ))}
                      {mcpServers.length === 0 && (
                        <div className="px-1.5 py-2 text-[10px] italic text-[var(--color-text-muted)]">
                          {t('agent.noMcpServers')}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

        {/* MCP visibility and Skill Preload controls */}
            <div className="grid grid-cols-2 gap-4">
              {/* MCP Servers */}
              <div className="form-group relative">
                <label className="form-label flex items-center justify-between">
                  <span>{t('agent.mcpVisibilityLabel', { count: visibleMcpCount, total: mcpServers.length })}</span>
                  <span className="text-[10px] text-[var(--color-text-muted)] font-normal">{t('agent.defaultVisibleHint')}</span>
                </label>

                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sidebar)]/30 p-2">
                  <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--color-border)]/50 mb-1">
                    <Search className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
                    <input
                      type="text"
                      placeholder={t('agent.searchMcpPlaceholder')}
                      value={mcpSearchQuery}
                      onChange={(e) => setMcpSearchQuery(e.target.value)}
                      className="bg-transparent text-xs text-[var(--color-text-primary)] outline-none w-full py-0.5"
                    />
                  </div>
                  <div
                    role="group"
                    aria-label={t('agent.mcpVisibilityGroupLabel')}
                    className="max-h-[178px] overflow-y-auto space-y-0.5 pr-0.5"
                  >
                    {mcpVisibilityCandidates.map(server => {
                      const isExcluded = formMcpExclusionIds.includes(server.id);
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
                              onChange={() => toggleMcpExclusion(server.id)}
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
                    {mcpServers.length > 0 && mcpVisibilityCandidates.length === 0 && (
                      <div className="text-center py-4 text-xs text-[var(--color-text-muted)] italic">{t('agent.noMcpMatch')}</div>
                    )}
                    </div>
                  </div>
              </div>

              {/* Skills */}
              <div className="form-group relative" ref={skillContainerRef}>
                <label className="form-label flex items-center justify-between">
                  <span>{t('agent.skillPreloadLabel', { count: formSkillIds.length })}</span>
                  <span className="text-[10px] text-[var(--color-text-muted)] font-normal">{t('agent.multiSelectHint')}</span>
                </label>
                <p className="mb-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                  {t('agent.skillPreloadDesc')}
                </p>

                <div className="flex flex-wrap gap-1 py-1.5 px-2 bg-[var(--color-bg-sidebar)]/30 border border-[var(--color-border)] rounded-lg min-h-[46px] max-h-[120px] overflow-y-auto mb-2 transition-[background-color,border-color] duration-150">
                  {formSkillIds.map(id => {
                    const sk = skills.find(s => s.id === id);
                    const displayName = sk ? getSkillDisplayName(sk) : '';
                    return sk ? (
                      <span key={id} className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded bg-[var(--color-success-dim)]/40 text-[var(--color-success)] text-[11px] select-none border border-[var(--color-success)]/15 animate-fade-in scale-95 origin-left">
                        <span>{displayName}</span>
                        <button
                          type="button"
                          onClick={() => toggleSkillPreload(id)}
                          className="text-[var(--color-success)]/60 hover:text-red-500 transition-colors ml-0.5 cursor-pointer font-bold text-[10px] leading-none"
                          title={t('agent.removePreload')}
                        >
                          ×
                        </button>
                      </span>
                    ) : null;
                  })}
                  {formSkillIds.length === 0 && (
                    <span className="text-[11px] text-[var(--color-text-muted)] italic self-center pl-1">{t('agent.noSkillsPreloaded')}</span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSkillDropdownOpen(!skillDropdownOpen);
                  }}
                  className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-[var(--color-bg-sidebar)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-[background-color,border-color,color] duration-150 cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t('agent.manageSkillPreload')}</span>
                </button>

                {skillDropdownOpen && (
                  <div className="absolute left-0 bottom-[36px] w-full max-h-[220px] overflow-y-auto border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-xl rounded-lg z-50 p-2 animate-fade-in select-none flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 border-b border-[var(--color-border)]/50 mb-1">
                      <Search className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
                      <input
                        type="text"
                        placeholder={t('agent.searchSkillPlaceholder')}
                        value={skillSearchQuery}
                        onChange={(e) => setSkillSearchQuery(e.target.value)}
                        className="bg-transparent text-xs text-[var(--color-text-primary)] outline-none w-full py-0.5"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    <div className="overflow-y-auto max-h-[160px] space-y-0.5 pr-0.5">
                      {skillPreloadCandidates.map(sk => {
                          const displayName = getSkillDisplayName(sk);
                          const sourceLabel = getSkillSourceLabel(sk);
                          const isBound = formSkillIds.includes(sk.id);
                          return (
                            <div
                              key={sk.id}
                              role="button"
                              aria-label={t('agent.skillPreloadCandidateLabel', { name: displayName })}
                              onClick={() => toggleSkillPreload(sk.id)}
                              className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
                                isBound
                                  ? 'bg-[var(--color-success-dim)]/20 text-[var(--color-success)] font-medium'
                                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
                              }`}
                            >
                              <div className="flex items-center gap-2 truncate">
                                <input
                                  type="checkbox"
                                  checked={isBound}
                                  readOnly
                                  className="accent-[var(--color-success)] cursor-pointer"
                                />
                                <span className="truncate">{displayName}</span>
                              </div>
                              <span className="ml-2 shrink-0 rounded bg-[var(--color-bg-sunken)] px-1 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                                {sourceLabel}
                              </span>
                            </div>
                          );
                        })}
                      {skillPreloadCandidates.length === 0 && (
                        <div className="text-center py-4 text-xs text-[var(--color-text-muted)] italic">{t('agent.noSkillMatch')}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
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
