import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Play, CheckCircle2, Clock, XCircle, Circle } from 'lucide-react';
import type { ProjectedStage } from './workflowRunProjection';

type StageFlowNode = Node<ProjectedStage, 'stage'>;

const statusStyles = {
  waiting: {
    border: 'border-dashed border-[var(--color-border)]',
    bg: 'bg-[var(--color-bg-canvas)]',
    text: 'text-[var(--color-text-muted)]',
    icon: <Circle className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />,
  },
  active: {
    border: 'border-solid border-[var(--color-accent)] shadow-[0_0_8px_var(--color-accent-dim)] animate-pulse',
    bg: 'bg-[var(--color-bg-surface)]',
    text: 'text-[var(--color-text-primary)]',
    icon: <Play className="w-3.5 h-3.5 text-[var(--color-accent)] fill-[var(--color-accent)]" />,
  },
  waiting_gate: {
    border: 'border-solid border-[var(--color-warning)] shadow-[0_0_8px_var(--color-warning-dim)]',
    bg: 'bg-[var(--color-bg-surface)]',
    text: 'text-[var(--color-text-primary)]',
    icon: <Clock className="w-3.5 h-3.5 text-[var(--color-warning)]" />,
  },
  passed: {
    border: 'border-solid border-[var(--color-success)]',
    bg: 'bg-[var(--color-bg-surface)]',
    text: 'text-[var(--color-text-secondary)]',
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-success)]" />,
  },
  aborted: {
    border: 'border-solid border-[var(--color-danger)]',
    bg: 'bg-[var(--color-bg-surface)]',
    text: 'text-[var(--color-text-muted)]',
    icon: <XCircle className="w-3.5 h-3.5 text-[var(--color-danger)]" />,
  },
  failed: {
    border: 'border-solid border-[var(--color-danger)]',
    bg: 'bg-[var(--color-bg-surface)]',
    text: 'text-[var(--color-danger)]',
    icon: <XCircle className="w-3.5 h-3.5 text-[var(--color-danger)]" />,
  },
};

export const StageNode = memo(function StageNode({ data, selected }: Pick<NodeProps<StageFlowNode>, 'data' | 'selected'>) {
  const { t } = useTranslation();
  const style = statusStyles[data.status] || statusStyles.waiting;

  return (
    <div
      className={`relative flex flex-col gap-1 px-3 py-2 w-[180px] rounded-[var(--radius-sm)] border text-left cursor-pointer select-none transition-all ${
        style.border
      } ${style.bg} ${
        selected ? 'ring-2 ring-[var(--color-accent)] ring-offset-2' : ''
      }`}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      
      <div className="flex items-center justify-between gap-1.5">
        <span className="text-[10px] font-mono tracking-wider uppercase text-[var(--color-text-muted)] tabular-nums">
          {t('workflow.runView.stageLabel')}
        </span>
        {style.icon}
      </div>

      <div className={`text-xs font-semibold truncate ${style.text}`}>
        {data.name}
      </div>

      <div className="text-[10px] text-[var(--color-text-muted)] truncate">
        {data.taskDescription || t('workflow.runView.noDescription')}
      </div>

      <Handle type="source" position={Position.Right} className="opacity-0" />
    </div>
  );
});
