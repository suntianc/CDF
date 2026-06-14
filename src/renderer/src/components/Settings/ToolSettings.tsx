import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check, Loader2, AlertCircle, Wrench, Eye, EyeOff, HelpCircle, Save, Info, ShieldAlert, Sliders, X
} from 'lucide-react';
import { CustomSelect } from '../ui/CustomSelect';

interface ToolMeta {
  id: string;
  name: string;
  desc: string;
  keyPlaceholder: string;
  docUrl?: string;
  requiresApiKey?: boolean;
  exposedTools?: string[];
  fields: Array<{
    key: string;
    label: string;
    type: 'text' | 'number';
    default: any;
    options?: string[];
    min?: number;
    max?: number;
  }>;
}

const getIntegratedTools = (t: (key: string) => string): ToolMeta[] => [
  {
    id: 'tavily',
    name: 'Tavily',
    desc: t('settings.tool.tavilyDesc'),
    keyPlaceholder: t('settings.tool.tavilyKeyPlaceholder'),
    docUrl: 'https://tavily.com',
    exposedTools: ['tavily_search'],
    fields: [
      {
        key: 'max_results',
        label: t('settings.tool.maxResults'),
        type: 'number',
        default: 5
      }
    ]
  },
  {
    id: 'anysearch',
    name: 'AnySearch',
    desc: t('settings.tool.anysearchDesc'),
    keyPlaceholder: t('settings.tool.anysearchKeyPlaceholder'),
    docUrl: 'https://anysearch.com',
    exposedTools: ['anysearch'],
    fields: [
      {
        key: 'max_results',
        label: t('settings.tool.maxResults'),
        type: 'number',
        default: 5
      }
    ]
  },
  {
    id: 'arxiv',
    name: 'arXiv',
    desc: t('settings.tool.arxivDesc'),
    keyPlaceholder: '',
    requiresApiKey: false,
    exposedTools: ['arxiv_search', 'arxiv_get_papers'],
    fields: [
      {
        key: 'max_results',
        label: t('settings.tool.maxResults'),
        type: 'number',
        default: 5,
        min: 1,
        max: 2000
      },
      {
        key: 'sort_by',
        label: t('settings.tool.arxivSortBy'),
        type: 'text',
        default: 'relevance',
        options: ['relevance', 'lastUpdatedDate', 'submittedDate']
      },
      {
        key: 'sort_order',
        label: t('settings.tool.arxivSortOrder'),
        type: 'text',
        default: 'descending',
        options: ['descending', 'ascending']
      }
    ]
  }
];

