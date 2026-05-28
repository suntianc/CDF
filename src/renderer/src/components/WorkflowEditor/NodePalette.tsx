import { ListTodo, Repeat2, ShieldCheck } from 'lucide-react';

interface NodePaletteProps {
  onDragStart: (event: React.DragEvent, nodeType: string) => void;
}

/**
 * Left node palette — drag nodes onto the canvas.
 * Extracted from WorkflowEditor.tsx to reduce file size.
 */
export function NodePalette({ onDragStart }: NodePaletteProps) {
  return (
    <div className="w-[200px] bg-[var(--color-bg-sidebar)] border-r border-[var(--color-border)]/50 p-3 flex flex-col gap-1.5 shrink-0 overflow-y-auto">
      <div className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
        节点面板
      </div>

      {/* Flow nodes */}
      <div className="text-[10px] text-[var(--color-text-muted)] mt-1">流程控制</div>
      {[
        { type: 'start', label: '开始', color: 'var(--color-success)', dot: true },
        { type: 'end', label: '结束', color: 'var(--color-danger)', dot: true },
      ].map((n) => (
        <div key={n.type} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] cursor-grab hover:border-[var(--color-accent)]/50 transition-colors text-xs text-[var(--color-text-secondary)]"
          onDragStart={(e) => onDragStart(e, n.type)} draggable>
          {n.dot ? <div className="w-2 h-2 rounded-full" style={{ background: n.color }} /> : null}
          {n.label}
        </div>
      ))}

      {/* Agent nodes */}
      <div className="text-[10px] text-[var(--color-text-muted)] mt-2">Agent 节点</div>
      {[
        { type: 'task', label: '任务节点', icon: ListTodo, color: 'var(--color-accent)' },
        { type: 'loop', label: 'Loop 节点', icon: Repeat2, color: 'var(--color-info)' },
        { type: 'review', label: '审查节点', icon: ShieldCheck, color: 'var(--color-warning)' },
      ].map((n) => (
        <div key={n.type} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] cursor-grab hover:border-[var(--color-accent)]/50 transition-colors text-xs text-[var(--color-text-secondary)]"
          onDragStart={(e) => onDragStart(e, n.type)} draggable>
          <n.icon className="w-3.5 h-3.5" style={{ color: n.color }} />
          {n.label}
        </div>
      ))}
    </div>
  );
}
