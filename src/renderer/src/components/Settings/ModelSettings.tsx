import { useState, useEffect } from 'react';
import { useLLMStore } from '../../stores/llmStore';
import { LLMProvider } from '../../../../shared/types';
import { 
  Plus, Trash2, Eye, EyeOff, Check, Loader2, AlertCircle, Edit2, Play, RefreshCw, X
} from 'lucide-react';

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
        const url = p.api_url || 'http://localhost:11434';
        const models = await window.electronAPI.llm.fetchOllamaModels(url);
        success = true;
        details = `检测到 ${models.length} 个本地模型`;
      } else {
        const endpoint = p.api_url || 'https://api.openai.com/v1';
        const url = endpoint.endsWith('/') ? `${endpoint}models` : `${endpoint}/models`;
        
        const headers: HeadersInit = {};
        if (p.api_key && p.api_key !== '••••••••') {
          headers['Authorization'] = `Bearer ${p.api_key}`;
        }
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        
        try {
          const res = await fetch(url, { headers, signal: controller.signal });
          clearTimeout(timeoutId);
          if (res.status === 200) {
            success = true;
            details = '连接成功，接口响应正常';
          } else if (res.status === 401) {
            success = true;
            details = '连接成功（未授权或 API 密钥无效，请检查）';
          } else {
            success = false;
            details = `HTTP 状态码 ${res.status}`;
          }
        } catch (err) {
          clearTimeout(timeoutId);
          throw err;
        }
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
      if (p.provider_type === 'ollama') {
        const url = p.api_url || 'http://localhost:11434';
        fetchedModels = await window.electronAPI.llm.fetchOllamaModels(url);
      } else if (p.provider_type === 'openai' || p.provider_type === 'custom') {
        const endpoint = p.api_url || 'https://api.openai.com/v1';
        const url = endpoint.endsWith('/') ? `${endpoint}models` : `${endpoint}/models`;
        
        const headers: HeadersInit = {};
        if (p.api_key && p.api_key !== '••••••••') {
          headers['Authorization'] = `Bearer ${p.api_key}`;
        }
        
        const res = await fetch(url, { headers });
        if (res.status === 200) {
          const data = await res.json();
          if (data && Array.isArray(data.data)) {
            fetchedModels = data.data.map((m: any) => m.id);
          }
        } else if (res.status === 401) {
          throw new Error('未授权，密钥不正确，无法自动获取。请点击“编辑”提供有效密钥');
        } else {
          throw new Error(`HTTP 异常 ${res.status}`);
        }
      } else {
        showToast(`Anthropic 暂不支持自动获取，请在输入框中手动填写模型 ID`, 'info');
        setFetchingModelsId(null);
        return;
      }

      if (fetchedModels && fetchedModels.length > 0) {
        const existing = p.models || [];
        const combined = Array.from(new Set([...existing, ...fetchedModels]));
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
    if (existing.includes(trimmed)) {
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
    setFormName(p.name);
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
    setFormName('');
    setFormType('openai');
    setFormKey('');
    setFormUrl('');
    setFormModel('');
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
      default_model: formModel || (formType === 'openai' ? 'gpt-4o' : formType === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'llama3'),
      context_limit: formLimit || 8192,
      is_active: formActive ? 1 : 0,
      models: existingModels
    };

    // Auto append default model if it is not in models list yet
    if (providerPayload.default_model && !existingModels.includes(providerPayload.default_model)) {
      providerPayload.models = [...existingModels, providerPayload.default_model];
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
      <div className="main-topbar flex items-center justify-between">
        <div>
          <div className="topbar-title">模型供应商配置</div>
          <div className="topbar-subtitle">管理 API 密钥、接口端点和可用模型标签</div>
        </div>
        <div className="topbar-actions flex items-center gap-2">
          <button className="btn btn-primary flex items-center gap-1.5 no-drag" onClick={openCreateModal}>
            <Plus className="w-4 h-4" />
            <span>添加供应商</span>
          </button>
        </div>
      </div>

      {/* Main Settings Content */}
      <div className="settings-content">
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
                  <div className="provider-icon">
                    {p.name ? p.name.charAt(0).toUpperCase() : 'M'}
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
          <div className="modal animate-fade-in">
            <div className="flex justify-between items-center modal-title border-b border-[var(--color-border)] pb-3 mb-4">
              <span className="font-semibold text-base">
                {editingProviderId ? `编辑供应商 · ${formName}` : '添加供应商'}
              </span>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-all"
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
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">服务类型</label>
                  <select 
                    value={formType}
                    onChange={(e) => {
                      const type = e.target.value as LLMProvider['provider_type'];
                      setFormType(type);
                      if (type === 'ollama') {
                        setFormUrl('http://localhost:11434');
                        setFormLimit(8192);
                      } else if (type === 'openai') {
                        setFormUrl('https://api.openai.com/v1');
                        setFormLimit(8192);
                      } else if (type === 'anthropic') {
                        setFormUrl('https://api.anthropic.com/v1');
                        setFormLimit(200000);
                      } else {
                        setFormUrl('');
                      }
                    }}
                    className="form-input bg-[var(--color-bg-app)] border border-[var(--color-border)] focus:border-[var(--color-accent)] rounded-lg outline-none"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="ollama">Ollama (本地运行)</option>
                    <option value="custom">Custom (OpenAI 兼容)</option>
                  </select>
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
                    <select
                      value={formModel}
                      onChange={(e) => setFormModel(e.target.value)}
                      className="form-input bg-[var(--color-bg-app)] border border-[var(--color-border)] focus:border-[var(--color-accent)] rounded-lg outline-none"
                    >
                      {ollamaModels.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  ) : (
                    <input 
                      className="form-input" 
                      value={formModel}
                      onChange={(e) => setFormModel(e.target.value)}
                      placeholder={formType === 'openai' ? 'gpt-4o' : formType === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'llama3'}
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

