interface ExecutionPanelProps {
  executionId: string;
  onClose: () => void;
}

export function ExecutionPanel({ executionId, onClose }: ExecutionPanelProps) {
  return (
    <div className="w-[300px] bg-[var(--color-bg-sidebar)] border-l border-[var(--color-border)]/50 p-4 flex flex-col shrink-0">
      <div className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">执行面板</div>
      <div className="text-xs text-[var(--color-text-muted)]">执行中...</div>
      <button className="btn btn-secondary btn-sm mt-auto cursor-pointer" onClick={onClose}>
        关闭
      </button>
    </div>
  );
}
