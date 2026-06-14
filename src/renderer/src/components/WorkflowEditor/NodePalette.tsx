import { ListTodo, Repeat2, ShieldCheck, Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface NodePaletteProps {
  onDragStart: (event: React.DragEvent, nodeType: string) => void;
  onAddNode: (nodeType: string) => void;
}

/**
 * Left node palette — drag nodes onto the canvas, or press Enter/Space to add at center.
 * Extracted from WorkflowEditor.tsx to reduce file size.
 */
export function NodePalette({ onDragStart, onAddNode }: NodePaletteProps) {
  const { t } = useTranslation();

  const handleKeyDown = (e: React.KeyboardEvent, nodeType: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onAddNode(nodeType);
    }
  };

  return (
    <div className="w-[200px] bg-[var(--color-bg-sidebar)] border-r border-[var(--color-border)]/50 p-3 flex flex-col gap-1.5 shrink-0 overflow-y-auto node-palette-container">
      <div className="text-[11px] font-medium text-[var(--color-text-muted)] mb-1">
        {t('workflow.nodePalette.title')}
      </div>

      {/* Flow nodes */}
      <div className="text-[10px] text-[var(--color-text-muted)] mt-1">{t('workflow.nodePalette.flowCategory')}</div>
      {[
        { type: 'start', label: t('workflow.nodeTypes.start.label'), color: 'var(--color-success)', dot: true },
        { type: 'end', label: t('workflow.nodeTypes.end.label'), color: 'var(--color-danger)', dot: true },
      ].map((n) => (
        <div
          key={n.type}
          role="button"
          tabIndex={0}
          aria-label={t('workflow.nodePalette.addNode', { name: n.label })}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] cursor-grab hover:border-[var(--color-accent)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40 transition-colors text-xs text-[var(--color-text-secondary)]"
          onDragStart={(e) => onDragStart(e, n.type)}
          onKeyDown={(e) => handleKeyDown(e, n.type)}
          draggable
        >
          {n.dot ? <div aria-hidden="true" className="w-2 h-2 rounded-full" style={{ background: n.color }} /> : null}
          {n.label}
        </div>
      ))}

      {/* Agent nodes */}
      <div className="text-[10px] text-[var(--color-text-muted)] mt-2">{t('workflow.nodePalette.agentCategory')}</div>
      {[
        { type: 'task', label: t('workflow.nodeTypes.task.label'), icon: ListTodo, color: 'var(--color-accent)' },
        { type: 'loop', label: t('workflow.nodeTypes.loop.label'), icon: Repeat2, color: 'var(--color-info)' },
        { type: 'foreach', label: t('workflow.nodeTypes.foreach.label'), icon: Layers, color: 'var(--color-success)' },
        { type: 'review', label: t('workflow.nodeTypes.review.label'), icon: ShieldCheck, color: 'var(--color-warning)' },
      ].map((n) => (
        <div
          key={n.type}
          role="button"
          tabIndex={0}
          aria-label={t('workflow.nodePalette.addNode', { name: n.label })}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] cursor-grab hover:border-[var(--color-accent)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40 transition-colors text-xs text-[var(--color-text-secondary)]"
          onDragStart={(e) => onDragStart(e, n.type)}
          onKeyDown={(e) => handleKeyDown(e, n.type)}
          draggable
        >
          <n.icon className="w-3.5 h-3.5" aria-hidden="true" style={{ color: n.color }} />
          {n.label}
        </div>
      ))}
    </div>
  );
}
