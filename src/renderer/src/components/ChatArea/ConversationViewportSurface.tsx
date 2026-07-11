import type { RefObject, UIEventHandler } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ShieldAlert, X } from 'lucide-react';
import type { AgentApprovalRequest, Message } from '@shared/types';
import type { DelegatedTask, ParallelWorker, SessionError } from '../../stores/sessionStore';
import { ToolGroupCard, translateToolAction } from './ToolMessageCard';
import { MessageItem, formatHMSTime } from './MessageItem';
import { GoalSystemBubble } from './GoalSystemBubble';
import { SubagentView } from './SubagentView';
import type { ConversationTimelineItem } from './conversationTimeline/conversationTimeline';

type ConversationViewportSurfaceProps = {
  activeSessionId: string | null;
  timelineItems: ConversationTimelineItem[];
  messages: Message[];
  isStreaming: boolean;
  hasActiveGoal: boolean;
  viewingTask: DelegatedTask | null;
  viewingWorkerData: ParallelWorker | null;
  error: SessionError | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
  onOpenTaskPanel?: () => void;
  onBackFromSubagent: () => void;
  onBackFromParallelWorker: () => void;
  onClearError: () => void;
};

const FoldedBlockCard = ({ duration, items }: { duration: number; items: any[] }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const headerText = t('chat.processedDuration', { duration: formatHMSTime(duration) });

  return (
    <div className="mb-2.5 flex flex-col transition-all duration-200 w-full animate-slide-down">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 cursor-pointer select-none text-[12px] text-[var(--color-text-secondary)] font-medium hover:text-[var(--color-text-primary)] transition-colors w-fit py-0.5"
      >
        <span aria-hidden="true" className="text-xs">{expanded ? '▼' : '▶'}</span>
        <span>{headerText}</span>
      </button>

      {expanded && (
        <div className="mt-2 ml-1.5 pl-3 border-l border-[var(--color-border)]/80 flex flex-col gap-3">
          {items.map((item) => {
            if (item.type === 'tool_group') {
              return <ToolGroupCard key={item.id} tools={item.tools} />;
            }
            if (item.type === 'message' && item.message) {
              return (
                <MessageItem
                  key={item.id}
                  message={item.message}
                  isLast={false}
                  isStreaming={false}
                />
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
};

const PendingApprovalCard = ({ approval, onOpenTaskPanel }: { approval: AgentApprovalRequest; onOpenTaskPanel?: () => void }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const actions = approval.actions || [];

  return (
    <div className="w-full py-1 select-none animate-slide-down">
      <div className="flex flex-col rounded-[var(--radius-md)] border border-[var(--color-warning)]/25 bg-[var(--color-warning-dim)] shadow-[inset_3px_0_0_var(--color-warning)]">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-xs font-medium text-[var(--color-warning)] transition-colors hover:bg-[var(--color-warning)]/5 focus-visible:outline-2 focus-visible:outline-[var(--color-warning)]"
        >
          <span aria-hidden="true" className="flex items-center justify-center shrink-0">
            <ShieldAlert className="w-3.5 h-3.5 text-[var(--color-warning)]" />
          </span>

          <span className="font-semibold tracking-wide">
            {t('chat.awaitingApproval')}{actions.map((act: any) => translateToolAction(act.name, act.args, t)).join(', ')}
          </span>

          <span aria-hidden="true" className="text-xs opacity-60 font-mono ml-0.5">
            {expanded ? '▼' : '▶'}
          </span>
        </button>

        {expanded && (
          <div className="px-4 pb-3 flex flex-col gap-3 animate-slide-down">
            {actions.map((action: any, idx: number) => (
              <div key={idx} className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--color-warning)]">
                  {t('chat.pendingExecute', { name: action.name })}
                </span>
                {action.args && (
                  <pre className="p-2 bg-[var(--color-bg-sunken)] border border-[var(--color-border)] rounded text-xs font-mono text-[var(--color-text-secondary)] overflow-x-auto select-text max-h-40 overflow-y-auto leading-relaxed">
                    <code>{typeof action.args === 'string' ? action.args : JSON.stringify(action.args, null, 2)}</code>
                  </pre>
                )}
              </div>
            ))}
            <button
              onClick={onOpenTaskPanel}
              className="mt-1 min-h-8 px-3 py-1.5 bg-[var(--color-warning)] hover:bg-[var(--color-warning)]/90 text-[var(--color-text-inverse)] rounded-[var(--radius-sm)] text-xs font-semibold w-fit transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span>{t('chat.goApproveNow')}</span>
              <span>➔</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export function ConversationViewportSurface({
  activeSessionId,
  timelineItems,
  messages,
  isStreaming,
  hasActiveGoal,
  viewingTask,
  viewingWorkerData,
  error,
  scrollContainerRef,
  onScroll,
  onOpenTaskPanel,
  onBackFromSubagent,
  onBackFromParallelWorker,
  onClearError,
}: ConversationViewportSurfaceProps) {
  const { t } = useTranslation();

  if (viewingTask) {
    return <SubagentView task={viewingTask} onBack={onBackFromSubagent} />;
  }

  if (viewingWorkerData) {
    return <SubagentView task={viewingWorkerData} onBack={onBackFromParallelWorker} />;
  }

  return (
    <>
      {activeSessionId && <GoalSystemBubble sessionId={activeSessionId} />}

      <div
        ref={scrollContainerRef}
        onScroll={onScroll}
        className="messages absolute inset-0 overflow-y-auto"
        style={{
          paddingBottom: '180px',
          paddingTop: hasActiveGoal ? '64px' : '0px',
        }}
      >
        {timelineItems.map((item, idx) => {
          if (item.type === 'pending_approval_block') {
            return (
              <PendingApprovalCard
                key={item.id}
                approval={item.approval}
                onOpenTaskPanel={onOpenTaskPanel}
              />
            );
          }
          if (item.type === 'folded_block') {
            return (
              <FoldedBlockCard
                key={item.id}
                duration={item.duration}
                items={item.foldedItems}
              />
            );
          }
          if (item.type === 'tool_group') {
            return <ToolGroupCard key={item.id} tools={item.tools} />;
          }
          if (item.type === 'message' && item.message) {
            return (
              <MessageItem
                key={item.id}
                message={item.message}
                isLast={idx === timelineItems.length - 1}
                isStreaming={isStreaming}
              />
            );
          }
          return null;
        })}

        {isStreaming && messages.length > 0 && messages[messages.length - 1].content === '' && (
          <div className="message assistant" role="status" aria-label={t('chat.generating')}>
            <div className="message-row">
              <div className="flex items-center gap-1 py-1.5" aria-hidden="true">
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-pulse" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-pulse" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-pulse" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div role="alert" aria-live="assertive" className="p-3 bg-[var(--color-danger-dim)] border border-[var(--color-danger)]/20 rounded-xl flex items-start gap-2.5 text-xs text-[var(--color-danger)] shadow-sm animate-shake">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <div>{t(error.message, { defaultValue: error.message, ...(error.messageParams ?? {}) })}</div>
              {error.recoverableActions && error.recoverableActions.length > 0 && (
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {error.recoverableActions.map((a) => (
                    <button key={a.label} type="button" onClick={() => { a.action(); onClearError(); }} className="text-[var(--color-danger)] underline underline-offset-2 hover:no-underline font-medium cursor-pointer">
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClearError}
              className="p-0.5 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-danger)]"
              aria-label="Dismiss error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
