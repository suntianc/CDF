import type { GoalJudgeStatusEntry, SessionSliceContext, SessionState } from './types';

export type GoalJudgeSlice = Pick<SessionState,
  | 'sessionGoals'
  | 'goalJudgeStatus'
  | 'setSessionGoal'
  | 'setGoalJudgeStatus'
  | 'getGoalJudgeStatus'
  | 'clearGoalJudgeStatus'
>;

export function createGoalJudgeSlice({ set, get }: SessionSliceContext): GoalJudgeSlice {
  return {
    sessionGoals: new Map(),
    goalJudgeStatus: new Map(),

    // D-02/D-03: setSessionGoal synchronously writes to a NEW Map (immutability for
    // Zustand shallow-compare re-render). D-04: selectSession does NOT clear this.
    setSessionGoal: (sessionId: string, goal: string) => {
      set((state) => {
        const next = new Map(state.sessionGoals);
        next.set(sessionId, goal);
        return { sessionGoals: next };
      });
    },

    // 08.2 P3 C1-05: shallow-merge judge status partial into existing entry.
    // Empty seed when entry is absent (e.g. first call after startGoalJudgeLoop).
    setGoalJudgeStatus: (sessionId: string, partial: Partial<GoalJudgeStatusEntry>) => {
      set((state) => {
        const existing = state.goalJudgeStatus.get(sessionId);
        const next = new Map(state.goalJudgeStatus);
        next.set(sessionId, {
          status: existing?.status ?? 'idle',
          iteration: existing?.iteration ?? 0,
          startedAt: existing?.startedAt ?? Date.now(),
          reason: existing?.reason,
          ...partial,
        });
        return { goalJudgeStatus: next };
      });
    },

    getGoalJudgeStatus: (sessionId: string) => {
      return get().goalJudgeStatus.get(sessionId);
    },

    clearGoalJudgeStatus: (sessionId: string) => {
      set((state) => {
        if (!state.goalJudgeStatus.has(sessionId)) return state;
        const next = new Map(state.goalJudgeStatus);
        next.delete(sessionId);
        return { goalJudgeStatus: next };
      });
    },
  };
}
