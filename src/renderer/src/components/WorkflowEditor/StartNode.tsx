import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';

type StartFlowNode = Node<{ label: string }, 'start'>;

export function StartNode({ data }: NodeProps<StartFlowNode>) {
  return (
    <div
      className="rounded-xl border-2 border-[var(--color-success)] bg-[var(--color-bg-surface)] px-6 py-3 min-w-[100px] text-center shadow-md"
      style={{ borderColor: '#22c55e' }}
    >
      <div className="text-sm font-semibold text-[var(--color-text-primary)]">
        {data.label || '开始'}
      </div>
      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
}
