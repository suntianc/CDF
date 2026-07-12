import type { Workflow } from '../../../../shared/types';
import { StageEditor } from './StageEditor';

interface WorkflowEditorProps {
  workflow: Workflow;
  onBack: () => void;
}

export function WorkflowEditor({ workflow, onBack }: WorkflowEditorProps) {
  return <StageEditor workflow={workflow} onBack={onBack} />;
}
