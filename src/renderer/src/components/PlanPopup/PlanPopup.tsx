import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MarkdownRenderer } from '@/components/ChatArea/MarkdownRenderer';
import { usePlanPopupStore } from '@/stores/planPopupStore';

const MAX_ITERATIONS = 20;

/**
 * 08.2 C-3a: /plan Codex 风格弹窗（Surface 3 of UI-SPEC.md）
 *
 * - 流式 planContent 通过 appendChunk 累积，generating → reviewing 自动切换
 * - 「修改计划」按钮调 startModify；iterationCount === 20 时禁用
 * - 「立即执行」按钮始终可点 → execute() 把"立即执行"作为 user message 发送
 * - 18 / 19 / 20 次分别显示黄/红警告
 */
export function PlanPopup() {
  const isOpen = usePlanPopupStore((s) => s.isOpen);
  const status = usePlanPopupStore((s) => s.status);
  const planContent = usePlanPopupStore((s) => s.planContent);
  const iterationCount = usePlanPopupStore((s) => s.iterationCount);
  const description = usePlanPopupStore((s) => s.description);
  const close = usePlanPopupStore((s) => s.close);
  const startModify = usePlanPopupStore((s) => s.startModify);
  const execute = usePlanPopupStore((s) => s.execute);

  const [modifyOpen, setModifyOpen] = useState(false);
  const [modifyInput, setModifyInput] = useState('');

  const desc = description || '(无描述)';
  const descLabel = desc.length > 60 ? desc.slice(0, 60) + '…' : desc;

  const isCapReached = status === 'cap-reached';
  const showWarning = iterationCount === 18 || iterationCount === 19;
  const showCapReached = iterationCount >= MAX_ITERATIONS;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        data-testid="plan-popup"
        className="max-w-2xl max-h-[80vh] border-t-4 border-t-[var(--color-accent)]"
      >
        <DialogHeader>
          <DialogTitle>📋 计划：{descLabel}</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            第 {iterationCount} 次迭代 · {iterationCount}/{MAX_ITERATIONS} 轮
          </DialogDescription>
        </DialogHeader>

        <div
          className="max-h-[60vh] overflow-y-auto p-4"
          data-testid="plan-popup-content"
        >
          {status === 'generating' ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <MarkdownRenderer text={planContent} />
          )}
        </div>

        {iterationCount >= 1 && (
          <div className="text-xs text-[var(--color-text-muted)] px-4 -mt-2">
            💡 你已修改 {iterationCount} 次。点击「立即执行」会关闭弹窗并把"立即执行"作为新消息发送给 agent。
          </div>
        )}

        {showWarning && (
          <div
            className="text-xs text-[var(--color-warning)] px-4"
            data-testid="plan-popup-warning"
          >
            ⚠️ 剩余 {MAX_ITERATIONS - iterationCount} 次修改机会。
          </div>
        )}

        {showCapReached && (
          <div
            className="text-xs text-[var(--color-danger)] px-4"
            data-testid="plan-popup-cap"
          >
            已用尽 {MAX_ITERATIONS} 次修改。请点击「立即执行」或关闭弹窗。
          </div>
        )}

        {modifyOpen && (
          <div className="px-4 pt-2 flex gap-2">
            <textarea
              data-testid="plan-popup-modify-input"
              className="flex-1 min-h-[60px] rounded-md bg-[var(--color-bg-surface)] border border-[var(--color-border)] p-2 text-sm text-[var(--color-text-primary)] resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              placeholder="输入修改意见，Enter 重新生成计划，Shift+Enter 换行"
              value={modifyInput}
              onChange={(e) => setModifyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  const v = modifyInput.trim();
                  if (!v) return;
                  setModifyInput('');
                  setModifyOpen(false);
                  void startModify(v);
                }
              }}
            />
            <Button
              variant="default"
              onClick={() => {
                const v = modifyInput.trim();
                if (!v) return;
                setModifyInput('');
                setModifyOpen(false);
                void startModify(v);
              }}
            >
              提交
            </Button>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4">
          <Button
            variant="secondary"
            disabled={isCapReached}
            onClick={() => setModifyOpen((v) => !v)}
            data-testid="plan-popup-modify-button"
          >
            修改计划
          </Button>
          <Button
            variant="default"
            onClick={() => void execute()}
            data-testid="plan-popup-execute-button"
          >
            立即执行
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PlanPopup;
