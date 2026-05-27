import { useState, useEffect } from 'react';
import { Drawer } from 'vaul';
import { useAgentStore } from '../../stores/agentStore';
import { useProjectStore } from '../../stores/projectStore';
import { X, Bot, Layers, Code, ShieldCheck } from 'lucide-react';
import { CustomSelect } from '../ui/CustomSelect';

interface NodeConfigDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  node: {
    id: string;
    data: {
      label: string;
      description?: string;
      agentId?: string;
      failureStrategy?: 'retry' | 'skip' | 'stop';
      retryCount?: number;
    };
  } | null;
  onUpdateNode: (nodeId: string, data: Record<string, unknown>) => void;
}

export function NodeConfigDrawer({ isOpen, onClose, node, onUpdateNode }: NodeConfigDrawerProps) {
  const { agents, fetchAgents } = useAgentStore();
  const { currentProjectId } = useProjectStore();

  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [agentId, setAgentId] = useState('');
  const [failureStrategy, setFailureStrategy] = useState<'retry' | 'skip' | 'stop'>('stop');
  const [retryCount, setRetryCount] = useState(3);

  useEffect(() => {
    if (currentProjectId) {
      fetchAgents(currentProjectId);
    }
  }, [currentProjectId, fetchAgents]);

  useEffect(() => {
    if (node) {
      setLabel(node.data.label || '');
      setDescription(node.data.description || '');
      setAgentId(node.data.agentId || '');
      setFailureStrategy(node.data.failureStrategy || 'stop');
      setRetryCount(node.data.retryCount ?? 3);
    }
  }, [node]);

  const selectedAgent = agents.find((a) => a.id === agentId);

  const handleSave = () => {
    if (!node) return;
    onUpdateNode(node.id, {
      label,
      description,
      agentId,
      failureStrategy,
      retryCount,
    });
    onClose();
  };

  return (
    <Drawer.Root open={isOpen} onOpenChange={(open) => !open && onClose()} direction="right">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Drawer.Content
          className="fixed right-0 top-0 bottom-0 w-[400px] bg-[var(--color-bg-surface)] border-l border-[var(--color-border)] z-50 flex flex-col"
          aria-label="节点配置"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] shrink-0">
            <Drawer.Title className="text-base font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
              <Bot className="w-5 h-5 text-[var(--color-accent)]" />
              节点配置
            </Drawer.Title>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div className="form-group">
              <label className="form-label">节点名称</label>
              <input
                className="form-input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="输入节点名称"
              />
            </div>

            <div className="form-group">
              <label className="form-label">描述</label>
              <textarea
                className="form-input min-h-[80px] resize-none py-2"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="简述该节点的功能..."
              />
            </div>

            <div className="form-group">
              <label className="form-label">选择 Agent</label>
              <CustomSelect
                value={agentId}
                onChange={(val) => setAgentId(val)}
                options={[
                  { value: '', label: '不绑定 Agent (清除选择)' },
                  ...agents.map((agent) => ({ value: agent.id, label: agent.name }))
                ]}
                placeholder="请选择 Agent"
              />
            </div>

            {/* Agent Info Summary (read-only) */}
            {selectedAgent && (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sidebar)]/30 p-3 space-y-2">
                <div className="text-xs font-semibold text-[var(--color-text-primary)] flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[var(--color-success)]" />
                  Agent 信息摘要（只读）
                </div>
                <div className="text-[11px] text-[var(--color-text-secondary)] space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Bot className="w-3 h-3" />
                    <span>{selectedAgent.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Layers className="w-3 h-3" />
                    <span>{selectedAgent.mcpServerIds?.length || 0} 个 MCP 绑定</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Code className="w-3 h-3" />
                    <span>{selectedAgent.skillNames?.length || 0} 个 Skills 绑定</span>
                  </div>
                </div>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">失败策略</label>
              <CustomSelect
                value={failureStrategy}
                onChange={(val) => setFailureStrategy(val as 'retry' | 'skip' | 'stop')}
                options={[
                  { value: 'retry', label: '重试' },
                  { value: 'skip', label: '跳过并继续' },
                  { value: 'stop', label: '停止并汇报 Master Agent' },
                ]}
              />
            </div>

            {failureStrategy === 'retry' && (
              <div className="form-group">
                <label className="form-label">重试次数</label>
                <input
                  type="number"
                  className="form-input"
                  value={retryCount}
                  onChange={(e) => setRetryCount(Math.max(1, parseInt(e.target.value) || 1))}
                  min={1}
                  max={10}
                />
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--color-border)] shrink-0">
            <button className="btn btn-secondary cursor-pointer" onClick={onClose}>
              取消
            </button>
            <button className="btn btn-primary cursor-pointer" onClick={handleSave}>
              保存
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
