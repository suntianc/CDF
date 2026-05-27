import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';

type EndFlowNode = Node<{ label: string }, 'end'>;

export function EndNode({ data }: NodeProps<EndFlowNode>) {
  return (
    <div
      className="rounded-xl border-2 border-[var(--color-danger)] bg-[var(--color-bg-surface)] px-6 py-3 min-w-[100px] text-center shadow-md"
      style={{ borderColor: '#ef4444' }}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3" />
      <div className="text-sm font-semibold text-[var(--color-text-primary)]">
        {data.label || '结束'}
      </div>
    </div>
  );
}
