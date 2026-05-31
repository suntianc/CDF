import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';

type StartFlowNode = Node<{ label: string; workspace?: string; workArea?: string; bgColor?: string }, 'start'>;

import { getFolderName } from './utils';

export function StartNode({ data, selected }: NodeProps<StartFlowNode>) {
  const folderName = getFolderName(data.workspace);
  return (
    <div
      className="rounded-xl border-2 px-6 py-3 w-[150px] text-center shadow-md relative transition-[border-color,box-shadow,background-color] duration-150"
      style={{
        borderColor: selected ? 'var(--color-info)' : '#22c55e',
        boxShadow: selected ? '0 0 0 2px var(--color-info-dim)' : 'none',
        background: data.bgColor
          ? `linear-gradient(${data.bgColor}, ${data.bgColor}), var(--color-bg-surface)`
          : 'var(--color-bg-surface)',
      }}
    >
      <div className="text-sm font-semibold text-[var(--color-text-primary)]">
        {data.label || '开始'}
      </div>
      {folderName && (
        <div className="mt-1 max-w-[180px] truncate text-[10px] text-[var(--color-text-muted)]" title={data.workspace}>
          {folderName}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 10,
          height: 10,
          backgroundColor: data.bgColor || 'var(--color-bg-surface)',
          border: `2px solid ${selected ? 'var(--color-info)' : '#22c55e'}`,
          borderRadius: '50%',
          right: -5,
          top: '50%',
          transform: 'translateY(-50%)',
        }}
        className="cursor-crosshair"
      />
    </div>
  );
}
