import { useState, useEffect } from 'react';
import { useLLMStore } from '../../stores/llmStore';
import { LLMProvider } from '../../../../shared/types';
import { 
  Plus, Trash2, Eye, EyeOff, Check, Loader2, AlertCircle, Edit2, Play, RefreshCw, X
} from 'lucide-react';
import { CustomSelect } from '../ui/CustomSelect';
import { ProviderIcon } from '@lobehub/icons';

const getDefaultModelForType = (type: string) => {
  switch (type) {
    case 'openai': return 'gpt-4o';
    case 'anthropic': return 'claude-3-5-sonnet-20241022';
    case 'deepseek': return 'deepseek-chat';
    case 'glm':
    case 'glm-overseas': return 'glm-4-flash';
    case 'minimax':
    case 'minimax-overseas': return 'abab6.5g-chat';
    case 'kimi': return 'moonshot-v1-8k';
    case 'qwen': return 'qwen-plus';
    case 'mimo': return 'mimo-chat';
    default: return 'gpt-4o';
  }
};

const getProviderLabel = (type: string): string => {
  switch (type) {
    case 'openai': return 'OpenAI';
    case 'anthropic': return 'Anthropic';
    case 'deepseek': return 'DeepSeek';
    case 'glm': return 'GLM CN';
    case 'glm-overseas': return 'GLM EN';
    case 'minimax': return 'Minimax CN';
    case 'minimax-overseas': return 'Minimax EN';
    case 'kimi': return 'Kimi';
    case 'qwen': return 'Qwen';
    case 'mimo': return 'Xiaomi MiMo';
    case 'ollama': return 'Ollama';
    case 'custom': return 'OpenAI Compatible';
    default: return 'OpenAI Compatible';
  }
};

const mapProviderTypeToIcon = (type: string): string => {
  if (type === 'glm' || type === 'glm-overseas') return 'zhipu';
  if (type === 'kimi') return 'moonshot';
  if (type === 'minimax-overseas') return 'minimax';
  return type;
};

