// Regression test for "Maximum update depth exceeded" infinite loop.
//
// Phase 08.2 P3 review warning WR-01 (code review):
//   "useGoalJudgeStatus 的 getSnapshot 每次返回新对象,违反 useSyncExternalStore 契约"
// was promoted to a runtime Critical during user testing. The component
// chain (GoalSystemBubble → useGoalJudgeStatus → useSyncExternalStore) hit
// React 18's infinite loop guard because every getSnapshot() call returned
// a fresh `{ entry, goal }` literal — Object.is comparison always failed.
//
// Fix: replaced useSyncExternalStore with two independent Zustand selectors
// (each backed by Object.is comparison on Map.get). This test ensures the
// fix is permanent by:
//   1. Using the REAL useSessionStore (not a mock that hides the bug).
//   2. Using renderHook + a render-count tracker.
//   3. Asserting that mutating the goalJudgeStatus Map causes ≤ 1 re-render
//      per state change (the pre-fix version would render ~50+ before the
//      React guard kicks in, then throw "Maximum update depth exceeded").
//
// If someone reintroduces the getSnapshot anti-pattern, this test will fail
// with "Maximum update depth exceeded" or render-count assertion failure.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

import { useSessionStore } from '@/stores/sessionStore';
import { useGoalJudgeStatus } from '@/hooks/useGoalJudge';

describe('useGoalJudgeStatus — infinite-loop regression (WR-01 fix)', () => {
  beforeEach(() => {
    // Clear Maps so each test starts from a clean slate.
    act(() => {
      useSessionStore.setState({
        sessionGoals: new Map(),
        goalJudgeStatus: new Map(),
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders once on mount and does not loop when status Map reference is unchanged', () => {
    // Seed an entry so the hook has something to subscribe to.
    act(() => {
      useSessionStore.setState({
        goalJudgeStatus: new Map([
          [
            'session-A',
            { status: 'judging', iteration: 1, startedAt: 12345, reason: 'test' },
          ],
        ]),
        sessionGoals: new Map([['session-A', 'the goal']]),
      });
    });

    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useGoalJudgeStatus('session-A');
    });

    // First render: snapshot read.
    expect(renderCount).toBeGreaterThanOrEqual(1);
    expect(result.current.status).toBe('judging');
    expect(result.current.goal).toBe('the goal');

    const initialRenderCount = renderCount;

    // Mutate unrelated state (no goalJudgeStatus / sessionGoals change).
    // This forces Zustand subscribers to fire, but selectors should return
    // the same references (Object.is === true) → no re-render.
    act(() => {
      useSessionStore.setState({ isStreaming: true });
      useSessionStore.setState({ isStreaming: false });
    });

    // Pre-fix: renderCount would explode to 50+ before React bails out.
    // Post-fix: should be unchanged because Object.is is stable on
    // goalJudgeStatus Map reference + sessionGoals Map reference.
    expect(renderCount).toBe(initialRenderCount);
  });

  it('re-renders exactly once when the goalJudgeStatus Map reference changes for the same sessionId', () => {
    act(() => {
      useSessionStore.setState({
        goalJudgeStatus: new Map([
          [
            'session-B',
            { status: 'idle', iteration: 0, startedAt: 100, reason: undefined },
          ],
        ]),
        sessionGoals: new Map([['session-B', 'goal-b']]),
      });
    });

    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useGoalJudgeStatus('session-B');
    });

    const initial = renderCount;
    const initialStatus = result.current.status;

    // Now mutate the goalJudgeStatus Map with a NEW reference (immutable
    // update). This is the path setGoalJudgeStatus takes in sessionStore.ts.
    act(() => {
      useSessionStore.setState({
        goalJudgeStatus: new Map([
          [
            'session-B',
            { status: 'judging', iteration: 1, startedAt: 100, reason: 'pending' },
          ],
        ]),
      });
    });

    // Should re-render at most once per state change. Pre-fix would render
    // 2+ times for a single Map mutation (initial + getSnapshot
    // re-evaluation that returns a new object).
    expect(renderCount).toBeLessThanOrEqual(initial + 1);
    expect(renderCount).toBeGreaterThanOrEqual(initial);
    expect(result.current.status).toBe('judging');
    expect(result.current.iteration).toBe(1);
    // Sanity: status did change
    expect(result.current.status).not.toBe(initialStatus);
  });

  it('re-renders at most once when only the goal text changes', () => {
    act(() => {
      useSessionStore.setState({
        goalJudgeStatus: new Map([
          [
            'session-C',
            { status: 'idle', iteration: 0, startedAt: 1, reason: undefined },
          ],
        ]),
        sessionGoals: new Map([['session-C', 'goal-v1']]),
      });
    });

    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useGoalJudgeStatus('session-C');
    });

    const initial = renderCount;

    act(() => {
      useSessionStore.setState({
        sessionGoals: new Map([['session-C', 'goal-v2']]),
      });
    });

    expect(renderCount).toBeLessThanOrEqual(initial + 1);
    expect(result.current.goal).toBe('goal-v2');
  });

  it('returns sensible defaults when sessionId is null (no infinite loop)', () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useGoalJudgeStatus(null);
    });

    expect(result.current.status).toBeUndefined();
    expect(result.current.iteration).toBe(0);
    expect(result.current.startedAt).toBe(0);
    expect(result.current.reason).toBeUndefined();
    expect(result.current.goal).toBe('');

    const initial = renderCount;

    // Trigger a state change that would have caused the hook to re-read.
    act(() => {
      useSessionStore.setState({
        goalJudgeStatus: new Map([
          [
            'some-other-session',
            { status: 'judging', iteration: 0, startedAt: 1, reason: 'x' },
          ],
        ]),
      });
    });

    // Should be ≤ 1 re-render. Pre-fix would re-render multiple times.
    expect(renderCount).toBeLessThanOrEqual(initial + 1);
  });
});
