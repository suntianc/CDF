import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { GitBranch } from 'lucide-react';
import type { WorkflowNodeRunStatus } from '../../../../shared/types';

interface ConditionNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  conditionExpression?: string;
  conditionTrueLabel?: string;
  conditionFalseLabel?: string;
  status?: WorkflowNodeRunStatus;
}

type ConditionFlowNode = Node<ConditionNodeData, 'condition'>;

const statusStyles: Record<string, { border: string; glow: string; dot: string }> = {
  pending: { border: 'var(--border)', glow: 'none', dot: 'bg-[var(--color-text-muted)]' },
  running: { border: '#ec4899', glow: '0 0 12px rgba(236, 72, 153, 0.3)', dot: 'bg-[#ec4899] animate-pulse' },
  completed: { border: 'var(--color-success)', glow: 'none', dot: 'bg-[var(--color-success)]' },
  failed: { border: 'var(--color-danger)', glow: 'none', dot: 'bg-[var(--color-danger)]' },
};

export const ConditionNode = memo(function ConditionNode({ data, selected }: NodeProps<ConditionFlowNode>) {
  const status = data.status || 'pending';
  const style = statusStyles[status] || statusStyles.pending;

  return (
    <div
      className="rounded-lg border-2 bg-[var(--color-bg-surface)] min-w-[160px] max-w-[220px] shadow-md transition-all"
      style={{
        borderColor: selected ? 'var(--color-accent)' : style.border,
        boxShadow: selected ? '0 0 0 2px var(--color-accent-dim)' : style.glow,
      }}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3" />

      <div className="px-3 py-2 border-b border-[var(--color-border)]/30 flex items-center gap-2">
        <div className="w-6 h-6 rounded flex items-center justify-center shrink-0 bg-[#ec4899]/10">
          <GitBranch className="w-3.5 h-3.5 text-[#ec4899]" />
        </div>
        <div className="text-sm font-semibold text-[var(--color-text-primary)] truncate flex-1">
          {data.label || '条件判断'}
        </div>
        <div className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
      </div>

      {data.conditionExpression && (
        <div className="px-3 py-1.5 text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-bg-active)]/50 truncate">
          {data.conditionExpression}
        </div>
      )}

      <div className="flex justify-between px-3 py-1.5 text-[10px] text-[var(--color-text-muted)]">
        <span className="text-[var(--color-success)]">{data.conditionTrueLabel || 'True'}</span>
        <span className="text-[var(--color-danger)]">{data.conditionFalseLabel || 'False'}</span>
      </div>

      {/* True output (right) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        className="w-3 h-3 !bg-[var(--color-success)]"
        style={{ left: '30%' }}
      />
      {/* False output (left) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        className="w-3 h-3 !bg-[var(--color-danger)]"
        style={{ left: '70%' }}
      />
    </div>
  );
});
