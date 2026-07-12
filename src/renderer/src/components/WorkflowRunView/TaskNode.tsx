import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Circle, Play, CheckCircle2, XCircle, Ban, Bot } from 'lucide-react';
import type { WorkflowRunTask, WorkflowTaskStatus } from '../../../../shared/types';

interface TaskFlowNodeData extends Record<string, unknown> {
  task: WorkflowRunTask;
}
type TaskFlowNode = Node<TaskFlowNodeData, 'task'>;

const statusStyles: Record<WorkflowTaskStatus, {
  border: string;
  bg: string;
  text: string;
  icon: React.ReactNode;
}> = {
  planned: {
    border: 'border-dashed border-[var(--color-border)]',
    bg: 'bg-[var(--color-bg-canvas)]',
    text: 'text-[var(--color-text-muted)]',
    icon: <Circle className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />,
  },
  in_progress: {
    border: 'border-solid border-[var(--color-accent)] shadow-[0_0_8px_var(--color-accent-dim)] animate-pulse',
    bg: 'bg-[var(--color-bg-surface)]',
    text: 'text-[var(--color-text-primary)]',
    icon: <Play className="w-3.5 h-3.5 text-[var(--color-accent)] fill-[var(--color-accent)]" />,
  },
  completed: {
    border: 'border-solid border-[var(--color-success)]',
    bg: 'bg-[var(--color-bg-surface)]',
    text: 'text-[var(--color-text-secondary)]',
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-success)]" />,
  },
  failed: {
    border: 'border-solid border-[var(--color-danger)]',
    bg: 'bg-[var(--color-bg-surface)]',
    text: 'text-[var(--color-text-primary)]',
    icon: <XCircle className="w-3.5 h-3.5 text-[var(--color-danger)]" />,
  },
  cancelled: {
    border: 'border-solid border-[var(--color-border)]',
    bg: 'bg-[var(--color-bg-canvas)] opacity-60',
    text: 'text-[var(--color-text-muted)]',
    icon: <Ban className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />,
  },
};

export const TaskNode = memo(function TaskNode({ data, selected }: Pick<NodeProps<TaskFlowNode>, 'data' | 'selected'>) {
  const { t } = useTranslation();
  const style = statusStyles[data.task.status] || statusStyles.planned;

  return (
    <div
      className={`relative flex flex-col gap-1 px-3 py-2 w-[220px] rounded-[var(--radius-sm)] border text-left transition-all ${
        style.border
      } ${style.bg} ${
        selected ? 'ring-2 ring-[var(--color-accent)] ring-offset-2' : ''
      }`}
    >
      <Handle type="target" position={Position.Left} className="w-1.5 h-1.5 bg-[var(--color-border)]" />

      <div className="flex items-center justify-between gap-1.5">
        <span className="text-[9px] font-mono tracking-wider uppercase text-[var(--color-text-muted)]">
          {t('workflow.runView.taskLabel')}
        </span>
        {style.icon}
      </div>

      <div className={`text-xs font-semibold truncate ${style.text}`}>
        {data.task.title || t('workflow.runView.noTitle')}
      </div>

      {data.task.description && (
        <div className="text-[10px] text-[var(--color-text-muted)] truncate">
          {data.task.description}
        </div>
      )}

      {data.task.delegation_agent_slug && (
        <div className="mt-1 flex items-center gap-1.5 px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-bg-hover)] border border-[var(--color-border)] w-max">
          <Bot className="w-3 h-3 text-[var(--color-text-muted)]" />
          <span className="text-[9px] font-medium text-[var(--color-text-secondary)] font-mono">
            {data.task.delegation_agent_slug}
          </span>
        </div>
      )}

      <Handle type="source" position={Position.Right} className="w-1.5 h-1.5 bg-[var(--color-border)]" />
    </div>
  );
});
