import { X, CheckCircle, XCircle, Loader } from 'lucide-react';

interface Task {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'success' | 'failed';
}

interface TaskPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TaskPanel({ isOpen, onClose }: TaskPanelProps) {
  // Placeholder tasks for Phase 1
  const tasks: Task[] = [
    { id: '1', name: '准备开发环境', status: 'success' },
    { id: '2', name: '配置 TypeScript', status: 'running' },
    { id: '3', name: '安装依赖', status: 'idle' },
  ];

  const statusIcon = (status: Task['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-[var(--color-success)]" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-[var(--color-danger)]" />;
      case 'running':
        return <Loader className="w-4 h-4 animate-spin text-[var(--color-accent)]" />;
      default:
        return <div className="w-4 h-4 rounded-full border-2 border-[var(--color-border)]" />;
    }
  };

  return (
    <aside
      className={`
        h-full bg-[var(--color-bg-sidebar)] border-l border-[var(--color-border)]
        flex flex-col transition-all duration-300 ease-in-out relative shrink-0
        ${isOpen ? 'w-[340px] opacity-100' : 'w-0 opacity-0 overflow-hidden border-l-0 pointer-events-none'}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] h-[57px] shrink-0">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">任务展板</span>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4 text-[var(--color-text-secondary)]" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 overflow-y-auto">
        <div className="space-y-3">
          {tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-3">
              {statusIcon(task.status)}
              <span className="text-sm text-[var(--color-text-primary)]">{task.name}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
