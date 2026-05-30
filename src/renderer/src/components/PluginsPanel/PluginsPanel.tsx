import { useState, useEffect } from 'react';
import { useSkillStore } from '../../stores/skillStore';
import { useMcpServerStore } from '../../stores/mcpServerStore';
import { useProjectStore } from '../../stores/projectStore';
import { MCPServer } from '../../../../shared/types';
import {
  Trash2, X, Code, Layers, RefreshCw, Loader2, Search, FolderInput, Plus, Edit2
} from 'lucide-react';
import { CustomSelect } from '../ui/CustomSelect';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export function PluginsPanel() {
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
    <div className="flex-1 flex flex-col h-full bg-[var(--bg-app)] overflow-hidden">
      {/* Top Header */}
      <div className="main-topbar shrink-0 h-9 border-b-0" />

      {/* 内置二级 Tab 导航栏 */}
      <div className="px-6 py-2 flex items-center justify-start bg-[var(--color-bg-sidebar)]/20 shrink-0">
        <div className="flex items-center bg-[var(--color-bg-sidebar)] border border-[var(--color-border)] p-0.5 rounded-lg select-none">
          <button 
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
              activeTab === 'skills' 
                ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]' 
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
            onClick={() => setActiveTab('skills')}
          >
            Skills 技能管理
          </button>
          <button 
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
              activeTab === 'mcp' 
                ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]' 
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
            onClick={() => setActiveTab('mcp')}
          >
            MCP 服务器配置
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
  const { skills, fetchSkills, deleteSkill } = useSkillStore();
  const { currentProjectId } = useProjectStore();

  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!currentProjectId) return;
    fetchSkills(currentProjectId);
  }, [currentProjectId]);

  const handleImportSkillDirectory = async () => {
    try {
      const dirPath = await window.electronAPI.db.selectDirectory();
      if (!dirPath) return;
      await window.electronAPI.db.importSkillDirectory(dirPath);
      if (currentProjectId) await fetchSkills(currentProjectId);
      showToast('Skill 目录导入成功', 'success');
    } catch (e: any) {
      showToast(e.message || '导入 Skill 目录失败', 'error');
    }
  };

  const handleDeleteSkill = async (id: string, name: string) => {
    if (confirm(`确定要删除 Skill 「${name}」吗？`)) {
      try {
        await deleteSkill(currentProjectId || 'default-project', id);
        showToast(`✓ Skill ${name} 已成功删除`, 'success');
      } catch (err) {
        showToast('删除 Skill 失败', 'error');
      }
    }
  };

  const filteredSkills = skills.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.description || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col px-6 pb-6 pt-3 overflow-y-auto">
      <div className="flex justify-between items-center mb-3 shrink-0">
        <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
          Skills 技能列表 ({skills.length})
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-[var(--color-bg-sidebar)]/80 border border-[var(--color-border)]/50 px-2.5 py-1.5 rounded-lg w-[200px] no-drag">
            <Search className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
            <input
              type="text"
              placeholder="搜索 Skill 名称..."
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
            <span>导入 Skill 目录</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredSkills.map((skill) => (
          <div key={skill.id} className="provider-card p-5 border border-[var(--color-border)] hover:border-[var(--color-accent)]/50 rounded-xl bg-[var(--color-bg-surface)] shadow-sm hover:shadow-md transition-all flex flex-col justify-between group">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Code className="w-4 h-4 text-[var(--color-success)] shrink-0 group-hover:scale-110 transition-transform" />
                <div className="font-semibold text-sm text-[var(--color-text-primary)] truncate flex-1" title={skill.name}>{skill.name}</div>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-1 line-clamp-2" title={skill.description}>
                {skill.description || '暂无说明'}
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--color-border)]/30 pt-3 mt-2.5">
              <button
                className="btn btn-danger btn-sm flex items-center gap-1 cursor-pointer hover:scale-105 active:scale-95 transition-all"
                onClick={() => handleDeleteSkill(skill.id, skill.name)}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>删除</span>
              </button>
            </div>
          </div>
        ))}

        {filteredSkills.length === 0 && (
          <div className="col-span-full text-center py-16 bg-[var(--color-bg-surface)] border border-[var(--color-border)] border-dashed rounded-xl text-sm text-[var(--color-text-muted)]">
            {searchQuery ? '没有找到符合搜索条件的 Skill' : '暂无 Skills，请点击「导入 Skill 目录」或手动将 Skill 目录放置到 .cdf/skills/ 目录下'}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== MCP TAB ====================
function McpTab({ showToast }: { showToast: (msg: string, type?: Toast['type']) => void }) {
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
      showToast('服务器标识名称不能为空', 'error');
      return;
    }

    const id = editingServerId || window.crypto.randomUUID();
    let configPayload: Record<string, unknown> = {};

    if (formType === 'http') {
      if (!formUrl.trim()) {
        showToast('HTTP URL 地址不能为空', 'error');
        return;
      }
      configPayload = { url: formUrl };
    } else {
      if (!formCommand.trim()) {
        showToast('启动命令 (Command) 不能为空', 'error');
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
      showToast(`✓ MCP 服务器「${formName}」已保存`, 'success');
      setIsModalOpen(false);
    } catch (err) {
      showToast('保存 MCP 服务器失败', 'error');
    }
  };

  const handleDeleteMcp = async (id: string, name: string) => {
    if (confirm(`确定要删除 MCP 服务器「${name}」吗？`)) {
      try {
        await deleteMcpServer(id);
        showToast(`✓ MCP 服务器 ${name} 已成功删除`, 'success');
      } catch (err) {
        showToast('删除 MCP 失败', 'error');
      }
    }
  };

  const testHealth = async (id: string, name: string) => {
    setTestingId(id);
    showToast(`正在对 ${name} 执行健康状态探测...`, 'info');
    try {
      const res = await checkMcpHealth(id);
      if (res.ok) {
        showToast(`✓ MCP 服务器 ${name} 连接正常，检查通过！`, 'success');
      } else {
        showToast(`✗ MCP 服务器 ${name} 连通失败：${res.message || '超时或无响应'}`, 'error');
      }
    } catch (err: any) {
      showToast(`✗ 健康检查请求异常: ${err.message}`, 'error');
    } finally {
      setTestingId(null);
    }
  };

  const toggleConnectionState = async (server: MCPServer) => {
    const nextState = !server.is_connected;
    try {
      await toggleMcpConnection(server.id, nextState);
      showToast(`✓ 已${nextState ? '连接启用' : '断开卸载'} MCP「${server.name}」`, 'success');
    } catch (err) {
      showToast('切换连接状态失败', 'error');
    }
  };

  return (
    <div className="h-full flex flex-col px-6 pb-6 pt-3 overflow-y-auto">
      <div className="flex justify-between items-center mb-3 shrink-0">
        <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
          MCP 注册服务器列表 ({mcpServers.length})
        </div>
        <div className="flex items-center gap-2">
          {/* Search box */}
          <div className="flex items-center gap-2 bg-[var(--color-bg-sidebar)]/80 border border-[var(--color-border)]/50 px-2.5 py-1.5 rounded-lg w-[200px] no-drag">
            <Search className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
            <input 
              type="text" 
              placeholder="搜索 MCP 服务器..." 
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
            <span>添加 MCP 服务器</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {mcpServers.filter(s => 
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.server_type || '').toLowerCase().includes(searchQuery.toLowerCase())
        ).map((server) => {
          const config = server.config || {};
          return (
            <div key={server.id} className="provider-card p-5 border border-[var(--color-border)] hover:border-[var(--color-accent)]/50 rounded-xl bg-[var(--color-bg-surface)] shadow-sm hover:shadow-md transition-all flex flex-col justify-between group">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 max-w-[70%]">
                    <Layers className="w-4 h-4 text-[var(--color-accent)] shrink-0 group-hover:scale-110 transition-transform" />
                    <div className="font-semibold text-sm text-[var(--color-text-primary)] truncate" title={server.name}>
                      {server.name}
                    </div>
                  </div>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                    (server.server_type === 'sse' || server.server_type === 'http')
                      ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent)] border-[var(--color-accent)]/10'
                      : 'bg-[var(--color-info-dim)] text-[var(--color-info)] border-[var(--color-info)]/10'
                  } uppercase scale-95 shrink-0`}>
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
                    检测时间：{server.last_health_check ? new Date(server.last_health_check).toLocaleTimeString() : '无记录'}
                  </span>
                  
                  {/* Status Indicator Badge */}
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 border ${
                    server.is_connected 
                      ? 'bg-[var(--color-success-dim)] text-[var(--color-success)] border-[var(--color-success)]/10' 
                      : 'bg-[var(--color-danger-dim)] text-[var(--color-danger)] border-[var(--color-danger)]/10'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${server.is_connected ? 'bg-[var(--color-success)] animate-pulse' : 'bg-[var(--color-danger)]'}`} />
                    <span>{server.is_connected ? '在线/活跃' : '离线/断开'}</span>
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-[var(--color-border)]/30 pt-3 mt-2 gap-2">
                <button
                  onClick={() => toggleConnectionState(server)}
                  className={`btn btn-sm cursor-pointer hover:scale-105 active:scale-95 transition-all ${
                    server.is_connected 
                      ? 'btn-secondary text-[var(--color-text-muted)]' 
                      : 'btn-secondary text-[var(--color-success)] border-[var(--color-success)]/30 hover:bg-[var(--color-success-dim)]'
                  }`}
                >
                  {server.is_connected ? '断开' : '激活'}
                </button>

                <div className="flex gap-1.5 ml-auto">
                  {/* Health Check Button */}
                  <button
                    className="btn btn-secondary btn-sm p-1.5 hover:scale-105 active:scale-95 transition-all"
                    onClick={() => testHealth(server.id, server.name)}
                    disabled={testingId === server.id}
                    title="探针健康检测"
                  >
                    {testingId === server.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <button 
                    className="btn btn-secondary btn-sm p-1.5 hover:scale-105 active:scale-95 transition-all"
                    onClick={() => openEditModal(server)}
                    title="编辑配置"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  <button 
                    className="btn btn-danger btn-sm p-1.5 hover:scale-105 active:scale-95 transition-all"
                    onClick={() => handleDeleteMcp(server.id, server.name)}
                    title="删除服务"
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
          <div className="col-span-full text-center py-16 bg-[var(--color-bg-surface)] border border-[var(--color-border)] border-dashed rounded-xl text-sm text-[var(--color-text-muted)]">
            {searchQuery ? '没有找到符合搜索条件的 MCP 服务器' : '暂无已配置的 MCP 服务器，点击上方「添加 MCP 服务器」增加扩展服务连接！'}
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
                <span>{editingServerId ? `配置 MCP · ${formName}` : '添加 MCP 工具服务器'}</span>
              </span>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer"
                aria-label="关闭弹窗"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveMcp} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="form-label">标识名称 <span className="text-[var(--color-danger)]">*</span></label>
                  <input 
                    className="form-input" 
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="如：filesystem / postgres"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">连接协议类型</label>
                  <CustomSelect
                    value={formType}
                    onChange={(val) => setFormType(val as 'stdio' | 'http')}
                    options={[
                      { value: 'stdio', label: 'Stdio (本地命令行)' },
                      { value: 'http', label: 'HTTP (远程 Streamable HTTP)' }
                    ]}
                  />
                </div>
              </div>

              {formType === 'http' ? (
                <div className="form-group">
                  <label className="form-label">HTTP URL <span className="text-[var(--color-danger)]">*</span></label>
                  <input
                    className="form-input"
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    placeholder="http://localhost:3000/mcp"
                    required
                  />
                  <div className="form-hint">远程 MCP 服务器暴露的 Streamable HTTP 连接端点（兼容 SSE 回退）</div>
                </div>
              ) : (
                <>
                  <div className="form-group">
                    <label className="form-label">启动可执行命令 (Command) <span className="text-[var(--color-danger)]">*</span></label>
                    <input 
                      className="form-input" 
                      value={formCommand}
                      onChange={(e) => setFormCommand(e.target.value)}
                      placeholder="如：node / python3 / npx"
                      required
                    />
                    <div className="form-hint">本地运行 MCP 服务程序时启动的可执行文件名或全局命令</div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">启动附加参数 (Arguments) - 按行拆分</label>
                    <textarea 
                      className="form-input min-h-[90px] font-mono text-xs resize-none py-2" 
                      value={formArgsInput}
                      onChange={(e) => setFormArgsInput(e.target.value)}
                      placeholder="例如输入两行：&#10;/path/to/mcp/index.js&#10;--writable"
                    />
                    <div className="form-hint">传入命令的参数，每行为一个独立参数，能够自动安全保留空格。</div>
                  </div>
                </>
              )}

              <div className="modal-actions border-t border-[var(--color-border)] pt-4 mt-6">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)}
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
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
