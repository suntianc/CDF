import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';
import { useLLMStore } from '../../stores/llmStore';
import { useSkillStore } from '../../stores/skillStore';
import { useMcpServerStore } from '../../stores/mcpServerStore';
import { useProjectStore } from '../../stores/projectStore';
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

export function AgentEditDialog({ isOpen, onClose, agentId, showToast }: AgentEditDialogProps) {
  const { t } = useTranslation();
  const { agents, saveAgent } = useAgentStore();
  const { providers } = useLLMStore();
  const { skills } = useSkillStore();
  const { mcpServers } = useMcpServerStore();
  const { currentProjectId } = useProjectStore();

  // Form State
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formProviderId, setFormProviderId] = useState('');
  const [formSystemPrompt, setFormSystemPrompt] = useState('');
  const [formMcpIds, setFormMcpIds] = useState<string[]>([]);
  const [formSkillIds, setFormSkillIds] = useState<string[]>([]);

  // Multi-selector dropdown states
  const [mcpDropdownOpen, setMcpDropdownOpen] = useState(false);
  const [skillDropdownOpen, setSkillDropdownOpen] = useState(false);

  // Search query states for bindings
  const [mcpSearchQuery, setMcpSearchQuery] = useState('');
  const [skillSearchQuery, setSkillSearchQuery] = useState('');

  // Reset search queries when dropdowns close
  useEffect(() => {
    if (!mcpDropdownOpen) setMcpSearchQuery('');
  }, [mcpDropdownOpen]);

  useEffect(() => {
    if (!skillDropdownOpen) setSkillSearchQuery('');
  }, [skillDropdownOpen]);

  const mcpContainerRef = useRef<HTMLDivElement>(null);
  const skillContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (mcpContainerRef.current && !mcpContainerRef.current.contains(event.target as Node)) {
        setMcpDropdownOpen(false);
      }
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
        setFormProviderId(agent.provider_id || activeProvider?.id || '');
        setFormSystemPrompt(agent.system_prompt || '');
        setFormMcpIds(agent.mcpServerIds || []);
        setFormSkillIds(agent.skillNames || []);
      }
    } else {
      setFormName('');
      setFormDesc('');
      const activeProvider = providers.find(p => p.is_active === 1) || providers[0];
      setFormProviderId(activeProvider?.id || '');
      setFormSystemPrompt('');
      setFormMcpIds([]);
      setFormSkillIds([]);
    }
    setMcpDropdownOpen(false);
    setSkillDropdownOpen(false);
  }, [isOpen, agentId, agents, providers]);

  const handleSaveAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      showToast(t('agent.nameRequired'), 'error');
      return;
    }

    const ENGLISH_NAME_REGEX = /^[A-Za-z0-9\s\-_]+$/;
    if (!ENGLISH_NAME_REGEX.test(formName.trim())) {
      showToast(t('agent.nameEnglishOnly'), 'error');
      return;
    }

    if (!formProviderId) {
      showToast(t('agent.providerRequired'), 'error');
      return;
    }

    const id = agentId || window.crypto.randomUUID();
    const existingAgent = agentId ? agents.find((item) => item.id === agentId) : null;
    const defaultExists = agents.some((item) => item.project_id === (currentProjectId || 'default-project') && item.is_default === 1);
    const payload = {
      id,
      project_id: currentProjectId || 'default-project',
      name: formName,
      description: formDesc,
      provider_id: formProviderId || null,
      system_prompt: formSystemPrompt,
      config: {
        permissionsPreset: 'project-safe',
        approvalPreset: 'write-operations',
      },
      mcpServerIds: formMcpIds,
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

  const toggleMcpBinding = (mcpId: string) => {
    setFormMcpIds(prev =>
      prev.includes(mcpId) ? prev.filter(id => id !== mcpId) : [...prev, mcpId]
    );
  };

  const toggleSkillBinding = (skillId: string) => {
    setFormSkillIds(prev =>
      prev.includes(skillId) ? prev.filter(id => id !== skillId) : [...prev, skillId]
    );
  };

  if (!isOpen) return null;

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
            className="p-1 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer"
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
                required
              />
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
              <label className="form-label">{t('agent.providerLabel')} <span className="text-[var(--color-danger)]">*</span></label>
              <CustomSelect
                value={formProviderId}
                onChange={(val) => setFormProviderId(val)}
                options={providers.map(p => ({
                  value: p.id,
                  label: `${p.name} (${p.default_model})`
                }))}
                placeholder={providers.length === 0 ? t('agent.providerEmptyPlaceholder') : t('agent.providerPlaceholder')}
                disabled={providers.length === 0}
              />
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
                value={formSystemPrompt}
                onChange={(e) => setFormSystemPrompt(e.target.value)}
                placeholder={t('agent.systemPromptPlaceholder')}
              />
            </div>

            {/* MCP & Skills binding badgelists */}
            <div className="grid grid-cols-2 gap-4">
              {/* MCP Servers */}
              <div className="form-group relative" ref={mcpContainerRef}>
                <label className="form-label flex items-center justify-between">
                  <span>{t('agent.bindMcpLabel', { count: formMcpIds.length })}</span>
                  <span className="text-[10px] text-[var(--color-text-muted)] font-normal">{t('agent.multiSelectHint')}</span>
                </label>

                <div className="flex flex-wrap gap-1 py-1.5 px-2 bg-[var(--color-bg-sidebar)]/30 border border-[var(--color-border)] rounded-lg min-h-[46px] max-h-[120px] overflow-y-auto mb-2 transition-all">
                  {formMcpIds.map(id => {
                    const s = mcpServers.find(m => m.id === id);
                    return s ? (
                      <span key={id} className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded bg-[var(--color-accent-dim)] text-[var(--color-accent)] text-[11px] select-none border border-[var(--color-accent)]/10 animate-fade-in scale-95 origin-left">
                        <span>{s.name}</span>
                        <button
                          type="button"
                          onClick={() => toggleMcpBinding(id)}
                          className="text-[var(--color-accent)]/60 hover:text-red-500 transition-colors ml-0.5 cursor-pointer font-bold text-[10px] leading-none"
                          title={t('agent.unbind')}
                        >
                          ×
                        </button>
                      </span>
                    ) : null;
                  })}
                  {formMcpIds.length === 0 && (
                    <span className="text-[11px] text-[var(--color-text-muted)] italic self-center pl-1">{t('agent.noToolsBound')}</span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMcpDropdownOpen(!mcpDropdownOpen);
                    setSkillDropdownOpen(false);
                  }}
                  className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-[var(--color-bg-sidebar)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t('agent.addOrUnbindMcp')}</span>
                </button>

                {mcpDropdownOpen && (
                  <div className="absolute left-0 bottom-[36px] w-full max-h-[220px] overflow-y-auto border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-xl rounded-lg z-50 p-2 animate-fade-in select-none flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 border-b border-[var(--color-border)]/50 mb-1">
                      <Search className="w-3.5 w-3.5 text-[var(--color-text-muted)] shrink-0" />
                      <input
                        type="text"
                        placeholder={t('agent.searchToolPlaceholder')}
                        value={mcpSearchQuery}
                        onChange={(e) => setMcpSearchQuery(e.target.value)}
                        className="bg-transparent text-xs text-[var(--color-text-primary)] outline-none w-full py-0.5"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    <div className="overflow-y-auto max-h-[160px] space-y-0.5 pr-0.5">
                      {mcpServers
                        .filter(s => s.name.toLowerCase().includes(mcpSearchQuery.toLowerCase()))
                        .map(s => {
                          const isBound = formMcpIds.includes(s.id);
                          return (
                            <div
                              key={s.id}
                              onClick={() => toggleMcpBinding(s.id)}
                              className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
                                isBound
                                  ? 'bg-[var(--color-accent-dim)]/50 text-[var(--color-accent)] font-medium'
                                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
                              }`}
                            >
                              <div className="flex items-center gap-2 truncate">
                                <input
                                  type="checkbox"
                                  checked={isBound}
                                  readOnly
                                  className="accent-[var(--color-accent)] cursor-pointer"
                                />
                                <span className="truncate">{s.name}</span>
                              </div>
                              <span className="text-[10px] scale-90 px-1 py-0.2 rounded bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)] font-mono">
                                {s.server_type}
                              </span>
                            </div>
                          );
                        })}
                      {mcpServers.filter(s => s.name.toLowerCase().includes(mcpSearchQuery.toLowerCase())).length === 0 && (
                        <div className="text-center py-4 text-xs text-[var(--color-text-muted)] italic">{t('agent.noToolMatch')}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Skills */}
              <div className="form-group relative" ref={skillContainerRef}>
                <label className="form-label flex items-center justify-between">
                  <span>{t('agent.bindSkillLabel', { count: formSkillIds.length })}</span>
                  <span className="text-[10px] text-[var(--color-text-muted)] font-normal">{t('agent.multiSelectHint')}</span>
                </label>

                <div className="flex flex-wrap gap-1 py-1.5 px-2 bg-[var(--color-bg-sidebar)]/30 border border-[var(--color-border)] rounded-lg min-h-[46px] max-h-[120px] overflow-y-auto mb-2 transition-all">
                  {formSkillIds.map(id => {
                    const sk = skills.find(s => s.id === id);
                    return sk ? (
                      <span key={id} className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded bg-[var(--color-success-dim)]/40 text-[var(--color-success)] text-[11px] select-none border border-[var(--color-success)]/15 animate-fade-in scale-95 origin-left">
                        <span>{sk.name}</span>
                        <button
                          type="button"
                          onClick={() => toggleSkillBinding(id)}
                          className="text-[var(--color-success)]/60 hover:text-red-500 transition-colors ml-0.5 cursor-pointer font-bold text-[10px] leading-none"
                          title={t('agent.unbind')}
                        >
                          ×
                        </button>
                      </span>
                    ) : null;
                  })}
                  {formSkillIds.length === 0 && (
                    <span className="text-[11px] text-[var(--color-text-muted)] italic self-center pl-1">{t('agent.noSkillsBound')}</span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSkillDropdownOpen(!skillDropdownOpen);
                    setMcpDropdownOpen(false);
                  }}
                  className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-[var(--color-bg-sidebar)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t('agent.addOrUnbindSkill')}</span>
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
                      {skills
                        .filter(sk => sk.scope === 'global')
                        .filter(sk => sk.name.toLowerCase().includes(skillSearchQuery.toLowerCase()))
                        .map(sk => {
                          const isBound = formSkillIds.includes(sk.id);
                          return (
                            <div
                              key={sk.id}
                              onClick={() => toggleSkillBinding(sk.id)}
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
                                <span className="truncate">{sk.name}</span>
                              </div>
                            </div>
                          );
                        })}
                      {skills.filter(sk => sk.name.toLowerCase().includes(skillSearchQuery.toLowerCase())).length === 0 && (
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
