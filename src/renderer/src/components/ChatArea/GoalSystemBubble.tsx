// 08.2 P3 C1-04 / F-01: /goal 系统气泡（4-state machine）。
//
// State machine (UI-SPEC §Surface 1):
//   working (idle / judging / unsatisfied)  → 工作中, ◎, accent, animate-pulse
//   satisfied                                 → 达成, ✅, success
//   paused                                    → 已暂停, ⏸, warning
//   failed                                    → judge 失败, ⚠️, danger
//
// The bubble is **not** a Message row — it's derived state mounted in
// ChatArea near the top of the messages list. The judge hook (useGoalJudge)
// publishes status to useSessionStore.goalJudgeStatus; this component reads
// it via useGoalJudgeStatus (selector subscription) + sessionGoals for the
// goal text. Cross-session isolation: status Map is keyed by sessionId and
// the consumer passes `activeSessionId` (P6 pitfall).

import { useEffect, useState } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useGoalJudgeStatus, type JudgeStatus } from '@/hooks/useGoalJudge';

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

interface BubbleState {
  icon: string;
  colorVar: string;
  borderColor: string;
  label: string;
  copy: (goal: string, iteration: number, elapsed: number, reason: string | undefined) => string;
  pulse: boolean;
}

const BUBBLE_STATES: Record<Exclude<JudgeStatus, undefined>, BubbleState> = {
  idle: {
    icon: '◎',
    colorVar: 'var(--color-accent)',
    borderColor: 'var(--color-accent)',
    label: '工作中',
    copy: (goal, iteration, elapsed) =>
      `◎ 目标：${goal}  状态：工作中  耗时：${formatHMSTime(elapsed)}  轮次：${iteration}/20`,
    pulse: true,
  },
  judging: {
    icon: '◎',
    colorVar: 'var(--color-accent)',
    borderColor: 'var(--color-accent)',
    label: '工作中',
    copy: (goal, iteration, elapsed) =>
      `◎ 目标：${goal}  状态：工作中  耗时：${formatHMSTime(elapsed)}  轮次：${iteration}/20`,
    pulse: true,
  },
  unsatisfied: {
    icon: '◎',
    colorVar: 'var(--color-accent)',
    borderColor: 'var(--color-accent)',
    label: '工作中',
    copy: (goal, iteration, elapsed) =>
      `◎ 目标：${goal}  状态：工作中  耗时：${formatHMSTime(elapsed)}  轮次：${iteration}/20`,
    pulse: true,
  },
  satisfied: {
    icon: '✅',
    colorVar: 'var(--color-success)',
    borderColor: 'var(--color-success)',
    label: '达成',
    copy: (goal, _iteration, elapsed) =>
      `✅ 达成：${goal}  (总耗时 ${formatHMSTime(elapsed)})`,
    pulse: false,
  },
  paused: {
    icon: '⏸',
    colorVar: 'var(--color-warning)',
    borderColor: 'var(--color-warning)',
    label: '已暂停',
    copy: (goal) =>
      `⏸ 已暂停：${goal}  轮次已用尽 (20/20)。输入「/goal clear」或继续对话清除目标。`,
    pulse: false,
  },
  failed: {
    icon: '⚠️',
    colorVar: 'var(--color-danger)',
    borderColor: 'var(--color-danger)',
    label: 'judge 失败',
    copy: (goal, _iteration, _elapsed, reason) =>
      `⚠️ judge 失败：${reason ?? 'unknown'}  (目标: ${goal})。可输入「/goal clear」清除并重试。`,
    pulse: false,
  },
};

export function GoalSystemBubble({ sessionId }: GoalSystemBubbleProps) {
  const { status, iteration, startedAt, reason, goal } = useGoalJudgeStatus(sessionId);
  const goalFromStore = useSessionStore((s) => s.sessionGoals.get(sessionId) ?? '');
  // Use the value from the hook (which is read at hook subscription time and
  // includes the snapshot read) but also fall back to direct store lookup for
  // immediate mount-time correctness.
  const effectiveGoal = goal || goalFromStore;

  // No goal, no bubble
  if (!status || !effectiveGoal) {
    return null;
  }

  const state = BUBBLE_STATES[status];
  // 「工作中」states need a ticking clock; others freeze at the final value.
  const isWorking = WORKING_STATUSES.has(status);
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

  // Respect prefers-reduced-motion — turn off the pulse animation.
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mql.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const animatePulse = state.pulse && !prefersReducedMotion;
  const copy = state.copy(effectiveGoal, iteration, tickElapsed, reason);

  return (
    <div
      data-testid="goal-system-bubble"
      role="status"
      aria-live="polite"
      className={`w-full max-w-[760px] mx-auto my-2 px-3 py-2 rounded-md border-l-4 ${
        animatePulse ? 'animate-pulse' : ''
      }`}
      style={{
        borderLeftColor: state.borderColor,
        backgroundColor: 'var(--color-bg-surface)',
        color: 'var(--color-text-primary)',
      }}
    >
      <div className="flex items-center gap-2 text-sm">
        <span
          className="text-base font-semibold leading-none"
          style={{ color: state.colorVar }}
          aria-hidden
        >
          {state.icon}
        </span>
        <span className="flex-1 leading-relaxed">{copy}</span>
        <span
          className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{
            color: state.colorVar,
            backgroundColor: 'color-mix(in srgb, ' + state.colorVar + ' 15%, transparent)',
          }}
        >
          {state.label}
        </span>
      </div>
    </div>
  );
}
