import { ArrowLeft, Save, Play, Square, Loader2, Undo2, Redo2, History } from 'lucide-react';
import { useFlowStore } from '../../stores/flowStore';
import type { Node, Edge } from '@xyflow/react';

interface WorkflowToolbarProps {
  workflowName: string;
  onWorkflowNameChange: (name: string) => void;
  onBack: () => void;
  onSave: () => void;
  onRun: () => void;
  onStop: () => void;
  onHistoryToggle: () => void;
  isSaving: boolean;
  isRunning: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Top toolbar for workflow editor.
 * Extracted from WorkflowEditor.tsx to reduce file size.
 */
export function WorkflowToolbar({
  workflowName, onWorkflowNameChange, onBack, onSave, onRun, onStop, onHistoryToggle,
  isSaving, isRunning, onUndo, onRedo, canUndo, canRedo,
}: WorkflowToolbarProps) {
  return (
    <div className="main-topbar shrink-0 h-12 border-b border-[var(--color-border)]/50 px-4 !pl-36 flex justify-between items-center">
      <div className="main-topbar-left">
        <button onClick={onBack} className="topbar-btn cursor-pointer">
          <ArrowLeft className="w-4 h-4" />
          <span>返回</span>
        </button>
        <input
          className="bg-transparent text-sm font-semibold text-[var(--color-text-primary)] outline-none border-b border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-accent)] transition-colors px-1 py-0.5 w-[200px]"
          value={workflowName}
          onChange={(e) => onWorkflowNameChange(e.target.value)}
        />
      </div>
      <div className="topbar-actions">
        <button
          className="topbar-btn cursor-pointer opacity-60 hover:opacity-100 disabled:opacity-30"
          onClick={onUndo}
          disabled={!canUndo}
          title="撤销 (Ctrl+Z)"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          className="topbar-btn cursor-pointer opacity-60 hover:opacity-100 disabled:opacity-30"
          onClick={onRedo}
          disabled={!canRedo}
          title="重做 (Ctrl+Y)"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
        <button
          className="topbar-btn cursor-pointer"
          onClick={onHistoryToggle}
          title="历史执行记录"
        >
          <History className="w-3.5 h-3.5" />
          <span>历史</span>
        </button>
        <button
          className="btn btn-secondary btn-sm cursor-pointer animate-none"
          onClick={onSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          <span>保存</span>
        </button>
        {isRunning ? (
          <button className="btn btn-danger btn-sm cursor-pointer" onClick={onStop}>
            <Square className="w-3.5 h-3.5" />
            <span>停止</span>
          </button>
        ) : (
          <button className="btn btn-primary btn-sm cursor-pointer" onClick={onRun}>
            <Play className="w-3.5 h-3.5" />
            <span>运行</span>
          </button>
        )}
      </div>
    </div>
  );
}
