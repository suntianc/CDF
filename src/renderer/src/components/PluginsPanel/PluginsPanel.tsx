import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSkillStore } from '../../stores/skillStore';
import { useMcpServerStore } from '../../stores/mcpServerStore';
import { useProjectStore } from '../../stores/projectStore';
import { MCPServer } from '../../../../shared/types';
import {
  SKILL_OVERRIDE_STATES,
  parseSkillOverrideState,
  type SkillOverrideState,
} from '../../../../shared/skill-overrides';
import {
  Trash2, X, Code, Layers, RefreshCw, Loader2, Search, FolderInput, Plus, Edit2, CircleHelp
} from 'lucide-react';
import { CustomSelect } from '../ui/CustomSelect';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

function readSkillOverrideRecord(raw: unknown): Record<string, SkillOverrideState> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const overrides: Record<string, SkillOverrideState> = {};
  for (const [skillName, value] of Object.entries(raw)) {
    const state = parseSkillOverrideState(value);
    if (state) overrides[skillName] = state;
  }
  return overrides;
}

function getUnknownErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return null;
}

export function PluginsPanel() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'skills' | 'mcp'>('skills');
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--color-bg-app)] overflow-hidden">
      <header className="main-topbar shrink-0 h-10">
        <div className="main-topbar-left">
          <h1>{t('sidebar.plugins')}</h1>
        </div>
      </header>

      {/* 内置二级 Tab 导航栏 */}
      <div className="px-5 py-2 flex items-center justify-start border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-1 select-none">
          <button
            className={`min-h-8 px-3 text-[13px] font-semibold rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
              activeTab === 'skills'
                ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
            onClick={() => setActiveTab('skills')}
          >
            {t('plugins.skillsTab')}
          </button>
          <button
            className={`min-h-8 px-3 text-[13px] font-semibold rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
              activeTab === 'mcp'
                ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
            onClick={() => setActiveTab('mcp')}
          >
            {t('plugins.mcpTab')}
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 overflow-hidden relative">
        {activeTab === 'skills' ? (
          <div key="skills" className="h-full animate-fade-up">
            <SkillsTab showToast={showToast} />
          </div>
        ) : (
          <div key="mcp" className="h-full animate-fade-up">
            <McpTab showToast={showToast} />
          </div>
        )}
      </div>

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

// ==================== SKILLS TAB ====================
function SkillsTab({ showToast }: { showToast: (msg: string, type?: Toast['type']) => void }) {
  const { t } = useTranslation();
  const { skills, fetchSkills, deleteSkill } = useSkillStore();
  const { currentProjectId } = useProjectStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [projectSkillOverrides, setProjectSkillOverrides] = useState<Record<string, SkillOverrideState>>({});
  const [userSkillOverrides, setUserSkillOverrides] = useState<Record<string, SkillOverrideState>>({});

  useEffect(() => {
    if (!currentProjectId) return;
    fetchSkills(currentProjectId);
  }, [currentProjectId]);

  useEffect(() => {
    if (!currentProjectId) {
      setProjectSkillOverrides({});
      return;
    }
    window.electronAPI.db.getProjectSkillOverrides(currentProjectId)
      .then(setProjectSkillOverrides)
      .catch(() => setProjectSkillOverrides({}));
  }, [currentProjectId]);

  useEffect(() => {
    window.electronAPI.store.get('skillOverrides')
      .then((raw: unknown) => setUserSkillOverrides(readSkillOverrideRecord(raw)))
      .catch(() => setUserSkillOverrides({}));
  }, []);

  const handleImportSkillDirectory = async () => {
    try {
      const dirPath = await window.electronAPI.db.selectDirectory();
      if (!dirPath) return;
      await window.electronAPI.db.importSkillDirectory(dirPath);
      if (currentProjectId) await fetchSkills(currentProjectId);
      showToast(t('plugins.skillImportSuccess'), 'success');
    } catch (error: unknown) {
      showToast(getUnknownErrorMessage(error) || t('plugins.skillImportError'), 'error');
    }
  };

  const handleDeleteSkill = async (id: string, name: string) => {
    if (confirm(t('plugins.skillDeleteConfirm', { name }))) {
      try {
        await deleteSkill(currentProjectId || 'default-project', id);
        showToast(t('plugins.skillDeleted', { name }), 'success');
      } catch (err) {
        showToast(t('plugins.skillDeleteError'), 'error');
      }
    }
  };

  const filteredSkills = skills
    .filter(s =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.qualifiedName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.sourceLabel || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

  const handleProjectSkillOverride = async (skillName: string, visibility: SkillOverrideState) => {
    if (!currentProjectId) return;
    try {
      const overrides = await window.electronAPI.db.setProjectSkillOverride(currentProjectId, skillName, visibility);
      setProjectSkillOverrides(overrides);
    } catch (error: unknown) {
      showToast(getUnknownErrorMessage(error) || t('plugins.skillOverrideSaveError'), 'error');
    }
  };

  const handleUserSkillOverride = async (skillName: string, visibility: SkillOverrideState) => {
    const nextOverrides = { ...userSkillOverrides };
    nextOverrides[skillName] = visibility;

    try {
      await window.electronAPI.store.set('skillOverrides', nextOverrides);
      setUserSkillOverrides(nextOverrides);
    } catch (error: unknown) {
      showToast(getUnknownErrorMessage(error) || t('plugins.skillOverrideSaveError'), 'error');
    }
  };

  const skillOverrideOptions = SKILL_OVERRIDE_STATES.map(state => ({
    value: state,
    label: t(`plugins.skillOverrideStateLong.${state}`),
  }));

  const renderOverrideHelp = (id: string, label: string, tooltip: string) => (
    <span className="group/help relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--color-text-muted)] outline-none transition-colors hover:text-[var(--color-text-secondary)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent-dim)]"
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-56 -translate-x-1/2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2.5 py-2 text-left text-[11px] font-normal leading-relaxed text-[var(--color-text-secondary)] shadow-lg group-hover/help:block group-focus-within/help:block"
      >
        {tooltip}
      </span>
    </span>
  );

  return (
    <div className="h-full flex flex-col px-5 pb-6 pt-4 overflow-y-auto">
      <div className="flex justify-between items-center mb-3 shrink-0">
        <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">
          {t('plugins.skillsListTitle', { count: skills.length })}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-8 items-center gap-2 bg-[var(--color-bg-sunken)] border border-[var(--color-border)] px-3 rounded-[var(--radius-sm)] w-[220px] no-drag focus-within:border-[var(--color-accent)]">
            <Search className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
            <input
              type="text"
              placeholder={t('plugins.skillSearchPlaceholder')}
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
          <button className="btn btn-secondary btn-sm flex items-center gap-1 cursor-pointer" onClick={handleImportSkillDirectory}>
            <FolderInput className="w-3.5 h-3.5" />
            <span>{t('plugins.importSkillDir')}</span>
          </button>
        </div>
      </div>

      <div className="resource-card-grid">
        {filteredSkills.map((skill) => {
          const displayName = skill.qualifiedName ?? skill.name;
          const overrideKey = displayName;
          const sourceLabel = skill.sourceLabel ?? (
            skill.scope === 'project' ? t('plugins.skillSourceProject') : t('plugins.skillSourceGlobal')
          );
          const projectOverride = projectSkillOverrides[overrideKey];
          const userOverride = userSkillOverrides[overrideKey];
          const shadowedSkills = skill.shadowedSkills ?? [];
          const shadowedSummary = shadowedSkills
            .map((shadowed) => `${shadowed.qualifiedName ?? shadowed.name} (${shadowed.sourceLabel ?? shadowed.sourceKind ?? t('plugins.skillSourceUnknown')})`)
            .join('\n');
          return (
            <div key={skill.id} className="provider-card resource-square-card p-4 border border-transparent hover:border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-bg-surface)] transition-colors flex flex-col group">
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-2 mb-2">
                <Code className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
                <div className="font-semibold text-sm text-[var(--color-text-primary)] truncate flex-1" title={displayName}>{displayName}</div>
                <span className="rounded bg-[var(--color-bg-sunken)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] shrink-0">
                  {sourceLabel}
                </span>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-1 line-clamp-2" title={skill.description}>
                {skill.description || t('plugins.skillNoDescription')}
              </p>
              {shadowedSkills.length > 0 && (
                <div
                  className="mt-1 text-[10px] text-[var(--color-text-muted)]"
                  title={t('plugins.skillShadowsTitle', { list: shadowedSummary })}
                >
                  {t('plugins.skillShadowsLabel', { count: shadowedSkills.length })}
                </div>
              )}
              {skill.userInvocable === false && (
                <div className="mt-1 text-[10px] text-[var(--color-warning)]">
                  {t('plugins.skillNotUserInvocable')}
                </div>
              )}
              <div className="mt-3 rounded-md border border-[var(--color-border)]/40 bg-[var(--color-bg-sidebar)]/25 p-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <label
                        htmlFor={`project-skill-override-${skill.id}`}
                        className="truncate text-[10px] font-semibold text-[var(--color-text-secondary)]"
                      >
                        {t('plugins.skillProjectOverrideLabel')}
                      </label>
                      {renderOverrideHelp(
                        `project-skill-override-help-${skill.id}`,
                        t('plugins.skillProjectOverrideHelpLabel'),
                        t('plugins.skillProjectOverrideHelp')
                      )}
                    </div>
                    <CustomSelect
                      id={`project-skill-override-${skill.id}`}
                      value={projectOverride ?? 'on'}
                      onChange={(visibility) => handleProjectSkillOverride(overrideKey, visibility as SkillOverrideState)}
                      options={skillOverrideOptions}
                      ariaLabel={t('plugins.skillProjectOverrideSelectLabel', { name: displayName })}
                      className="w-full"
                      buttonClassName="h-7 rounded-md bg-[var(--color-bg-surface)] px-2 py-1 text-[11px] font-medium"
                    />
                  </div>

                  <div className="min-w-0 space-y-1.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <label
                        htmlFor={`user-skill-override-${skill.id}`}
                        className="truncate text-[10px] font-semibold text-[var(--color-text-secondary)]"
                      >
                        {t('plugins.skillUserOverrideLabel')}
                      </label>
                      {renderOverrideHelp(
                        `user-skill-override-help-${skill.id}`,
                        t('plugins.skillUserOverrideHelpLabel'),
                        t('plugins.skillUserOverrideHelp')
                      )}
                    </div>
                    <CustomSelect
                      id={`user-skill-override-${skill.id}`}
                      value={userOverride ?? 'on'}
                      onChange={(visibility) => handleUserSkillOverride(overrideKey, visibility as SkillOverrideState)}
                      options={skillOverrideOptions}
                      ariaLabel={t('plugins.skillUserOverrideSelectLabel', { name: displayName })}
                      className="w-full"
                      buttonClassName="h-7 rounded-md bg-[var(--color-bg-surface)] px-2 py-1 text-[11px] font-medium"
                    />
                  </div>
                </div>
              </div>
            </div>

            {skill.editable !== false && (
              <div className="mt-auto flex justify-end gap-2 border-t border-[var(--color-border)]/30 pt-3">
                <button
                  className="btn btn-danger btn-sm flex items-center gap-1 cursor-pointer"
                  onClick={() => handleDeleteSkill(skill.id, displayName)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{t('common.delete')}</span>
                </button>
              </div>
            )}
            </div>
          );
        })}

        {filteredSkills.length === 0 && (
          <div className="col-span-full flex flex-col items-start gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface)] px-6 py-10 text-sm text-[var(--color-text-muted)]">
            <span>{searchQuery ? t('plugins.skillEmptySearch') : t('plugins.skillEmpty')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== MCP TAB ====================
function McpTab({ showToast }: { showToast: (msg: string, type?: Toast['type']) => void }) {
  const { t } = useTranslation();
  const { mcpServers, fetchMcpServers, saveMcpServer, deleteMcpServer, checkMcpHealth, toggleMcpConnection } = useMcpServerStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);

  // Form states
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'stdio' | 'http'>('stdio');
  const [formCommand, setFormCommand] = useState('');
  const [formArgsInput, setFormArgsInput] = useState('');
  const [formUrl, setFormUrl] = useState('');

  // Local state for health checking indicators
  const [testingId, setTestingId] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchMcpServers();
  }, []);

  const openCreateModal = () => {
    setEditingServerId(null);
    setFormName('');
    setFormType('stdio');
    setFormCommand('');
    setFormArgsInput('');
    setFormUrl('');
    setIsModalOpen(true);
  };

  const openEditModal = (server: MCPServer) => {
    setEditingServerId(server.id);
    setFormName(server.name);
    // 向后兼容：已有的 'sse' 记录映射为 'http' 表单类型
    const isRemote = server.server_type === 'sse' || server.server_type === 'http';
    setFormType(isRemote ? 'http' : 'stdio');

    const config = server.config || {};
    if (isRemote) {
      setFormUrl((config.url as string) || '');
      setFormCommand('');
      setFormArgsInput('');
    } else {
      setFormCommand((config.command as string) || '');
      const argsArray = (config.args as string[]) || [];
      setFormArgsInput(argsArray.join('\n'));
      setFormUrl('');
    }
    setIsModalOpen(true);
  };

  const handleSaveMcp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      showToast(t('plugins.mcpNameRequired'), 'error');
      return;
    }

    const id = editingServerId || window.crypto.randomUUID();
    let configPayload: Record<string, unknown> = {};

    if (formType === 'http') {
      if (!formUrl.trim()) {
        showToast(t('plugins.mcpUrlRequired'), 'error');
        return;
      }
      configPayload = { url: formUrl };
    } else {
      if (!formCommand.trim()) {
        showToast(t('plugins.mcpCommandRequired'), 'error');
        return;
      }
      const args = formArgsInput
        .split('\n')
        .map(arg => arg.trim())
        .filter(arg => arg.length > 0);
      configPayload = { command: formCommand, args };
    }

    const payload = {
      id,
      name: formName,
      server_type: formType,
      config: configPayload
    };

    try {
      await saveMcpServer(payload);
      showToast(t('plugins.mcpSaved', { name: formName }), 'success');
      setIsModalOpen(false);
    } catch (err) {
      showToast(t('plugins.mcpSaveError'), 'error');
    }
  };

  const handleDeleteMcp = async (id: string, name: string) => {
    if (confirm(t('plugins.mcpDeleteConfirm', { name }))) {
      try {
        await deleteMcpServer(id);
        showToast(t('plugins.mcpDeleted', { name }), 'success');
      } catch (err) {
        showToast(t('plugins.mcpDeleteError'), 'error');
      }
    }
  };

  const testHealth = async (id: string, name: string) => {
    setTestingId(id);
    showToast(t('plugins.mcpHealthCheckStart', { name }), 'info');
    try {
      const res = await checkMcpHealth(id);
      if (res.ok) {
        showToast(t('plugins.mcpHealthCheckOk', { name }), 'success');
      } else {
        showToast(t('plugins.mcpHealthCheckFail', { name, message: res.message || t('plugins.mcpHealthTimeout') }), 'error');
      }
    } catch (error: unknown) {
      showToast(t('plugins.mcpHealthCheckException', { message: getUnknownErrorMessage(error) || t('plugins.mcpHealthTimeout') }), 'error');
    } finally {
      setTestingId(null);
    }
  };

  const toggleConnectionState = async (server: MCPServer) => {
    const nextState = !server.is_connected;
    try {
      await toggleMcpConnection(server.id, nextState);
      showToast(t('plugins.mcpConnectionToggled', { name: server.name, state: nextState ? t('plugins.mcpConnected') : t('plugins.mcpDisconnected') }), 'success');
    } catch (err) {
      showToast(t('plugins.mcpConnectionToggleError'), 'error');
    }
  };

  return (
    <div className="h-full flex flex-col px-5 pb-6 pt-4 overflow-y-auto">
      <div className="flex justify-between items-center mb-3 shrink-0">
        <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">
          {t('plugins.mcpListTitle', { count: mcpServers.length })}
        </div>
        <div className="flex items-center gap-2">
          {/* Search box */}
          <div className="flex h-8 items-center gap-2 bg-[var(--color-bg-sunken)] border border-[var(--color-border)] px-3 rounded-[var(--radius-sm)] w-[220px] no-drag focus-within:border-[var(--color-accent)]">
            <Search className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
            <input
              type="text"
              placeholder={t('plugins.mcpSearchPlaceholder')}
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
          <button className="btn btn-primary btn-sm flex items-center gap-1.5 cursor-pointer" onClick={openCreateModal}>
            <Plus className="w-3.5 h-3.5" />
            <span>{t('plugins.addMcpServer')}</span>
          </button>
        </div>
      </div>

      <div className="resource-card-grid">
        {mcpServers.filter(s =>
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.server_type || '').toLowerCase().includes(searchQuery.toLowerCase())
        ).map((server) => {
          const config = server.config || {};
          return (
            <div key={server.id} className="provider-card resource-square-card p-4 border border-transparent hover:border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-bg-surface)] transition-colors flex flex-col group">
              <div className="min-h-0 flex-1">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 max-w-[70%]">
                    <Layers className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
                    <div className="font-semibold text-sm text-[var(--color-text-primary)] truncate" title={server.name}>
                      {server.name}
                    </div>
                  </div>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold border border-[var(--color-border)] bg-[var(--color-bg-sunken)] text-[var(--color-text-muted)] uppercase shrink-0">
                    {server.server_type}
                  </span>
                </div>

                <div className="text-[10px] text-[var(--color-text-secondary)] bg-[var(--color-bg-sidebar)]/40 px-2 py-1.5 rounded font-mono truncate select-all border border-[var(--color-border)]/20 mb-3" title={
                  (server.server_type === 'sse' || server.server_type === 'http') ? (config.url as string) : `${config.command} ${(config.args as string[])?.join(' ')}`
                }>
                  {(server.server_type === 'sse' || server.server_type === 'http') ? (config.url as string) : `cmd: ${config.command}`}
                </div>

                <div className="flex items-center justify-between mb-4">
                  <span className="text-[11px] text-[var(--color-text-muted)]">
                    {t('plugins.mcpLastCheck')}{server.last_health_check ? new Date(server.last_health_check).toLocaleTimeString() : t('plugins.mcpNoRecord')}
                  </span>

                  {/* Status Indicator Badge */}
                  <span className={`px-2 py-0.5 rounded-[var(--radius-xs)] text-[10px] font-semibold tracking-wide flex items-center gap-1.5 border ${
                    server.is_connected
                      ? 'bg-[var(--color-success-dim)] text-[var(--color-success)] border-[var(--color-success)]/10'
                      : 'bg-[var(--color-danger-dim)] text-[var(--color-danger)] border-[var(--color-danger)]/10'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${server.is_connected ? 'bg-[var(--color-success)]' : 'bg-[var(--color-danger)]'}`} />
                    <span>{server.is_connected ? t('plugins.mcpOnline') : t('plugins.mcpOffline')}</span>
                  </span>
                </div>
              </div>

              <div className="mt-auto flex items-center justify-between border-t border-[var(--color-border)]/30 pt-3 gap-2">
                <button
                  onClick={() => toggleConnectionState(server)}
                  className={`btn btn-sm cursor-pointer ${
                    server.is_connected
                      ? 'btn-secondary text-[var(--color-text-muted)]'
                      : 'btn-secondary text-[var(--color-success)] border-[var(--color-success)]/30 hover:bg-[var(--color-success-dim)]'
                  }`}
                >
                  {server.is_connected ? t('plugins.mcpDisconnect') : t('plugins.mcpActivate')}
                </button>

                <div className="flex gap-1.5 ml-auto">
                  {/* Health Check Button */}
                  <button
                    className="btn btn-secondary btn-sm p-1.5"
                    onClick={() => testHealth(server.id, server.name)}
                    disabled={testingId === server.id}
                    title={t('plugins.mcpHealthProbe')}
                  >
                    {testingId === server.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <button
                    className="btn btn-secondary btn-sm p-1.5"
                    onClick={() => openEditModal(server)}
                    title={t('plugins.mcpEditConfig')}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  <button
                    className="btn btn-danger btn-sm p-1.5"
                    onClick={() => handleDeleteMcp(server.id, server.name)}
                    title={t('plugins.mcpDeleteService')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {mcpServers.filter(s =>
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.server_type || '').toLowerCase().includes(searchQuery.toLowerCase())
        ).length === 0 && (
          <div className="col-span-full flex flex-col items-start gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface)] px-6 py-10 text-sm text-[var(--color-text-muted)]">
            <span>{searchQuery ? t('plugins.mcpEmptySearch') : t('plugins.mcpEmpty')}</span>
            {!searchQuery && <button className="btn btn-primary" onClick={openCreateModal}>{t('plugins.addMcpServer')}</button>}
          </div>
        )}
      </div>

      {/* MCP Servers Dialog */}
      {isModalOpen && (
        <div className="modal-overlay visible z-50">
          <div className="modal animate-fade-in w-[95%] max-w-[680px] p-6">
            <div className="flex justify-between items-center modal-title border-b border-[var(--color-border)] pb-3 mb-4">
              <span className="font-semibold text-base text-[var(--color-text-primary)] flex items-center gap-2">
                <Layers className="w-5 h-5 text-[var(--color-accent)]" />
                <span>{editingServerId ? t('plugins.mcpEditTitle', { name: formName }) : t('plugins.mcpAddTitle')}</span>
              </span>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer"
                aria-label={t('common.closeModal')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveMcp} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="form-label">{t('plugins.mcpFormNameLabel')} <span className="text-[var(--color-danger)]">*</span></label>
                  <input
                    className="form-input"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder={t('plugins.mcpFormNamePlaceholder')}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('plugins.mcpFormProtocolLabel')}</label>
                  <CustomSelect
                    value={formType}
                    onChange={(val) => setFormType(val as 'stdio' | 'http')}
                    options={[
                      { value: 'stdio', label: t('plugins.mcpFormProtocolStdio') },
                      { value: 'http', label: t('plugins.mcpFormProtocolHttp') }
                    ]}
                  />
                </div>
              </div>

              {formType === 'http' ? (
                <div className="form-group">
                  <label className="form-label">{t('plugins.mcpUrlLabel')} <span className="text-[var(--color-danger)]">*</span></label>
                  <input
                    className="form-input"
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    placeholder={t('plugins.mcpUrlPlaceholder')}
                    required
                  />
                  <div className="form-hint">{t('plugins.mcpUrlHint')}</div>
                </div>
              ) : (
                <>
                  <div className="form-group">
                    <label className="form-label">{t('plugins.mcpCommandLabel')} <span className="text-[var(--color-danger)]">*</span></label>
                    <input
                      className="form-input"
                      value={formCommand}
                      onChange={(e) => setFormCommand(e.target.value)}
                      placeholder={t('plugins.mcpCommandPlaceholder')}
                      required
                    />
                    <div className="form-hint">{t('plugins.mcpCommandHint')}</div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t('plugins.mcpArgsLabel')}</label>
                    <textarea
                      className="form-input min-h-[90px] font-mono text-xs resize-none py-2"
                      value={formArgsInput}
                      onChange={(e) => setFormArgsInput(e.target.value)}
                      placeholder={t('plugins.mcpArgsPlaceholder')}
                    />
                    <div className="form-hint">{t('plugins.mcpArgsHint')}</div>
                  </div>
                </>
              )}

              <div className="modal-actions border-t border-[var(--color-border)] pt-4 mt-6">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
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
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
