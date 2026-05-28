import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Variable, Shuffle } from 'lucide-react';
import type { WorkflowNodeRunStatus } from '../../../../shared/types';

interface DataNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  variableName?: string;
  variableValue?: string;
  transformExpression?: string;
  status?: WorkflowNodeRunStatus;
}

type DataFlowNode = Node<DataNodeData, 'variable' | 'transform'>;

const statusStyles: Record<string, { border: string; glow: string; dot: string }> = {
  pending: { border: 'var(--border)', glow: 'none', dot: 'bg-[var(--color-text-muted)]' },
  running: { border: '#10b981', glow: '0 0 12px rgba(16, 185, 129, 0.3)', dot: 'bg-[#10b981] animate-pulse' },
  completed: { border: 'var(--color-success)', glow: 'none', dot: 'bg-[var(--color-success)]' },
  failed: { border: 'var(--color-danger)', glow: 'none', dot: 'bg-[var(--color-danger)]' },
};

export const DataNode = memo(function DataNode({ data, selected }: NodeProps<DataFlowNode>) {
  const status = data.status || 'pending';
  const style = statusStyles[status] || statusStyles.pending;
  const isTransform = data.transformExpression !== undefined;

  return (
    <div
      className="rounded-lg border-2 bg-[var(--color-bg-surface)] min-w-[150px] max-w-[200px] shadow-md transition-all"
      style={{
        borderColor: selected ? 'var(--color-accent)' : style.border,
        boxShadow: selected ? '0 0 0 2px var(--color-accent-dim)' : style.glow,
      }}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3" />

      <div className="px-3 py-2 border-b border-[var(--color-border)]/30 flex items-center gap-2">
        <div className="w-6 h-6 rounded flex items-center justify-center shrink-0" style={{ background: isTransform ? '#f97316' + '1a' : '#10b981' + '1a' }}>
          {isTransform
            ? <Shuffle className="w-3.5 h-3.5 text-[#f97316]" />
            : <Variable className="w-3.5 h-3.5 text-[#10b981]" />}
        </div>
        <div className="text-sm font-semibold text-[var(--color-text-primary)] truncate flex-1">
          {data.label || (isTransform ? '数据转换' : '变量')}
        </div>
        <div className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
      </div>

      {data.variableName && (
        <div className="px-3 py-1.5 text-[10px] font-mono text-[var(--color-text-muted)]">
          {data.variableName} = {data.variableValue ?? '...'}
        </div>
      )}

      {data.transformExpression && (
        <div className="px-3 py-1.5 text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-bg-active)]/50 truncate">
          {data.transformExpression}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
});
