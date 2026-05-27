import { useState, useEffect, useRef } from 'react';
import { 
  Check, Loader2, AlertCircle, Wrench, Eye, EyeOff, HelpCircle, Save, Info, ShieldAlert, Sliders, X
} from 'lucide-react';

interface ToolMeta {
  id: string;
  name: string;
  desc: string;
  keyPlaceholder: string;
  docUrl?: string;
  requiresApiKey?: boolean;
  fields: Array<{
    key: string;
    label: string;
    type: 'text' | 'number';
    default: any;
  }>;
}

const INTEGRATED_TOOLS: ToolMeta[] = [
  {
    id: 'tavily',
    name: 'Tavily',
    desc: '专为大模型设计的智能搜索引擎。提供极高精度的网页内容提取，针对大模型进行了搜索输出优化。常用于通用事实问答与新闻检索。',
    keyPlaceholder: '请输入 Tavily API Key (tvly-...)',
    docUrl: 'https://tavily.com',
    fields: [
      {
        key: 'max_results',
        label: '最大检索结果条数',
        type: 'number',
        default: 5
      }
    ]
  },
  {
    id: 'anysearch',
    name: 'AnySearch',
    desc: '面向专业垂直领域（如学术论文、代码库、金融证券、医疗法律等）的高级搜索工具。支持过滤指定的专业领域以获得更准确的搜索质量。',
    keyPlaceholder: '请输入 AnySearch 密钥 (Bearer Token)',
    docUrl: 'https://anysearch.com',
    fields: [
      {
        key: 'max_results',
        label: '最大检索结果条数',
        type: 'number',
        default: 5
      }
    ]
  },
  {
    id: 'arxiv',
    name: 'arXiv',
    desc: '免费的学术论文搜索引擎，覆盖物理学、数学、计算机科学、生物学等领域的预印本论文。无需 API Key，启用即可使用。',
    keyPlaceholder: '',
    requiresApiKey: false,
    fields: [
      {
        key: 'max_results',
        label: '最大检索结果条数',
        type: 'number',
        default: 5
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
      showToast('获取工具配置失败', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadConfigs();
  }, []);

  const handleToggle = async (tool: ToolConfigItem) => {
    const toolMeta = INTEGRATED_TOOLS.find(t => t.id === tool.tool_type);
    const needsKey = toolMeta?.requiresApiKey !== false;

    // 没配置 API 的默认停用，不允许启用（不需要 API Key 的工具除外）
    if (needsKey && !tool.hasKey && (!tool.api_key || tool.api_key === '••••••••')) {
      showToast(`请先配置并保存 ${tool.name} 的 API Key 再启用！`, 'error');
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
      showToast(`${tool.name} 已${updated.is_enabled ? '启用' : '停用'}`, 'success');
      loadConfigs();
    } catch (err) {
      showToast('操作失败，请重试', 'error');
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
    const toolMeta = INTEGRATED_TOOLS.find(t => t.id === tool.tool_type);
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
      showToast(`${tool.name} 配置已保存！`, 'success');
      setExpandedId(null);
      loadConfigs();
    } catch (err) {
      showToast('保存配置失败，请检查输入格式', 'error');
    }
  };

  const expandedTool = configs.find(c => c.id === expandedId);
  const isToolConfigured = (tool: ToolConfigItem) => {
    const toolMeta = INTEGRATED_TOOLS.find(t => t.id === tool.tool_type);
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
          <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
            通用内置工具列表 ({configs.length})
          </div>
        </div>

        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[var(--color-text-muted)] mt-12">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent)]" />
            <span className="text-xs">加载配置中...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-[1200px]">
            {configs.map(tool => {
              const toolMeta = INTEGRATED_TOOLS.find(t => t.id === tool.tool_type)!;
              const isConfigured = toolMeta.requiresApiKey === false || tool.hasKey || (editingKey[tool.id] && editingKey[tool.id] !== '••••••••');
              
              return (
                <div 
                  key={tool.id} 
                  className="provider-card flex flex-col justify-between h-[160px] border border-[var(--color-border)] hover:border-[var(--color-accent)]/50 rounded-xl bg-[var(--color-bg-surface)] shadow-sm hover:shadow-md transition-all"
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
                            {tool.is_enabled ? '已启用' : (isConfigured ? '已停用' : '未配置')}
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
                        tool.is_enabled ? 'bg-[var(--color-accent)]' : 'bg-black/30 dark:bg-white/10 border border-[var(--color-border)]/50'
                      }`}
                      title={isConfigured ? (tool.is_enabled ? '停用' : '启用') : '请先配置 API Key 再启用'}
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

                  {/* Bottom: Configure Button */}
                  <div className="flex justify-end pt-1">
                    <button 
                      onClick={() => handleExpand(tool)}
                      className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-[var(--color-border)]/80 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer select-none"
                    >
                      配置参数
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
                    配置 {expandedTool.name}
                  </h3>
                </div>
                <button 
                  onClick={() => setExpandedId(null)}
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Warning Alert if unconfigured */}
              {!isToolConfigured(expandedTool) && INTEGRATED_TOOLS.find(t => t.id === expandedTool.tool_type)?.requiresApiKey !== false && (
                <div className="p-3 rounded-lg bg-[var(--color-danger-dim)] text-[var(--color-danger)] text-[11px] flex items-start gap-2 border border-[var(--color-danger)]/15 leading-relaxed">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>未检测到 API 密钥。配置并保存后方可启用此通用工具。</span>
                </div>
              )}

              {/* Forms */}
              <div className="flex flex-col gap-5">
                {/* API Key (隐藏不需要 API Key 的工具) */}
                {INTEGRATED_TOOLS.find(t => t.id === expandedTool.tool_type)?.requiresApiKey !== false && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                      API 密钥 (API Key / Token)
                    </label>
                    <div className="relative">
                      <input
                        type={showKeyMap[expandedTool.id] ? 'text' : 'password'}
                        value={editingKey[expandedTool.id] || ''}
                        onChange={(e) => setEditingKey(prev => ({ ...prev, [expandedTool.id]: e.target.value }))}
                        placeholder={INTEGRATED_TOOLS.find(t => t.id === expandedTool.tool_type)!.keyPlaceholder}
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
                {INTEGRATED_TOOLS.find(t => t.id === expandedTool.tool_type)!.fields.map(field => {
                  const currentVal = editingConfig[expandedTool.id]?.[field.key] ?? field.default;
                  return (
                    <div key={field.key} className="flex flex-col gap-2">
                      <label className="text-xs font-semibold text-[var(--color-text-secondary)]">
                        {field.label}
                      </label>
                      <input 
                        type="number"
                        min={1}
                        max={50}
                        value={currentVal}
                        onChange={(e) => setEditingConfig(prev => ({
                          ...prev,
                          [expandedTool.id]: {
                            ...prev[expandedTool.id],
                            [field.key]: parseInt(e.target.value) || field.default
                          }
                        }))}
                        className="hide-spinners w-24 bg-[var(--color-bg-app)] border border-[var(--color-border)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]/20 outline-none rounded-lg py-2 px-3 text-xs text-[var(--color-text-primary)] transition-all"
                      />
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
                  保存配置
                </button>
                <button 
                  onClick={() => setExpandedId(null)}
                  className="btn btn-secondary btn-sm rounded-lg text-xs font-semibold px-4 py-2 cursor-pointer hover:bg-[var(--color-bg-hover)]"
                >
                  取消
                </button>
              </div>

              {INTEGRATED_TOOLS.find(t => t.id === expandedTool.tool_type)?.requiresApiKey !== false && INTEGRATED_TOOLS.find(t => t.id === expandedTool.tool_type)!.docUrl && (
                <a
                  href={INTEGRATED_TOOLS.find(t => t.id === expandedTool.tool_type)!.docUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                >
                  申请 API Key
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
