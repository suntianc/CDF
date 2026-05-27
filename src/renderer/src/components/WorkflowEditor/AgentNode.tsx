import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Bot } from 'lucide-react';
import type { WorkflowNodeRunStatus } from '../../../../shared/types';

interface AgentNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
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
        <div className="w-6 h-6 rounded bg-[var(--color-accent-dim)] flex items-center justify-center shrink-0">
          <Bot className="w-3.5 h-3.5 text-[var(--color-accent)]" />
        </div>
        <div className="text-sm font-semibold text-[var(--color-text-primary)] truncate flex-1">
          {data.label || 'Agent 节点'}
        </div>
        <div className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
      </div>

      {data.description && (
        <div className="px-3 py-1.5 text-[11px] text-[var(--color-text-secondary)] line-clamp-2">
          {data.description}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
}
