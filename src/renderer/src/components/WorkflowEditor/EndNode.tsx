import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

type EndFlowNode = Node<{ label: string; bgColor?: string }, 'end'>;

export function EndNode({ data, selected }: NodeProps<EndFlowNode>) {
  const { t } = useTranslation();

  return (
    <div
      className="rounded-xl border-2 px-6 py-3 w-[150px] text-center shadow-md relative transition-[border-color,box-shadow,background-color] duration-150"
      style={{
        borderColor: selected ? 'var(--color-info)' : '#ef4444',
        boxShadow: selected ? '0 0 0 2px var(--color-info-dim)' : 'none',
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
          border: `2px solid ${selected ? 'var(--color-info)' : '#ef4444'}`,
          borderRadius: '50%',
          left: -5,
          top: '50%',
          transform: 'translateY(-50%)',
        }}
        className="cursor-crosshair"
      />
      <div className="text-sm font-semibold text-[var(--color-text-primary)]">
        {data.label || t('workflow.nodeTypes.end.label')}
      </div>
    </div>
  );
}
