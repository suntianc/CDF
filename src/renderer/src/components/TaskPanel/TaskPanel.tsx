import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Loader } from 'lucide-react';

interface Task {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'success' | 'failed';
}

interface TaskPanelProps {
  isOpen: boolean;
  onClose: () => void;
  width: number;
  onResize: (width: number) => void;
}

export function TaskPanel({ isOpen, onClose, width, onResize }: TaskPanelProps) {
  const [isResizing, setIsResizing] = useState(false);

  // Placeholder tasks for Phase 1
  const tasks: Task[] = [
    { id: '1', name: '准备开发环境', status: 'success' },
    { id: '2', name: '配置 TypeScript', status: 'running' },
    { id: '3', name: '安装依赖', status: 'idle' },
  ];

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = window.innerWidth - e.clientX;
      // 限制拖拽区间在 280px 到 600px
      const clampedWidth = Math.min(600, Math.max(280, newWidth));
      onResize(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'none';
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.userSelect = '';
      };
    }
    return undefined;
  }, [isResizing, onResize]);

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
        flex flex-col relative shrink-0
        ${isResizing ? '' : 'transition-all duration-300 ease-in-out'}
        ${isOpen ? 'opacity-100' : 'w-0 opacity-0 overflow-hidden border-l-0 pointer-events-none'}
      `}
      style={{ width: isOpen ? width : 0 }}
    >
      {/* Left resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`
          absolute left-[-3px] top-0 bottom-0 w-1.5 cursor-col-resize z-50 bg-transparent hover:bg-[var(--color-accent)]/40 transition-colors duration-150
          ${isResizing ? 'bg-[var(--color-accent)]/80' : ''}
        `}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] h-[57px] shrink-0 select-none">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">任务展板</span>
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
