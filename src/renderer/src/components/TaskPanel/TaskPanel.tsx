import { useState } from 'react';
import { ChevronDown, ChevronUp, X, CheckCircle, XCircle, Loader } from 'lucide-react';

interface Task {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'success' | 'failed';
}

export function TaskPanel() {
  const [visible, setVisible] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

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

  if (!visible) return null;

  return (
    <div
      className={`
        fixed bottom-6 right-6 w-[340px] max-h-[480px]
        bg-[var(--color-bg-sidebar)] border border-[var(--color-border)]
        rounded-xl shadow-lg flex flex-col
        transition-transform duration-200 ease-out
        ${collapsed ? 'h-13' : 'h-auto'}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded-md px-2 py-1 transition-colors"
        >
          {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          <span>任务展板</span>
        </button>
        <button
          onClick={() => setVisible(false)}
          className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-[var(--color-bg-hover)] transition-colors"
        >
          <X className="w-4 h-4 text-[var(--color-text-secondary)]" />
        </button>
      </div>

      {/* Content */}
      {!collapsed && (
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
      )}
    </div>
  );
}
