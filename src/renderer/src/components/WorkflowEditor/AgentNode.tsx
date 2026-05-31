import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Bot, ListTodo, Repeat2, ShieldCheck, Layers } from 'lucide-react';
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
  bgColor?: string;
}

type AgentFlowNode = Node<AgentNodeData, 'agent'>;

const statusStyles: Record<string, { border: string; glow: string; dot: string }> = {
  pending: { border: 'var(--border)', glow: 'none', dot: 'bg-[var(--color-text-muted)]' },
  running: { border: 'var(--color-info)', glow: '0 0 12px var(--color-info-dim)', dot: 'bg-[var(--color-info)] animate-pulse' },
  completed: { border: 'var(--color-success)', glow: 'none', dot: 'bg-[var(--color-success)]' },
  failed: { border: 'var(--color-danger)', glow: 'none', dot: 'bg-[var(--color-danger)]' },
  skipped: { border: 'var(--color-warning)', glow: 'none', dot: 'bg-[var(--color-warning)]' },
};

// Stable icon constants to avoid creating new JSX on each render (memo best practice)
const LOOP_ICON = <Repeat2 className="w-3.5 h-3.5 text-[var(--color-info)]" />;
const REVIEW_ICON = <ShieldCheck className="w-3.5 h-3.5 text-[var(--color-warning)]" />;
const TASK_ICON = <ListTodo className="w-3.5 h-3.5 text-[var(--color-accent)]" />;
const FOREACH_ICON = <Layers className="w-3.5 h-3.5 text-[var(--color-success)]" />;

export const AgentNode = memo(function AgentNode({ data, selected }: NodeProps<AgentFlowNode>) {
  const status = data.status || 'pending';
  const style = statusStyles[status] || statusStyles.pending;
  const kind = data.nodeKind || 'task';
  const config = kind === 'loop'
    ? { title: data.label || 'Loop 节点', badge: 'Loop', icon: LOOP_ICON, bg: 'var(--color-info-dim)' }
    : kind === 'review'
      ? { title: data.label || '审查节点', badge: 'Review', icon: REVIEW_ICON, bg: 'var(--color-warning-dim)' }
      : kind === 'foreach'
        ? { title: data.label || 'For-Each 节点', badge: 'For-Each', icon: FOREACH_ICON, bg: 'var(--color-success-dim)' }
        : { title: data.label || '普通任务节点', badge: 'Task', icon: TASK_ICON, bg: 'var(--color-accent-dim)' };
  const rawSummary = kind === 'review'
    ? data.reviewSpec
    : data.taskDescription || data.description;
  const cleanSummary = rawSummary
    ? rawSummary.replace(/\s+/g, ' ').trim()
    : '';
  const maxLength = 35;
  const summary = cleanSummary.length > maxLength
    ? cleanSummary.slice(0, maxLength) + '...'
    : cleanSummary;

  return (
    <div
      className="rounded-lg border-2 w-[210px] shadow-md transition-[border-color,box-shadow,background-color] duration-150 relative"
      style={{
        borderColor: selected ? 'var(--color-info)' : style.border,
        boxShadow: selected ? '0 0 0 2px var(--color-info-dim)' : style.glow,
        background: data.bgColor
          ? `linear-gradient(${data.bgColor}, ${data.bgColor}), var(--color-bg-surface)`
          : 'var(--color-bg-surface)',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: 10,
          height: 10,
          backgroundColor: data.bgColor || 'var(--color-bg-surface)',
          border: `2px solid ${selected ? 'var(--color-info)' : style.border}`,
          borderRadius: '50%',
          left: -5,
          top: '20px',
          transform: 'translateY(-50%)',
        }}
        className="cursor-crosshair"
      />

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

      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 10,
          height: 10,
          backgroundColor: data.bgColor || 'var(--color-bg-surface)',
          border: `2px solid ${selected ? 'var(--color-info)' : style.border}`,
          borderRadius: '50%',
          right: -5,
          top: '20px',
          transform: 'translateY(-50%)',
        }}
        className="cursor-crosshair"
      />
    </div>
  );
});
