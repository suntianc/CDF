import React, { useState, useEffect } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import { useLLMStore } from '../../stores/llmStore';
import { useSkillStore } from '../../stores/skillStore';
import { useMcpServerStore } from '../../stores/mcpServerStore';
import { 
  X, Bot, Brain, Layers, Cpu, Code
} from 'lucide-react';

interface AgentEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string | null; // Null means create, non-null means edit
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function AgentEditDialog({ isOpen, onClose, agentId, showToast }: AgentEditDialogProps) {
  const { agents, saveAgent } = useAgentStore();
  const { providers } = useLLMStore();
  const { skills } = useSkillStore();
  const { mcpServers } = useMcpServerStore();

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
        setFormSkillIds(agent.skillIds || []);
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
      showToast('Agent 名称不能为空', 'error');
      return;
    }
    if (!formProviderId) {
      showToast('请先去“模型配置”页面添加并激活一个 LLM 大脑！', 'error');
      return;
    }

    const id = agentId || window.crypto.randomUUID();
    const payload = {
      id,
      name: formName,
      description: formDesc,
      provider_id: formProviderId || null,
      system_prompt: formSystemPrompt,
      mcpServerIds: formMcpIds,
      skillIds: formSkillIds,
    };

    try {
      await saveAgent(payload);
      showToast(`✓ Agent「${formName}」保存成功`, 'success');
      onClose();
    } catch (err) {
      showToast('保存 Agent 失败', 'error');
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
            <span>{agentId ? `配置 Agent · ${formName}` : '创建新 Agent 角色'}</span>
          </span>
          <button 
            onClick={onClose}
            className="p-1 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer"
            aria-label="关闭弹窗"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content - Two Columns */}
        <form onSubmit={handleSaveAgent} className="flex-1 flex overflow-hidden min-h-0">
          {/* Left Column - Core Configuration (40%) */}
          <div className="w-[40%] border-r border-[var(--color-border)] p-6 overflow-y-auto space-y-4">
            <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Brain className="w-3.5 h-3.5" />
              <span>核心心智配置</span>
            </div>

            <div className="form-group">
              <label className="form-label">Agent 名称 <span className="text-[var(--color-danger)]">*</span></label>
              <input 
                className="form-input" 
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="如：全栈重构助理 / 质量审计专家"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Agent 描述</label>
              <textarea 
                className="form-input min-h-[80px] resize-none py-2" 
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="简述该 Agent 在工作流中的定位与专属功能..."
              />
            </div>

            <div className="form-group">
              <label className="form-label">选择 LLM 大脑 <span className="text-[var(--color-danger)]">*</span></label>
              <select 
                value={formProviderId}
                onChange={(e) => setFormProviderId(e.target.value)}
                className="form-input bg-[var(--color-bg-app)] border border-[var(--color-border)] focus:border-[var(--color-accent)] rounded-lg outline-none cursor-pointer"
                required
              >
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.default_model})</option>
                ))}
                {providers.length === 0 && (
                  <option value="">暂无可用大脑，请去设置页配置</option>
                )}
              </select>
              <div className="form-hint">Agent 运行决策时使用的核心大语言模型</div>
            </div>
          </div>

          {/* Right Column - Ability & Prompt Config (60%) */}
          <div className="w-[60%] p-6 overflow-y-auto flex flex-col min-h-0">
            <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5" />
              <span>能力绑定与系统设定</span>
            </div>

            {/* System Prompt Textarea */}
            <div className="form-group flex-1 flex flex-col mb-4 min-h-[160px]">
              <label className="form-label">System Prompt (系统设定)</label>
              <textarea 
                className="form-input flex-1 font-mono text-xs leading-relaxed resize-none p-3 bg-[var(--color-bg-sidebar)]/30 border border-[var(--color-border)]"
                value={formSystemPrompt}
                onChange={(e) => setFormSystemPrompt(e.target.value)}
                placeholder="输入详细的系统预设词，规定该 Agent 的人设、工作风格和指令规范。建议使用 Markdown 格式..."
              />
            </div>

            {/* MCP & Skills binding badgelists */}
            <div className="grid grid-cols-2 gap-4">
              {/* MCP Servers */}
              <div className="form-group relative">
                <label className="form-label">绑定 MCP 服务工具 ({formMcpIds.length})</label>
                <div className="flex flex-wrap gap-1.5 p-2 bg-[var(--color-bg-sidebar)]/50 border border-[var(--color-border)]/75 rounded-lg min-h-[70px] max-h-[140px] overflow-y-auto">
                  {formMcpIds.map(id => {
                    const s = mcpServers.find(m => m.id === id);
                    return s ? (
                      <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--color-accent-dim)] text-[var(--color-accent-hover)] font-medium text-xs select-none">
                        {s.name}
                        <button 
                          type="button" 
                          onClick={() => toggleMcpBinding(id)}
                          className="hover:text-red-500 font-bold ml-0.5 cursor-pointer"
                        >
                          ×
                        </button>
                      </span>
                    ) : null;
                  })}
                  {formMcpIds.length === 0 && (
                    <span className="text-[11px] text-[var(--color-text-muted)] italic self-center pl-1">未绑定任何工具</span>
                  )}
                </div>
                
                <button 
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMcpDropdownOpen(!mcpDropdownOpen);
                    setSkillDropdownOpen(false);
                  }}
                  className="mt-1.5 text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] font-medium flex items-center gap-0.5 cursor-pointer"
                >
                  [+] 绑定 MCP 工具
                </button>

                {mcpDropdownOpen && (
                  <div className="absolute left-0 bottom-8 w-full max-h-[180px] overflow-y-auto border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-lg rounded-lg z-50 p-1 animate-fade-in select-none">
                    {mcpServers.filter(s => !formMcpIds.includes(s.id)).map(s => (
                      <div 
                        key={s.id} 
                        onClick={() => toggleMcpBinding(s.id)}
                        className="px-3 py-1.5 text-xs rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] cursor-pointer"
                      >
                        {s.name} ({s.server_type})
                      </div>
                    ))}
                    {mcpServers.filter(s => !formMcpIds.includes(s.id)).length === 0 && (
                      <div className="text-center py-3 text-xs text-[var(--color-text-muted)] italic">没有更多可用工具</div>
                    )}
                  </div>
                )}
              </div>

              {/* Skills */}
              <div className="form-group relative">
                <label className="form-label">绑定 Skills 技能 ({formSkillIds.length})</label>
                <div className="flex flex-wrap gap-1.5 p-2 bg-[var(--color-bg-sidebar)]/50 border border-[var(--color-border)]/75 rounded-lg min-h-[70px] max-h-[140px] overflow-y-auto">
                  {formSkillIds.map(id => {
                    const sk = skills.find(s => s.id === id);
                    return sk ? (
                      <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--color-success-dim)]/40 text-[var(--color-success)] font-medium text-xs select-none">
                        {sk.name}
                        <button 
                          type="button" 
                          onClick={() => toggleSkillBinding(id)}
                          className="hover:text-red-500 font-bold ml-0.5 cursor-pointer"
                        >
                          ×
                        </button>
                      </span>
                    ) : null;
                  })}
                  {formSkillIds.length === 0 && (
                    <span className="text-[11px] text-[var(--color-text-muted)] italic self-center pl-1">未绑定任何技能</span>
                  )}
                </div>

                <button 
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSkillDropdownOpen(!skillDropdownOpen);
                    setMcpDropdownOpen(false);
                  }}
                  className="mt-1.5 text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] font-medium flex items-center gap-0.5 cursor-pointer"
                >
                  [+] 绑定 Skills 技能
                </button>

                {skillDropdownOpen && (
                  <div className="absolute left-0 bottom-8 w-full max-h-[180px] overflow-y-auto border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-lg rounded-lg z-50 p-1 animate-fade-in select-none">
                    {skills.filter(sk => !formSkillIds.includes(sk.id)).map(sk => (
                      <div 
                        key={sk.id} 
                        onClick={() => toggleSkillBinding(sk.id)}
                        className="px-3 py-1.5 text-xs rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] cursor-pointer"
                      >
                        {sk.name}
                      </div>
                    ))}
                    {skills.filter(sk => !formSkillIds.includes(sk.id)).length === 0 && (
                      <div className="text-center py-3 text-xs text-[var(--color-text-muted)] italic">没有更多可用技能</div>
                    )}
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
                取消
              </button>
              <button 
                type="submit" 
                className="btn btn-primary cursor-pointer"
              >
                保存配置
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Click outside to close selectors */}
      {(mcpDropdownOpen || skillDropdownOpen) && (
        <div 
          className="fixed inset-0 z-40 bg-transparent" 
          onClick={() => {
            setMcpDropdownOpen(false);
            setSkillDropdownOpen(false);
          }}
        />
      )}
    </div>
  );
}
