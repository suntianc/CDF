import { useState, useEffect } from 'react';
import { Drawer } from 'vaul';
import { useAgentStore } from '../../stores/agentStore';
import { useProjectStore } from '../../stores/projectStore';
import { Bot, Layers, Code, ShieldCheck, Trash2, PlayCircle, Repeat2, List } from 'lucide-react';
import { CustomSelect } from '../ui/CustomSelect';

interface NodeConfigDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  node: {
    id: string;
    type?: string;
    data: {
      label: string;
      description?: string;
      taskDescription?: string;
      workspace?: string;
      workArea?: string;
      loopCount?: number;
      reviewSpec?: string;
      reviewRules?: string;
      agentId?: string;
      failureStrategy?: 'retry' | 'skip' | 'stop';
      retryCount?: number;
      bgColor?: string;
      taskGoal?: string;
      dataSource?: string;
      itemPrompt?: string;
    };
  } | null;
  onUpdateNode: (nodeId: string, data: Record<string, unknown>) => void;
  onDeleteNode?: (nodeId: string) => void;
}

const colorPresets = [
  { name: '默认', value: '', class: 'bg-[var(--color-bg-surface)] border border-[var(--color-border)]' },
  { name: '蓝色', value: 'rgba(59, 130, 246, 0.12)', class: 'bg-[#3b82f6]' },
  { name: '绿色', value: 'rgba(34, 197, 94, 0.12)', class: 'bg-[#10b981]' },
  { name: '红色', value: 'rgba(239, 68, 68, 0.12)', class: 'bg-[#ef4444]' },
  { name: '紫色', value: 'rgba(139, 92, 246, 0.12)', class: 'bg-[#8b5cf6]' },
  { name: '黄色', value: 'rgba(245, 158, 11, 0.12)', class: 'bg-[#f59e0b]' },
];

function getFolderName(path?: string): string {
  if (!path) return '';
  const trimmed = path.replace(/[/\\]+$/, '');
  const lastIdx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (lastIdx === -1) return trimmed;
  return trimmed.slice(lastIdx + 1);
}

