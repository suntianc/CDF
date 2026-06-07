import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { TodoItem } from '../../../../shared/types';

interface TodoListProps {
  todos: TodoItem[];
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

export function TodoList({ todos, isExpanded, onToggleExpanded }: TodoListProps) {
  const { t } = useTranslation();
  const completedCount = useMemo(() => {
    return todos.filter((t) => t.status === 'completed').length;
  }, [todos]);

  const percentage = useMemo(() => {
    return todos.length ? Math.round((completedCount / todos.length) * 100) : 0;
  }, [todos, completedCount]);

  const getTodoStyles = (status: TodoItem['status']) => {
    switch (status) {
      case 'completed':
        return {
          icon: '✓',
          textClass: 'text-[var(--color-text-muted)] line-through',
          bgClass: 'bg-[var(--color-success-dim)]/10 border-[var(--color-success)]/10',
          iconClass: 'text-[var(--color-success)] font-bold',
        };
      case 'in_progress':
        return {
          icon: '◉',
          textClass: 'text-[var(--color-text-primary)] font-medium',
          bgClass: 'bg-[var(--color-warning-dim)]/10 border-[var(--color-warning)]/10',
          iconClass: 'text-[var(--color-warning)] animate-pulse font-bold',
        };
      default:
        return {
          icon: '○',
          textClass: 'text-[var(--color-text-secondary)]',
          bgClass: 'bg-[var(--color-bg-app)]/20 border-[var(--color-border)]/45',
          iconClass: 'text-[var(--color-text-muted)]',
        };
    }
  };

  return (
    <div 
      className="relative z-0 mx-auto w-full max-w-[720px] rounded-xl border border-[var(--color-border)] p-3 shadow-xl pointer-events-auto mb-[-24px] pb-[32px] overflow-hidden todo-list-glass"
      style={{
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.12)',
      }}
    >
      {/* Header Row */}
      <div 
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={onToggleExpanded}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[var(--color-text-primary)] tracking-wider">
            Todo List
          </span>
          <span className="rounded bg-[var(--color-bg-active)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]">
            {t('todo.completedCount', { completed: completedCount, total: todos.length })}
          </span>
        </div>
        <button 
          type="button" 
          className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
          aria-label={isExpanded ? t('todo.collapse') : t('todo.expand')}
        >
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Progress Bar */}
      <div className="mt-2.5 space-y-1">
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-bg-app)] border border-[var(--color-border)]/40">
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-500 ease-out"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      {/* Collapsible Todo Items List */}
      {isExpanded && (
        <ul className="mt-3.5 space-y-2.5 max-h-48 overflow-y-auto pr-1">
          {todos.map((todo, i) => {
            const styles = getTodoStyles(todo.status);
            return (
              <li
                key={i}
                className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-xs transition-all duration-300 ease-in-out ${styles.bgClass}`}
              >
                <span className={`mt-0.5 text-sm leading-none transition-colors duration-300 select-none ${styles.iconClass}`}>
                  {styles.icon}
                </span>
                <span className={`leading-relaxed break-words flex-1 ${styles.textClass}`}>
                  {todo.content}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
