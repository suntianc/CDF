import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Bot, ListTodo, Repeat2, ShieldCheck } from 'lucide-react';
import type { WorkflowNodeRunStatus } from '../../../../shared/types';

interface AgentNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  taskDescription?: string;
  loopCount?: number;
  reviewSpec?: string;
  nodeKind?: string;
  agentId?: string;
  status?: WorkflowNodeRunStatus;
}

type AgentFlowNode = Node<AgentNodeData, 'agent'>;

const statusStyles: Record<string, { border: string; glow: string; dot: string }> = {
  pending: { border: 'var(--border)', glow: 'none', dot: 'bg-[var(--color-text-muted)]' },
  running: { border: 'var(--color-info)', glow: '0 0 12px var(--color-info-dim)', dot: 'bg-[var(--color-info)] animate-pulse' },
  completed: { border: 'var(--color-success)', glow: 'none', dot: 'bg-[var(--color-success)]' },
  failed: { border: 'var(--color-danger)', glow: 'none', dot: 'bg-[var(--color-danger)]' },
  skipped: { border: 'var(--color-warning)', glow: 'none', dot: 'bg-[var(--color-warning)]' },
};

export function AgentNode({ data, selected }: NodeProps<AgentFlowNode>) {
  const status = data.status || 'pending';
  const style = statusStyles[status] || statusStyles.pending;
  const kind = data.nodeKind || 'task';
  const config = kind === 'loop'
    ? { title: data.label || 'Loop 节点', badge: 'Loop', icon: <Repeat2 className="w-3.5 h-3.5 text-[var(--color-info)]" />, bg: 'var(--color-info-dim)' }
    : kind === 'review'
      ? { title: data.label || '审查节点', badge: 'Review', icon: <ShieldCheck className="w-3.5 h-3.5 text-[var(--color-warning)]" />, bg: 'var(--color-warning-dim)' }
      : { title: data.label || '普通任务节点', badge: 'Task', icon: <ListTodo className="w-3.5 h-3.5 text-[var(--color-accent)]" />, bg: 'var(--color-accent-dim)' };
  const summary = kind === 'review'
    ? data.reviewSpec
    : data.taskDescription || data.description;

  return (
    <div
      className="rounded-lg border-2 bg-[var(--color-bg-surface)] min-w-[180px] max-w-[240px] shadow-md transition-all"
      style={{
        borderColor: selected ? 'var(--color-accent)' : style.border,
        boxShadow: selected ? '0 0 0 2px var(--color-accent-dim)' : style.glow,
      }}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3" />

      <div className="px-3 py-2 border-b border-[var(--color-border)]/30 flex items-center gap-2">
        <div className="w-6 h-6 rounded flex items-center justify-center shrink-0" style={{ background: config.bg }}>
          {config.icon}
        </div>
        <div className="text-sm font-semibold text-[var(--color-text-primary)] truncate flex-1">
          {config.title}
        </div>
        <div className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
      </div>

      <div className="px-3 py-1.5 flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
        <Bot className="w-3 h-3" />
        <span>{config.badge}</span>
        {kind === 'loop' && <span>× {data.loopCount ?? 1}</span>}
      </div>

      {summary && (
        <div className="px-3 pb-2 text-[11px] text-[var(--color-text-secondary)] line-clamp-2">
          {summary}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
}