interface ToolConfigItem {
  id: string;
  tool_type: string;
  name: string;
  api_key: string;
  config: Record<string, any>;
  is_enabled: boolean;
  is_default: boolean;
  hasKey: boolean;
}

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export function ToolSettings() {
  const { t } = useTranslation();
  const INTEGRATED_TOOLS = getIntegratedTools(t);
  const [configs, setConfigs] = useState<ToolConfigItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Drawer Expand State (stores the active tool config item being configured)
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Temporary Form Edit States
  const [editingKey, setEditingKey] = useState<Record<string, string>>({});
  const [editingConfig, setEditingConfig] = useState<Record<string, any>>({});
  const [showKeyMap, setShowKeyMap] = useState<Record<string, boolean>>({});

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  };

  const loadConfigs = async () => {
    setIsLoading(true);
    try {
      const dbConfigs = await window.electronAPI.db.getToolConfigs();

      const merged = INTEGRATED_TOOLS.map(toolMeta => {
        const existing = dbConfigs.find((c: any) => c.tool_type === toolMeta.id);
        if (existing) {
          return {
            ...existing,
            name: toolMeta.name,
            api_key: existing.api_key || '',
          } as ToolConfigItem;
        } else {
          return {
            id: window.crypto.randomUUID(),
            tool_type: toolMeta.id,
            name: toolMeta.name,
            api_key: '',
            config: toolMeta.fields.reduce((acc, f) => ({ ...acc, [f.key]: f.default }), {}),
            is_enabled: false,
            is_default: false,
            hasKey: false
          } as ToolConfigItem;
        }
      });
      setConfigs(merged);
    } catch (err) {
      console.error('Failed to load tool configs:', err);
      showToast(t('settings.tool.loadConfigFailed'), 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadConfigs();
  }, []);

  const handleToggle = async (tool: ToolConfigItem) => {
    const toolMeta = INTEGRATED_TOOLS.find(tg => tg.id === tool.tool_type);
    const needsKey = toolMeta?.requiresApiKey !== false;

    // 没配置 API 的默认停用，不允许启用（不需要 API Key 的工具除外）
    if (needsKey && !tool.hasKey && (!tool.api_key || tool.api_key === '••••••••')) {
      showToast(t('settings.tool.configKeyFirst', { name: tool.name }), 'error');
      return;
    }

    const updated = {
      ...tool,
      is_enabled: !tool.is_enabled
    };

    // 乐观更新
    setConfigs(prev => prev.map(c => c.id === tool.id ? updated : c));

    try {
      await window.electronAPI.db.saveToolConfig(updated);
      showToast(t('settings.tool.toggleSuccess', { name: tool.name, action: updated.is_enabled ? t('settings.tool.enabled') : t('settings.tool.disabled') }), 'success');
      loadConfigs();
    } catch (err) {
      showToast(t('settings.tool.toggleFailed'), 'error');
      // 回滚
      setConfigs(prev => prev.map(c => c.id === tool.id ? tool : c));
    }
  };

  const handleExpand = (tool: ToolConfigItem) => {
    setEditingKey(prev => ({ ...prev, [tool.id]: tool.api_key }));
    setEditingConfig(prev => ({ ...prev, [tool.id]: { ...tool.config } }));
    setShowKeyMap(prev => ({ ...prev, [tool.id]: false }));
    setExpandedId(tool.id);
  };

  const handleSaveConfig = async (tool: ToolConfigItem) => {
    const key = editingKey[tool.id] || '';
    const cfg = editingConfig[tool.id] || {};
    const toolMeta = INTEGRATED_TOOLS.find(tg => tg.id === tool.tool_type);
    const needsKey = toolMeta?.requiresApiKey !== false;

    const isKeyValValid = key.trim() !== '' && key !== '••••••••';
    const hasExistingKey = tool.hasKey && key === '••••••••';
    const isKeyConfigured = !needsKey || hasExistingKey || isKeyValValid;

    const updated = {
      ...tool,
      api_key: key,
      config: cfg,
      // 如果没有配置 Key，强制停用工具（不需要 Key 的工具除外）
      is_enabled: isKeyConfigured ? tool.is_enabled : false
    };

    try {
      await window.electronAPI.db.saveToolConfig(updated);
      showToast(t('settings.tool.saveSuccess', { name: tool.name }), 'success');
      setExpandedId(null);
      loadConfigs();
    } catch (err) {
      showToast(t('settings.tool.saveFailed'), 'error');
    }
  };

  const expandedTool = configs.find(c => c.id === expandedId);
  const isToolConfigured = (tool: ToolConfigItem) => {
    const toolMeta = INTEGRATED_TOOLS.find(tg => tg.id === tool.tool_type);
    if (toolMeta?.requiresApiKey === false) return true;
    return tool.hasKey || (editingKey[tool.id] && editingKey[tool.id] !== '••••••••');
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--color-bg-app)] overflow-hidden relative">
      {/* 注入 CSS: 隐藏原生数字输入箭头 & 侧边栏滑入动画 */}
      <style>{`
        .hide-spinners::-webkit-outer-spin-button,
        .hide-spinners::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .hide-spinners {
          -moz-appearance: textfield;
        }
        @keyframes slideOver {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-over {
          animation: slideOver 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

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

      {/* Topbar */}
      <div className="main-topbar shrink-0 h-9 border-b-0" />

      {/* Main Settings Content */}
      <div className="settings-content !pt-3 flex-1 overflow-y-auto flex flex-col">
        {/* Top toolbar */}
        <div className="flex items-center justify-between gap-4 mb-5 shrink-0 select-none">
          <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">
            {t('settings.tool.listTitle', { count: configs.length })}
          </div>
        </div>

        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[var(--color-text-muted)] mt-12">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent)]" />
            <span className="text-xs">{t('settings.tool.loading')}</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-[1200px]">
            {configs.map(tool => {
              const toolMeta = INTEGRATED_TOOLS.find(tg => tg.id === tool.tool_type)!;
              const isConfigured = toolMeta.requiresApiKey === false || tool.hasKey || (editingKey[tool.id] && editingKey[tool.id] !== '••••••••');
              
              return (
                <div 
                  key={tool.id} 
                  className="provider-card flex flex-col justify-between min-h-[185px] h-auto py-4 border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-xl bg-[var(--color-bg-surface)] transition-colors"
                >
                  {/* Top: Icon, name and Toggle Switcher */}
                  <div className="flex items-start justify-between gap-3 select-none">
                    <div className="flex items-center gap-3">
                      {/* Tool Name and Status */}
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-bold text-[var(--color-text-primary)]">
                          {tool.name}
                        </span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            tool.is_enabled 
                              ? 'bg-[var(--color-success)] animate-pulse shadow-[0_0_8px_var(--color-success)]' 
                              : 'bg-[var(--color-text-muted)]'
                          }`} />
                          <span className="text-[10px] text-[var(--color-text-secondary)] font-medium">
                            {tool.is_enabled ? t('settings.tool.enabled') : (isConfigured ? t('settings.tool.disabled') : t('settings.tool.unconfigured'))}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Switch Switcher Toggle */}
                    <div 
                      onClick={() => isConfigured && handleToggle(tool)}
                      className={`relative w-8 h-4.5 rounded-full transition-all duration-200 shrink-0 ${
                        isConfigured 
                          ? 'cursor-pointer active:scale-95' 
                          : 'cursor-not-allowed opacity-30'
                      } ${
                        tool.is_enabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-strong)] border border-[var(--color-border)]'
                      }`}
                      title={isConfigured ? (tool.is_enabled ? t('settings.tool.disable') : t('settings.tool.enable')) : t('settings.tool.configKeyFirstTitle')}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform duration-200 shadow-sm ${
                        tool.is_enabled ? 'translate-x-3.5' : 'translate-x-0'
                      }`} />
                    </div>
                  </div>

                  {/* Middle: Desc Text */}
                  <p className="text-[11px] text-[var(--color-text-secondary)]/90 leading-relaxed line-clamp-2 my-2 select-text">
                    {toolMeta.desc}
                  </p>

                  {toolMeta.exposedTools && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {toolMeta.exposedTools.map(toolName => (
                        <span
                          key={toolName}
                          className="inline-flex items-center px-2 py-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-sunken)] text-[10px] font-mono text-[var(--color-text-muted)] select-all"
                        >
                          <Wrench className="w-2.5 h-2.5 mr-1 text-[var(--color-text-muted)] shrink-0" />
                          {toolName}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Bottom: Configure Button */}
                  <div className="flex justify-end pt-1">
                    <button 
                      onClick={() => handleExpand(tool)}
                      className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-[var(--color-border)]/80 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer select-none"
                    >
                      {t('settings.tool.configureParams')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Slide-over Side Drawer Configuration Panel */}
      {expandedTool && (
        <div className="fixed inset-0 z-[200] flex justify-end select-none">
          {/* Backdrop Overlay */}
          <div 
            className="absolute inset-0 bg-black/50 backdrop-blur-xs transition-opacity duration-300"
            onClick={() => setExpandedId(null)}
          />
          
          {/* Drawer Body container */}
          <div className="relative w-[400px] h-full bg-[var(--color-bg-surface)] border-l border-[var(--color-border-strong)] shadow-2xl flex flex-col justify-between p-6 z-10 animate-slide-over">
            <div className="flex flex-col gap-6">
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-[var(--color-border)]/40">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-[var(--color-accent)]" />
                  <h3 className="text-sm font-bold text-[var(--color-text-primary)]">
                    {t('settings.tool.configTitle', { name: expandedTool.name })}
                  </h3>
                </div>
              </div>

              {/* Warning Alert if unconfigured */}
              {!isToolConfigured(expandedTool) && INTEGRATED_TOOLS.find(tg => tg.id === expandedTool.tool_type)?.requiresApiKey !== false && (
                <div className="p-3 rounded-lg bg-[var(--color-danger-dim)] text-[var(--color-danger)] text-[11px] flex items-start gap-2 border border-[var(--color-danger)]/15 leading-relaxed">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{t('settings.tool.noKeyWarning')}</span>
                </div>
              )}

              {/* Forms */}
              <div className="flex flex-col gap-5">
                {INTEGRATED_TOOLS.find(tg => tg.id === expandedTool.tool_type)?.exposedTools && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                      {t('settings.tool.availableTools')}
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {INTEGRATED_TOOLS.find(tg => tg.id === expandedTool.tool_type)!.exposedTools!.map(toolName => (
                        <span
                          key={toolName}
                          className="inline-flex items-center px-2.5 py-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sunken)] text-xs font-mono text-[var(--color-text-secondary)] select-all"
                        >
                          <Wrench className="w-3 h-3 mr-1 text-[var(--color-text-muted)] shrink-0" />
                          {toolName}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* API Key (隐藏不需要 API Key 的工具) */}
                {INTEGRATED_TOOLS.find(tg => tg.id === expandedTool.tool_type)?.requiresApiKey !== false && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                      {t('settings.tool.apiKeyLabel')}
                    </label>
                    <div className="relative">
                      <input
                        type={showKeyMap[expandedTool.id] ? 'text' : 'password'}
                        value={editingKey[expandedTool.id] || ''}
                        onChange={(e) => setEditingKey(prev => ({ ...prev, [expandedTool.id]: e.target.value }))}
                        placeholder={INTEGRATED_TOOLS.find(tg => tg.id === expandedTool.tool_type)!.keyPlaceholder}
                        className="w-full bg-[var(--color-bg-app)] border border-[var(--color-border)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]/20 outline-none rounded-lg py-2 pl-3 pr-8 text-xs font-mono text-[var(--color-text-primary)] transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKeyMap(prev => ({ ...prev, [expandedTool.id]: !prev[expandedTool.id] }))}
                        className="absolute right-2.5 top-2.5 hover:text-[var(--color-text-primary)] text-[var(--color-text-muted)] cursor-pointer"
                      >
                        {showKeyMap[expandedTool.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                )}

                {/* Fields */}
                {INTEGRATED_TOOLS.find(tg => tg.id === expandedTool.tool_type)!.fields.map(field => {
                  const currentVal = editingConfig[expandedTool.id]?.[field.key] ?? field.default;
                  return (
                    <div key={field.key} className="flex flex-col gap-2">
                      <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                        {field.label}
                      </label>
                      {field.options ? (
                        <CustomSelect
                          value={currentVal}
                          onChange={(val) => setEditingConfig(prev => ({
                            ...prev,
                            [expandedTool.id]: {
                              ...prev[expandedTool.id],
                              [field.key]: val
                            }
                          }))}
                          options={field.options.map(option => ({ value: option, label: option }))}
                          className="max-w-[260px]"
                        />
                      ) : (
                        <input
                          type={field.type}
                          min={field.min ?? 1}
                          max={field.max ?? 50}
                          value={currentVal}
                          onChange={(e) => setEditingConfig(prev => ({
                            ...prev,
                            [expandedTool.id]: {
                              ...prev[expandedTool.id],
                              [field.key]: field.type === 'number'
                                ? parseInt(e.target.value) || field.default
                                : e.target.value
                            }
                          }))}
                          className="hide-spinners w-24 bg-[var(--color-bg-app)] border border-[var(--color-border)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]/20 outline-none rounded-lg py-2 px-3 text-xs text-[var(--color-text-primary)] transition-all"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="pt-4 border-t border-[var(--color-border)]/40 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => handleSaveConfig(expandedTool)}
                  className="btn btn-primary btn-sm rounded-lg text-xs font-bold px-4 py-2 cursor-pointer shadow-md"
                >
                  {t('settings.tool.saveConfig')}
                </button>
                <button 
                  onClick={() => setExpandedId(null)}
                  className="btn btn-secondary btn-sm rounded-lg text-xs font-semibold px-4 py-2 cursor-pointer hover:bg-[var(--color-bg-hover)]"
                >
                  {t('common.cancel')}
                </button>
              </div>

              {INTEGRATED_TOOLS.find(tg => tg.id === expandedTool.tool_type)?.requiresApiKey !== false && INTEGRATED_TOOLS.find(tg => tg.id === expandedTool.tool_type)!.docUrl && (
                <a
                  href={INTEGRATED_TOOLS.find(tg => tg.id === expandedTool.tool_type)!.docUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                >
                  {t('settings.tool.requestApiKey')}
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
