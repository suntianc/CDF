// 08.2 P3 C1-04: GoalSystemBubble RTL tests.
//
// The component reads from useGoalJudgeStatus and useSessionStore.sessionGoals.
// We mock both to drive the 4-state machine + idle rendering + ticking clock.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

// ===== Mocks =====
// Mutable mock for useGoalJudgeStatus return value.
const mockGoalJudgeStatus: {
  status: 'idle' | 'judging' | 'satisfied' | 'unsatisfied' | 'failed' | 'paused' | undefined;
  iteration: number;
  startedAt: number;
  reason: string | undefined;
  goal: string;
} = {
  status: undefined,
  iteration: 0,
  startedAt: 0,
  reason: undefined,
  goal: '',
};

vi.mock('@/hooks/useGoalJudge', () => ({
  useGoalJudgeStatus: (_sessionId: string | null) => mockGoalJudgeStatus,
}));

const mockSessionGoalsMap = new Map<string, string>();
vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: (selector: (s: { sessionGoals: Map<string, string> }) => unknown) =>
    selector({ sessionGoals: mockSessionGoalsMap }),
}));

import { GoalSystemBubble } from './GoalSystemBubble';

describe('GoalSystemBubble', () => {
  beforeEach(() => {
    mockGoalJudgeStatus.status = undefined;
    mockGoalJudgeStatus.iteration = 0;
    mockGoalJudgeStatus.startedAt = 0;
    mockGoalJudgeStatus.reason = undefined;
    mockGoalJudgeStatus.goal = '';
    mockSessionGoalsMap.clear();
  });
  afterEach(() => cleanup());

  it('renders nothing when no goal set (status undefined + empty goal)', () => {
    const { container } = render(<GoalSystemBubble sessionId="s1" />);
    expect(container.querySelector('[data-testid="goal-system-bubble"]')).toBeNull();
  });

  it('renders 工作中 state with ◎ icon when status=judging', () => {
    mockGoalJudgeStatus.status = 'judging';
    mockGoalJudgeStatus.iteration = 2;
    mockGoalJudgeStatus.startedAt = Date.now() - 83_000; // 1m 23s
    mockGoalJudgeStatus.goal = '帮我把 README 翻译成英文';
    mockSessionGoalsMap.set('s1', '帮我把 README 翻译成英文');

    const { container } = render(<GoalSystemBubble sessionId="s1" />);
    const bubble = screen.getByTestId('goal-system-bubble');
    expect(container.querySelector('svg')).not.toBeNull();
    expect(bubble.textContent).toContain('目标：帮我把 README 翻译成英文');
    expect(bubble.textContent).toContain('正在进行判定中...');
    expect(bubble.textContent).toMatch(/1m 23s/);
    expect(bubble.textContent).toContain('轮次：2/20');
  });

  it('renders 达成 state with ✅ icon when status=satisfied', () => {
    mockGoalJudgeStatus.status = 'satisfied';
    mockGoalJudgeStatus.iteration = 1;
    mockGoalJudgeStatus.startedAt = Date.now() - 5_000;
    mockGoalJudgeStatus.goal = '翻译 README';
    mockSessionGoalsMap.set('s1', '翻译 README');

    const { container } = render(<GoalSystemBubble sessionId="s1" />);
    const bubble = screen.getByTestId('goal-system-bubble');
    expect(container.querySelector('svg')).not.toBeNull();
    expect(bubble.textContent).toContain('达成目标：翻译 README');
    expect(bubble.textContent).toMatch(/总耗时/);
  });

  it('renders 已暂停 state with ⏸ icon when status=paused', () => {
    mockGoalJudgeStatus.status = 'paused';
    mockGoalJudgeStatus.iteration = 20;
    mockGoalJudgeStatus.reason = '已达 20 轮上限';
    mockGoalJudgeStatus.goal = '目标';
    mockSessionGoalsMap.set('s1', '目标');

    const { container } = render(<GoalSystemBubble sessionId="s1" />);
    const bubble = screen.getByTestId('goal-system-bubble');
    expect(container.querySelector('svg')).not.toBeNull();
    expect(bubble.textContent).toContain('已暂停：目标');
    expect(bubble.textContent).toContain('20/20');
    expect(bubble.textContent).toContain('/goal clear');
  });

  it('renders judge 失败 state with ⚠️ icon when status=failed (含 reason 字符串)', () => {
    mockGoalJudgeStatus.status = 'failed';
    mockGoalJudgeStatus.iteration = 1;
    mockGoalJudgeStatus.reason = 'judge 失败：JSON parse 失败';
    mockGoalJudgeStatus.goal = 'g';
    mockSessionGoalsMap.set('s1', 'g');

    const { container } = render(<GoalSystemBubble sessionId="s1" />);
    const bubble = screen.getByTestId('goal-system-bubble');
    expect(container.querySelector('svg')).not.toBeNull();
    expect(bubble.textContent).toContain('判定失败：judge 失败：JSON parse 失败');
    expect(bubble.textContent).toContain('/goal clear');
  });

  it('elapsed time ticks each second while in 工作中 (vi.useFakeTimers)', () => {
    vi.useFakeTimers();
    try {
      const baseStartedAt = 1_700_000_000_000;
      mockGoalJudgeStatus.status = 'unsatisfied';
      mockGoalJudgeStatus.iteration = 0;
      mockGoalJudgeStatus.startedAt = baseStartedAt;
      mockGoalJudgeStatus.goal = 'ticking';
      mockSessionGoalsMap.set('s1', 'ticking');

      // Pin Date.now so the initial render computes a known elapsed.
      vi.setSystemTime(baseStartedAt);
      const { container } = render(<GoalSystemBubble sessionId="s1" />);
      const bubble = screen.getByTestId('goal-system-bubble');
      expect(bubble.textContent).toContain('(0s)');

      // Advance 3s — fake-timers' setInterval fires 3 times, each tick reads
      // the new Date.now() (advanced by the same 3s). Each tick overwrites
      // tickElapsed, so the final DOM value is "3s".
      act(() => {
        vi.advanceTimersByTime(3_000);
      });
      expect(bubble.textContent).toMatch(/\(3s\)/);

      // Advance another 60s → elapsed is now 63s → 1m 3s
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(bubble.textContent).toMatch(/\(1m 3s\)/);
    } finally {
      vi.useRealTimers();
    }
  });
});
