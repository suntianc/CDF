// 08.2 P3 C1-04 / F-01: /goal 系统气泡（4-state machine）。
// Redesigned as a premium floating bar that floats over the message viewport.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGoalJudgeStatus, type JudgeStatus } from '@/hooks/useGoalJudge';
import { Target, CheckCircle2, PauseCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GoalSystemBubbleProps {
  sessionId: string;
}

function formatHMSTime(seconds: number): string {
  if (seconds < 0 || !Number.isFinite(seconds)) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const WORKING_STATUSES: ReadonlySet<JudgeStatus> = new Set([
  'idle',
  'judging',
  'unsatisfied',
]);

interface BubbleStateConfig {
  icon: React.ComponentType<any>;
  iconColor: string;
  borderColor: string;
  bgColor: string;
  glowColor: string;
  label: string;
  copy: (goal: string, iteration: number, elapsed: number, reason: string | undefined) => string;
  pulse: boolean;
  spinningIcon?: boolean;
}

const BUBBLE_STATES: Record<Exclude<JudgeStatus, undefined>, BubbleStateConfig> = {
  idle: {
    icon: Target,
    iconColor: 'text-[var(--color-accent)]',
    borderColor: 'border-[var(--color-accent)]/30',
    bgColor: 'bg-[var(--color-accent-dim)]/5',
    glowColor: 'shadow-[var(--color-accent)]/5',
    label: 'working',
    copy: (goal, iteration, elapsed) =>
      `目标：${goal} | 工作中 (${formatHMSTime(elapsed)}) | 轮次：${iteration}/20`,
    pulse: true,
  },
  judging: {
    icon: Loader2,
    iconColor: 'text-[var(--color-accent)]',
    borderColor: 'border-[var(--color-accent)]/45',
    bgColor: 'bg-[var(--color-accent-dim)]/10',
    glowColor: 'shadow-[var(--color-accent)]/10',
    label: 'working',
    copy: (goal, iteration, elapsed) =>
      `目标：${goal} | 正在进行判定中... (${formatHMSTime(elapsed)}) | 轮次：${iteration}/20`,
    pulse: true,
    spinningIcon: true,
  },
  unsatisfied: {
    icon: Target,
    iconColor: 'text-[var(--color-accent)]',
    borderColor: 'border-[var(--color-accent)]/30',
    bgColor: 'bg-[var(--color-accent-dim)]/5',
    glowColor: 'shadow-[var(--color-accent)]/5',
    label: 'working',
    copy: (goal, iteration, elapsed) =>
      `目标：${goal} | 工作中 (${formatHMSTime(elapsed)}) | 轮次：${iteration}/20`,
    pulse: true,
  },
  satisfied: {
    icon: CheckCircle2,
    iconColor: 'text-[var(--color-success)]',
    borderColor: 'border-[var(--color-success)]/30',
    bgColor: 'bg-[var(--color-success-dim)]/5',
    glowColor: 'shadow-[var(--color-success)]/5',
    label: 'satisfied',
    copy: (goal, _iteration, elapsed) =>
      `达成目标：${goal} (总耗时 ${formatHMSTime(elapsed)})`,
    pulse: false,
  },
  paused: {
    icon: PauseCircle,
    iconColor: 'text-[var(--color-warning)]',
    borderColor: 'border-[var(--color-warning)]/30',
    bgColor: 'bg-[var(--color-warning-dim)]/5',
    glowColor: 'shadow-[var(--color-warning)]/5',
    label: 'paused',
    copy: (goal) =>
      `已暂停：${goal} (轮次已用尽 20/20)。输入「/goal clear」或继续对话清除目标。`,
    pulse: false,
  },
  failed: {
    icon: AlertTriangle,
    iconColor: 'text-[var(--color-danger)]',
    borderColor: 'border-[var(--color-danger)]/30',
    bgColor: 'bg-[var(--color-danger-dim)]/5',
    glowColor: 'shadow-[var(--color-danger)]/5',
    label: 'failed',
    copy: (goal, _iteration, _elapsed, reason) =>
      `判定失败：${reason ?? '未知原因'} (目标: ${goal})。可输入「/goal clear」重试。`,
    pulse: false,
  },
};

export function GoalSystemBubble({ sessionId }: GoalSystemBubbleProps) {
  const { t } = useTranslation();
  const { status, iteration, startedAt, reason, goal } = useGoalJudgeStatus(sessionId);

  const state = status ? BUBBLE_STATES[status] : null;
  const isWorking = status ? WORKING_STATUSES.has(status) : false;
  const [tickElapsed, setTickElapsed] = useState<number>(() =>
    startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0
  );

  useEffect(() => {
    if (!isWorking) {
      setTickElapsed(startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0);
      return undefined;
    }
    setTickElapsed(startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0);
    const id = setInterval(() => {
      setTickElapsed(startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0);
    }, 1000);
    return () => clearInterval(id);
  }, [isWorking, startedAt]);

  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mql.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  if (!status || !goal || !state) {
    return null;
  }

  const animatePulse = state.pulse && !prefersReducedMotion;
  const copy = state.copy(goal, iteration, tickElapsed, reason);
  const labelText = t(`goal.label.${state.label}`);
  const IconComponent = state.icon;

  return (
    <div
      data-testid="goal-system-bubble"
      role="status"
      aria-live="polite"
      className={cn(
        "absolute top-3 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-32px)] max-w-[760px]",
        "backdrop-blur-md bg-[var(--color-bg-surface)]/85",
        "border rounded-xl shadow-md p-3 transition-all duration-300 ease-in-out flex flex-col gap-1.5 select-none",
        state.borderColor,
        state.bgColor,
        animatePulse && "animate-pulse shadow-sm",
        state.glowColor
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn(
          "flex items-center justify-center p-1.5 rounded-lg bg-[var(--color-bg-hover)] shrink-0",
          state.iconColor,
          state.spinningIcon && "animate-spin"
        )}>
          <IconComponent className="size-4" />
        </div>
        <span className="flex-1 text-xs font-semibold text-[var(--color-text-primary)] leading-normal truncate">
          {copy}
        </span>
        <span
          className={cn(
            "text-[9px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full shrink-0 border border-current",
            state.iconColor
          )}
        >
          {labelText}
        </span>
      </div>
    </div>
  );
}

export default GoalSystemBubble;