const mergeModelsUnique = (existing: string[], newModels: string[]): string[] => {
  const combined: string[] = [];
  const seen = new Set<string>();
  
  for (const m of newModels) {
    const trimmed = m.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      combined.push(trimmed);
    }
  }
  
  for (const m of existing) {
    const trimmed = m.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      combined.push(trimmed);
    }
  }
  
  return combined;
};

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export function ModelSettings() {
  const { 
    providers, isLoading, error, 
    fetchProviders, saveProvider, deleteProvider, setActiveProvider 
  } = useLLMStore();

  // Toast State
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Modal Open/Close & Edit Mode
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);

  // Form State
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<LLMProvider['provider_type']>('openai');
  const [formKey, setFormKey] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formLimit, setFormLimit] = useState(8192);
  const [formActive, setFormActive] = useState(false);
  const [showKey, setShowKey] = useState(false);

  // Ollama Specific states in modal
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [fetchingOllama, setFetchingOllama] = useState(false);
  const [ollamaError, setOllamaError] = useState<string | null>(null);

  // Connecting testing states
  const [testingId, setTestingId] = useState<string | null>(null);
  const [fetchingModelsId, setFetchingModelsId] = useState<string | null>(null);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  // Connection Test logic
  const testConnection = async (p: LLMProvider) => {
    setTestingId(p.id);
    showToast(`正在测试 ${p.name} 的连接…`, 'info');
    try {
      let success = false;
      let details = '';
      
      if (p.provider_type === 'ollama') {
        const result = await window.electronAPI.llm.testProvider(p.id);
        success = result.ok;
        details = result.message;
      } else {
        const result = await window.electronAPI.llm.testProvider(p.id);
        success = result.ok;
        details = result.message;
      }
      
      if (success) {
        showToast(`✓ ${p.name} 连接成功: ${details}`, 'success');
      } else {
        showToast(`✗ ${p.name} 连接失败: ${details}`, 'error');
      }
    } catch (err: any) {
      showToast(`✗ ${p.name} 连接失败: 无法访问接口，请检查服务状态或网络地址`, 'error');
    } finally {
      setTestingId(null);
    }
  };

  // Fetch Models list and save to provider
  const fetchModelsList = async (p: LLMProvider) => {
    setFetchingModelsId(p.id);
    showToast(`正在从 ${p.name} 获取可用模型列表…`, 'info');
    try {
      let fetchedModels: string[] = [];
      fetchedModels = await window.electronAPI.llm.fetchProviderModels(p.id);

      if (fetchedModels && fetchedModels.length > 0) {
        const existing = p.models || [];
        const combined = mergeModelsUnique(existing, fetchedModels);
        const updatedProvider = {
          ...p,
          models: combined,
          default_model: p.default_model || fetchedModels[0]
        };
        await saveProvider(updatedProvider);
        showToast(`✓ 已成功获取并同步 ${fetchedModels.length} 个模型`, 'success');
      } else {
        showToast('未检测到有效模型，请检查后端模型配置是否为空', 'error');
      }
    } catch (err: any) {
      showToast(`✗ 获取模型失败: ${err.message || '请检查 Endpoint 和 API Key'}`, 'error');
    } finally {
      setFetchingModelsId(null);
    }
  };

  // Add a model tag inline
  const handleAddModelInline = async (p: LLMProvider, modelId: string) => {
    const trimmed = modelId.trim();
    if (!trimmed) return;
    
    const existing = p.models || [];
    const isDuplicate = existing.some(m => m.trim().toLowerCase() === trimmed.toLowerCase());
    if (isDuplicate) {
      showToast('该模型 ID 已存在', 'error');
      return;
    }

    const updated = {
      ...p,
      models: [...existing, trimmed],
      default_model: p.default_model || trimmed
    };

    try {
      await saveProvider(updated);
      showToast(`✓ 模型 ${trimmed} 已添加`, 'success');
    } catch (err) {
      showToast('添加模型失败', 'error');
    }
  };

  // Remove a model tag inline
  const handleRemoveModelInline = async (p: LLMProvider, modelId: string) => {
    const existing = p.models || [];
    const filtered = existing.filter(m => m !== modelId);
    
    // Fallback default_model if we removed the active default
    let defaultModel = p.default_model;
    if (defaultModel === modelId) {
      defaultModel = filtered.length > 0 ? filtered[0] : '';
    }

    const updated = {
      ...p,
      models: filtered,
      default_model: defaultModel
    };

    try {
      await saveProvider(updated);
      showToast(`✓ 模型 ${modelId} 已移除`, 'success');
    } catch (err) {
      showToast('移除模型失败', 'error');
    }
  };

  // Open modal for editing
  const openEditModal = (p: LLMProvider) => {
    setEditingProviderId(p.id);
    setFormName(p.provider_type === 'custom' ? p.name : getProviderLabel(p.provider_type));
    setFormType(p.provider_type);
    setFormKey(p.hasKey ? '••••••••' : '');
    setFormUrl(p.api_url || '');
    setFormModel(p.default_model);
    setFormLimit(p.context_limit);
    setFormActive(p.is_active === 1);
    setOllamaModels([]);
    setOllamaError(null);
    setShowKey(false);
    setIsModalOpen(true);
  };

  // Open modal for creating
  const openCreateModal = () => {
    setEditingProviderId(null);
    setFormName('OpenAI');
    setFormType('openai');
    setFormKey('');
    setFormUrl('https://api.openai.com/v1');
    setFormModel('gpt-4o');
    setFormLimit(8192);
    setFormActive(false);
    setOllamaModels([]);
    setOllamaError(null);
    setShowKey(false);
    setIsModalOpen(true);
  };

  // Fetch Ollama models inside form modal
  const handleFetchOllamaInModal = async () => {
    const url = formUrl || 'http://localhost:11434';
    setFetchingOllama(true);
    setOllamaError(null);
    try {
      const models = await window.electronAPI.llm.fetchOllamaModels(url);
      setOllamaModels(models);
      if (models.length > 0 && !formModel) {
        setFormModel(models[0]);
      }
      showToast(`✓ 获取到 ${models.length} 个 Ollama 模型`, 'success');
    } catch (err: any) {
      setOllamaError(err.message || '获取本地模型失败，请确认 Ollama 已启动。');
      showToast('获取 Ollama 模型失败', 'error');
    } finally {
      setFetchingOllama(false);
    }
  };

  // Save from form modal
  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    const id = editingProviderId || window.crypto.randomUUID();
    const existingProvider = providers.find(p => p.id === id);
    const existingModels = existingProvider ? (existingProvider.models || []) : [];

    const providerPayload = {
      id,
      name: formName,
      provider_type: formType,
      api_key: formKey,
      api_url: formUrl || undefined,
      default_model: formModel || getDefaultModelForType(formType),
      context_limit: formLimit || 8192,
      is_active: formActive ? 1 : 0,
      models: existingModels
    };

    // Auto append default model if it is not in models list yet (case-insensitive check)
    if (providerPayload.default_model) {
      const defModelTrimmed = providerPayload.default_model.trim();
      const hasDefault = existingModels.some(m => m.trim().toLowerCase() === defModelTrimmed.toLowerCase());
      if (!hasDefault) {
        providerPayload.models = [...existingModels, defModelTrimmed];
      }
    }

    try {
      await saveProvider(providerPayload);
      showToast(`✓ 供应商 ${formName} 保存成功`, 'success');
      setIsModalOpen(false);
    } catch (err) {
      showToast('保存供应商失败', 'error');
    }
  };

  // Delete provider
  const handleDeleteProvider = async (id: string, name: string) => {
    if (confirm(`确定要删除供应商「${name}」吗？此操作将清除所有相关模型配置！`)) {
      try {
        await deleteProvider(id);
        showToast(`✓ 供应商 ${name} 已成功删除`, 'success');
      } catch (err) {
        showToast('删除供应商失败', 'error');
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--bg-app)] overflow-hidden">
      {/* Topbar */}
      <div className="main-topbar shrink-0 h-9 border-b-0" />

      {/* Main Settings Content */}
      <div className="settings-content !pt-3">
        {/* 内置的操作 Toolbar 面板 */}
        <div className="flex items-center justify-between gap-4 mb-4 shrink-0">
          <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
            模型供应商列表 ({providers.length})
          </div>
          <button className="btn btn-primary flex items-center gap-1.5 cursor-pointer text-xs py-1.5" onClick={openCreateModal}>
            <Plus className="w-4 h-4" />
            <span>添加供应商</span>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-[var(--color-danger-dim)] border border-[var(--color-danger)]/20 rounded-lg flex items-start gap-2 text-xs text-[var(--color-danger)]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="provider-list">
          {providers.map((p) => (
            <div key={p.id} className="provider-card">
              <div className="provider-card-head">
                <div className="provider-meta">
                  <div className="provider-icon bg-transparent flex items-center justify-center p-0.5 border-0">
                    <ProviderIcon provider={mapProviderTypeToIcon(p.provider_type)} size={32} />
                  </div>
                  <div>
                    <div className="provider-name flex items-center gap-2">
                      <span>{p.name}</span>
                      {p.is_active === 1 && (
                        <span className="px-1.5 py-0.5 rounded text-xs bg-[var(--color-success-dim)] text-[var(--color-success)] font-semibold uppercase">
                          已激活
                        </span>
                      )}
                    </div>
                    <div className="provider-type capitalize">
                      {p.provider_type} · {p.api_url || '官方 API 接口'}
                    </div>
                  </div>
                </div>

                <div className="provider-actions">
                  <span 
                    className={`status-dot ${p.is_active === 1 ? '' : 'offline'}`} 
                    title={p.is_active === 1 ? '默认使用中' : '闲置中'}
                  />
                  
                  {/* Test Connection Button */}
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => testConnection(p)}
                    disabled={testingId === p.id}
                    title="测试接口连接"
                    aria-label="测试接口连接"
                  >
                    {testingId === p.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    测试
                  </button>

                  {/* Fetch Models Button */}
                  {p.provider_type !== 'anthropic' && (
                    <button 
                      className="btn btn-secondary btn-sm" 
                      onClick={() => fetchModelsList(p)}
                      disabled={fetchingModelsId === p.id}
                      title="自动拉取可用模型列表"
                    >
                      {fetchingModelsId === p.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      获取模型
                    </button>
                  )}

                  {/* Set Active Button */}
                  {p.is_active !== 1 && (
                    <button 
                      className="btn btn-secondary btn-sm text-[var(--color-success)] border-[var(--color-success)]/30 hover:bg-[var(--color-success-dim)]"
                      onClick={() => {
                        setActiveProvider(p.id);
                        showToast(`✓ 已激活默认提供商: ${p.name}`, 'success');
                      }}
                    >
                      激活
                    </button>
                  )}

                  {/* Edit Button */}
                  <button 
                    className="btn btn-secondary btn-sm" 
                    onClick={() => openEditModal(p)}
                    title="编辑基础配置"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    编辑
                  </button>

                  {/* Delete Button */}
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => handleDeleteProvider(p.id, p.name)}
                    title="删除供应商"
                    aria-label="删除供应商"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    删除
                  </button>
                </div>
              </div>

              {/* Models Tags & Adding Section */}
              <div className="provider-models">
                <div className="models-label">已配置模型标签（{p.models?.length || 0}）</div>
                
                <div className="model-tags">
                  {p.models && p.models.map((modelName) => (
                    <span key={modelName} className={`model-tag ${p.default_model === modelName ? 'border-[var(--color-accent)] text-[var(--color-accent-hover)] font-medium bg-[var(--color-accent-dim)]' : ''}`}>
                      {modelName}
                      {p.default_model === modelName && <span className="text-xs text-[var(--color-accent-hover)]">(默认)</span>}
                      <button 
                        className="remove-model" 
                        onClick={() => handleRemoveModelInline(p, modelName)} 
                        title="移除此模型"
                        aria-label="移除此模型"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {(!p.models || p.models.length === 0) && (
                    <span className="text-xs text-[var(--color-text-muted)] italic">暂未配置模型，可在下方手动输入或点击“获取模型”</span>
                  )}
                </div>

                <div className="add-model-row">
                  <input 
                    id={`newModel-${p.id}`} 
                    placeholder="手动输入模型 ID，回车或点击右侧添加 (如: gpt-4o)" 
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const target = e.target as HTMLInputElement;
                        handleAddModelInline(p, target.value);
                        target.value = '';
                      }
                    }}
                  />
                  <button 
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      const input = document.getElementById(`newModel-${p.id}`) as HTMLInputElement;
                      if (input && input.value.trim()) {
                        handleAddModelInline(p, input.value.trim());
                        input.value = '';
                      }
                    }}
                  >
                    添加
                  </button>
                </div>
              </div>
            </div>
          ))}

          {providers.length === 0 && (
            <div className="text-center py-16 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl text-sm text-[var(--color-text-muted)]">
              暂无配置好的模型供应商，点击右上角「添加供应商」按钮开始！
            </div>
          )}
        </div>
      </div>

      {/* Edit / Add Modal Overlay */}
      {isModalOpen && (
        <div className="modal-overlay visible">
          <div className="modal animate-fade-in w-[480px] p-6">
            <div className="flex justify-between items-center modal-title border-b border-[var(--color-border)] pb-3 mb-4">
              <span className="font-semibold text-base">
                {editingProviderId ? `编辑供应商 · ${formName}` : '添加供应商'}
              </span>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-all"
                aria-label="关闭弹窗"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <form onSubmit={handleSaveModal} className="space-y-4">
              {/* Name & Type */}
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="form-label">供应商名称 <span className="text-[var(--color-danger)]">*</span></label>
                  <input 
                    className="form-input" 
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="例如：OpenAI / Anthropic / 硅基流动"
                    required
                    disabled={formType !== 'custom'}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">服务类型</label>
                  <CustomSelect
                    value={formType}
                    onChange={(val) => {
                      const type = val as LLMProvider['provider_type'];
                      setFormType(type);
                      if (type !== 'custom') {
                        setFormName(getProviderLabel(type));
                      }
                      if (type === 'ollama') {
                        setFormUrl('http://localhost:11434');
                        setFormLimit(8192);
                      } else if (type === 'openai') {
                        setFormUrl('https://api.openai.com/v1');
                        setFormLimit(8192);
                      } else if (type === 'anthropic') {
                        setFormUrl('https://api.anthropic.com/v1');
                        setFormLimit(200000);
                      } else if (type === 'deepseek') {
                        setFormUrl('https://api.deepseek.com');
                        setFormLimit(64000);
                      } else if (type === 'glm') {
                        setFormUrl('https://open.bigmodel.cn/api/paas/v4');
                        setFormLimit(128000);
                      } else if (type === 'glm-overseas') {
                        setFormUrl('https://open.bigmodel.cn/api/paas/v4');
                        setFormLimit(128000);
                      } else if (type === 'minimax') {
                        setFormUrl('https://api.minimaxi.com/v1');
                        setFormLimit(64000);
                      } else if (type === 'minimax-overseas') {
                        setFormUrl('https://api.minimax.io/v1');
                        setFormLimit(64000);
                      } else if (type === 'kimi') {
                        setFormUrl('https://api.moonshot.ai/v1');
                        setFormLimit(128000);
                      } else if (type === 'qwen') {
                        setFormUrl('https://dashscope.aliyuncs.com/compatible-mode/v1');
                        setFormLimit(128000);
                      } else if (type === 'mimo') {
                        setFormUrl('https://api.xiaomimimo.com/v1');
                        setFormLimit(64000);
                      } else {
                        setFormUrl('');
                      }
                    }}
                    options={[
                      { value: 'openai', label: 'OpenAI' },
                      { value: 'anthropic', label: 'Anthropic' },
                      { value: 'deepseek', label: 'DeepSeek' },
                      { value: 'glm', label: 'GLM CN' },
                      { value: 'glm-overseas', label: 'GLM EN' },
                      { value: 'minimax', label: 'Minimax CN' },
                      { value: 'minimax-overseas', label: 'Minimax EN' },
                      { value: 'kimi', label: 'Kimi' },
                      { value: 'qwen', label: 'Qwen' },
                      { value: 'mimo', label: 'Xiaomi MiMo' },
                      { value: 'ollama', label: 'Ollama' },
                      { value: 'custom', label: 'OpenAI Compatible' }
                    ]}
                  />
                </div>
              </div>

              {/* Endpoint API URL */}
              <div className="form-group">
                <label className="form-label">API Endpoint</label>
                <input 
                  className="form-input" 
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder={formType === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1'}
                />
                <div className="form-hint">接口请求的基础 Base URL 地址，末尾不需要带斜杠</div>
              </div>

              {/* API Key (Show unless type is Ollama) */}
              {formType !== 'ollama' && (
                <div className="form-group">
                  <label className="form-label">API Key <span className="text-[var(--color-danger)]">*</span></label>
                  <div className="relative flex items-center">
                    <input 
                      type={showKey ? 'text' : 'password'}
                      className="form-input pr-10"
                      value={formKey}
                      onChange={(e) => setFormKey(e.target.value)}
                      placeholder={formKey === '••••••••' ? '••••••••' : 'sk-...'}
                      required={!editingProviderId || !providers.find(p => p.id === editingProviderId)?.hasKey}
                    />
                    <button 
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-3 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-all"
                      aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {/* Default Model & Context Limit */}
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="form-label">默认模型名称</label>
                  
                  {formType === 'ollama' && (
                    <div className="flex gap-2 mb-2">
                      <button
                        type="button"
                        onClick={handleFetchOllamaInModal}
                        className="text-xs bg-[var(--color-accent-dim)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white transition-all px-2.5 py-1.5 rounded-lg flex items-center gap-1"
                        disabled={fetchingOllama}
                      >
                        {fetchingOllama ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            获取中...
                          </>
                        ) : (
                          '获取本地模型列表'
                        )}
                      </button>
                      {ollamaError && (
                        <span className="text-xs text-[var(--color-danger)] self-center truncate max-w-[120px]" title={ollamaError}>
                          拉取失败
                        </span>
                      )}
                    </div>
                  )}

                  {formType === 'ollama' && ollamaModels.length > 0 ? (
                    <CustomSelect
                      value={formModel}
                      onChange={(val) => setFormModel(val)}
                      options={ollamaModels.map(m => ({ value: m, label: m }))}
                    />
                  ) : (
                    <input 
                      className="form-input" 
                      value={formModel}
                      onChange={(e) => setFormModel(e.target.value)}
                      placeholder={getDefaultModelForType(formType)}
                      required
                    />
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">上下文限额 (Tokens)</label>
                  <input 
                    type="number"
                    className="form-input" 
                    value={formLimit}
                    onChange={(e) => setFormLimit(parseInt(e.target.value) || 8192)}
                    min="512"
                    max="1000000"
                    required
                  />
                </div>
              </div>

              {/* Is Active Checkbox */}
              <div className="flex items-center gap-2 pt-1">
                <input 
                  type="checkbox"
                  id="modal_is_active"
                  checked={formActive}
                  onChange={(e) => setFormActive(e.target.checked)}
                  className="w-4 h-4 rounded text-[var(--color-accent)] focus:ring-[var(--color-accent)] border-[var(--color-border)] accent-[var(--color-accent)] cursor-pointer"
                />
                <label htmlFor="modal_is_active" className="text-xs font-semibold text-[var(--color-text-secondary)] select-none cursor-pointer">
                  将此提供商设为激活的模型（默认聊天使用）
                </label>
              </div>

              {/* Actions */}
              <div className="modal-actions border-t border-[var(--color-border)] pt-4 mt-6">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)}
                  className="btn btn-secondary"
                >
                  取消
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                >
                  保存配置
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast Alert Portal */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type} flex items-center gap-2`}>
            {t.type === 'success' && (
              <svg className="toast-icon text-[var(--color-success)] w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {t.type === 'error' && (
              <svg className="toast-icon text-[var(--color-danger)] w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
            {t.type === 'info' && (
              <svg className="toast-icon text-[var(--color-info)] w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            )}
            <span className="text-xs text-[var(--color-text-primary)]">{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