export function NodeConfigDrawer({ isOpen, onClose, node, onUpdateNode, onDeleteNode }: NodeConfigDrawerProps) {
  const { agents, fetchAgents } = useAgentStore();
  const { currentProjectId } = useProjectStore();

  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [workArea, setWorkArea] = useState('');
  const [loopCount, setLoopCount] = useState(3);
  const [reviewSpec, setReviewSpec] = useState('');
  const [reviewRules, setReviewRules] = useState('');
  const [agentId, setAgentId] = useState('');
  const [failureStrategy, setFailureStrategy] = useState<'retry' | 'skip' | 'stop'>('stop');
  const [retryCount, setRetryCount] = useState(3);
  const [taskGoal, setTaskGoal] = useState('');
  const [bgColor, setBgColor] = useState('');
  const [dataSource, setDataSource] = useState('');
  const [itemPrompt, setItemPrompt] = useState('');

  const handleSelectWorkspace = async () => {
    try {
      const path = await window.electronAPI.db.selectDirectory();
      if (path) {
        setWorkspace(path);
      }
    } catch (err) {
      console.error('Failed to select directory:', err);
    }
  };

  useEffect(() => {
    if (currentProjectId) {
      fetchAgents(currentProjectId);
    }
  }, [currentProjectId, fetchAgents]);

  useEffect(() => {
    if (node) {
      setLabel(node.data.label || '');
      setDescription(node.data.description || '');
      setTaskDescription(node.data.taskDescription || node.data.description || '');
      setWorkspace(node.data.workspace || '');
      setWorkArea(node.data.workArea || '');
      setLoopCount(node.data.loopCount ?? 3);
      setReviewSpec(node.data.reviewSpec || '');
      setReviewRules(node.data.reviewRules || '');
      setAgentId(node.data.agentId || '');
      setFailureStrategy(node.data.failureStrategy || 'stop');
      setRetryCount(node.data.retryCount ?? 3);
      setTaskGoal(node.data.taskGoal || '');
      setBgColor(node.data.bgColor || '');
      setDataSource(node.data.dataSource || '');
      setItemPrompt(node.data.itemPrompt || '');
    }
  }, [node]);

  const selectedAgent = agents.find((a) => a.id === agentId);
  const nodeType = node?.type || 'task';
  const isStartNode = nodeType === 'start';
  const isLoopNode = nodeType === 'loop';
  const isForeachNode = nodeType === 'foreach';
  const isReviewNode = nodeType === 'review';
  const isTaskNode = nodeType === 'task' || nodeType === 'agent';
  const needsAgent = isTaskNode || isLoopNode || isReviewNode || isForeachNode;
  const titleIcon = isStartNode ? <PlayCircle className="w-5 h-5 text-[var(--color-success)]" />
    : isLoopNode ? <Repeat2 className="w-5 h-5 text-[var(--color-info)]" />
      : isForeachNode ? <Layers className="w-5 h-5 text-[var(--color-success)]" />
        : isReviewNode ? <ShieldCheck className="w-5 h-5 text-[var(--color-warning)]" />
          : <Bot className="w-5 h-5 text-[var(--color-accent)]" />;

  const handleSave = () => {
    if (!node) return;
    onUpdateNode(node.id, {
      label,
      description,
      taskDescription,
      workspace,
      workArea: '',
      loopCount,
      reviewSpec,
      reviewRules,
      agentId,
      failureStrategy,
      retryCount,
      taskGoal,
      bgColor,
      dataSource,
      itemPrompt,
    });
    onClose();
  };

  const handleClose = () => {
    handleSave();
    onClose();
  };

  return (
    <Drawer.Root open={isOpen} onOpenChange={(open) => !open && handleClose()} direction="right">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Drawer.Content
          className="fixed right-0 top-0 bottom-0 w-[400px] bg-[var(--color-bg-surface)] border-l border-[var(--color-border)] z-50 flex flex-col"
          aria-label="节点配置"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] shrink-0">
            <Drawer.Title className="text-base font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
              {titleIcon}
              节点配置
            </Drawer.Title>
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
              <label className="form-label">节点背景颜色</label>
              <div className="flex gap-2.5 items-center mt-2">
                {colorPresets.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    title={preset.name}
                    className={`w-6 h-6 rounded-full cursor-pointer transition-all duration-150 relative ${preset.class} ${
                      bgColor === preset.value
                        ? 'ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg-surface)] scale-110'
                        : 'hover:scale-105'
                    }`}
                    onClick={() => setBgColor(preset.value)}
                  >
                    {bgColor === preset.value && (
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white font-bold">
                        ✓
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {isStartNode && (
              <>
                <div className="rounded-lg border border-[var(--color-success)]/20 bg-[var(--color-success-dim)]/20 p-3 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
                  开始节点用于定义本次工作流的工作区。手动执行和 Master 调度都会把这里的工作区配置放进起始上下文。
                </div>
                <div className="form-group">
                  <label className="form-label">工作区路径</label>
                  <div className="flex gap-2">
                    <input
                      className="form-input flex-1 cursor-pointer"
                      readOnly
                      onClick={handleSelectWorkspace}
                      value={workspace ? getFolderName(workspace) : ''}
                      placeholder="点击选择工作文件夹"
                      title={workspace}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary px-3 cursor-pointer shrink-0"
                      onClick={handleSelectWorkspace}
                    >
                      选择
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">任务目标</label>
                  <textarea
                    className="form-input min-h-[120px] resize-none py-2"
                    value={taskGoal}
                    onChange={(e) => setTaskGoal(e.target.value)}
                    placeholder="请描述任务目标"
                  />
                </div>
              </>
            )}

            {(isTaskNode || isLoopNode || isForeachNode) && (
              <div className="form-group">
                <label className="form-label">任务描述</label>
                <textarea
                  className="form-input min-h-[100px] resize-none py-2"
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                  placeholder="描述该节点要完成的具体任务"
                />
              </div>
            )}

            {isForeachNode && (
              <>
                <div className="form-group">
                  <label className="form-label">数据源文件 (JSON)</label>
                  <input
                    className="form-input"
                    value={dataSource}
                    onChange={(e) => setDataSource(e.target.value)}
                    placeholder="例如: data/tasks/train.json"
                  />
                  <p className="mt-1 text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                    相对于工作目录的 JSON 文件路径，文件内容须为 JSON 数组。For-Each 节点会对数组中的每个元素执行一次 Agent。
                  </p>
                </div>
                <div className="form-group">
                  <label className="form-label">提示词模板 (可选)</label>
                  <textarea
                    className="form-input min-h-[80px] resize-none py-2"
                    value={itemPrompt}
                    onChange={(e) => setItemPrompt(e.target.value)}
                    placeholder="留空则自动 JSON.stringify 当前项。支持 {item} 占位符。"
                  />
                  <p className="mt-1 text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                    使用 {'{item}'} 作为当前数据项的占位符。例如: "请完成以下任务：{'{item}'}"
                  </p>
                </div>
              </>
            )}

            {isLoopNode && (
              <div className="form-group">
                <label className="form-label">循环次数</label>
                <input
                  type="number"
                  className="form-input"
                  value={loopCount}
                  onChange={(e) => setLoopCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                  min={1}
                  max={50}
                />
              </div>
            )}

            {isReviewNode && (
              <>
                <div className="form-group">
                  <label className="form-label">规范</label>
                  <textarea
                    className="form-input min-h-[100px] resize-none py-2"
                    value={reviewSpec}
                    onChange={(e) => setReviewSpec(e.target.value)}
                    placeholder="填写审查标准、验收规范或判断依据"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">条件规则</label>
                  <textarea
                    className="form-input min-h-[110px] resize-none py-2"
                    value={reviewRules}
                    onChange={(e) => setReviewRules(e.target.value)}
                    placeholder="例如：通过=质量分 >= 80；返工=质量分 < 80"
                  />
                </div>
              </>
            )}


            {needsAgent && (
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
            )}


            {needsAgent && <div className="form-group">
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
            </div>}

            {needsAgent && failureStrategy === 'retry' && (
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
          <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-[var(--color-border)] shrink-0">
            <button
              className="btn btn-danger cursor-pointer"
              onClick={() => node && onDeleteNode?.(node.id)}
              disabled={!node || !onDeleteNode || isStartNode}
            >
              <Trash2 className="w-4 h-4" />
              删除节点
            </button>
            <div className="flex justify-end gap-2">
              <button className="btn btn-primary cursor-pointer" onClick={handleClose}>
                关闭
              </button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
