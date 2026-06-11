import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import type { DelegatedTask } from '../../stores/sessionStore';
import { estimateTokens } from '../../stores/sessionStore';

interface AgentTraceModalProps {
  open: boolean;
  onClose: () => void;
  task: DelegatedTask | null;
}

function AgentTraceModal({ open, onClose, task }: AgentTraceModalProps) {
  if (!task) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-2xl">
          {/* Content is empty when no task; Dialog handles open/close */}
        </DialogContent>
      </Dialog>
    );
  }

  const totalText = task.chunks.join('');
  const tokenEstimate = estimateTokens(totalText);
  const tokenDisplay = tokenEstimate > 1000 ? `${(tokenEstimate / 1000).toFixed(1)}k` : `${tokenEstimate}`;
  const isRunning = task.status === 'running';
  const isFailure = task.status === 'failure';
  const hasChunks = task.chunks.length > 0;

  const statusLabel = isRunning ? '运行中' : isFailure ? '失败' : '已完成';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{task.agentName} 执行轨迹</DialogTitle>
          <DialogDescription>
            {tokenDisplay} tokens · {statusLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] overflow-y-auto space-y-3">
          {/* Work Goal */}
          <div>
            <div className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-1">
              工作目标
            </div>
            <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
              {task.goal || '（未设定目标）'}
            </p>
          </div>

          {/* Failure Alert */}
          {isFailure && (
            <div className="bg-[var(--color-danger-dim)]/10 border border-[var(--color-danger)]/20 rounded-md p-2 text-xs text-[var(--color-danger)] space-y-1">
              <div>
                <span className="font-semibold">错误码:</span> {task.errorCode || 'UNKNOWN'}
              </div>
              {task.result?.error?.message && (
                <div className="opacity-90 text-[11px] leading-relaxed">{task.result.error.message}</div>
              )}
            </div>
          )}

          {/* Execution Log */}
          <div>
            <div className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-1">
              执行日志
            </div>
            {(!hasChunks && !isRunning) ? (
              <div className="rounded-md bg-[var(--color-bg-app)] border border-[var(--color-border)] p-3 text-[var(--color-text-muted)] text-xs">
                该 Agent 尚无执行日志
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed font-mono text-[var(--color-text-primary)] bg-[var(--color-bg-app)] rounded-md p-3 border border-[var(--color-border)] max-h-[50vh] overflow-y-auto">
                {hasChunks ? totalText : ''}
                {isRunning && <span className="inline-block w-1.5 h-3 ml-0.5 bg-[var(--color-accent)] animate-pulse align-middle">{'▋'}</span>}
              </pre>
            )}
          </div>

          {/* Stats Bar */}
          <div className="text-[10px] text-[var(--color-text-muted)] border-t border-[var(--color-border)]/40 pt-2">
            {task.chunks.length} 个文本块 · {tokenDisplay} tokens 估算
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { AgentTraceModal };
