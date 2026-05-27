import { Workflow } from '../../../../shared/types';

interface WorkflowEditorProps {
  workflow: Workflow;
  onBack: () => void;
}

export function WorkflowEditor({ workflow, onBack }: WorkflowEditorProps) {
  return (
    <div className="flex-1 flex items-center justify-center bg-[var(--bg-app)]">
      <div className="text-[var(--color-text-muted)] text-sm">工作流编辑器加载中...</div>
    </div>
  );
}
