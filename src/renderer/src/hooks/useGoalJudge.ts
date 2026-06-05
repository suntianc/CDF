// 08.2 P3 C1-05: /goal judge agent hook.
//
// Architecture (Issue 8 fix — factory pattern):
//   - createGoalJudge() returns a fresh instance with closure-private `subs`
//     Map; tests can call createGoalJudge() in each `it` to get isolation.
//   - The default exported `goalJudge` is the singleton used by the
//     dispatcher; aliases `startGoalJudgeLoop` etc. preserve the import path
//     other modules already use.
//
// Loop flow (per plan §useGoalJudge.ts):
//   1. startGoalJudgeLoop writes goalJudgeStatus = { idle, iteration 0 }.
//   2. First turn: sendMessage(projectId, goal) — goal becomes a user msg.
//   3. Subscribe to sessionStore.isStreaming transitions (proxy for
//      "main agent finished a turn"). On true→false flip, call judgeOnce.
//   4. judgeOnce is a self-contained LLM call (unique judgeRequestId → its
//      own `llm:chunk-${id}` channel) so the judge's chunks do NOT enter
//      the main agent's conversation stream (C1-03 / success criterion).
//   5. judgeOnce strips <think>...</think> blocks BEFORE JSON.parse (P2
//      pitfall — M3 thinking chain).
//   6. decision = satisfied: bubble = ✅; stop.
//      decision = unsatisfied + iteration < maxTurns: sendMessage('继续：${reason}'),
//        iteration++, repeat from step 3.
//      iteration >= maxTurns (P7 cap): bubble = ⏸ paused, sonner.warning, stop.
//      parse error: bubble = ⚠️ failed, stop.

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { useProjectStore } from '@/stores/projectStore';
import {
  useSessionStore,
  type GoalJudgeStatusEntry,
  type JudgeStatus,
} from '@/stores/sessionStore';

// ===== Public types (re-exported for consumers) =====
export type { JudgeStatus, GoalJudgeStatusEntry } from '@/stores/sessionStore';

export interface JudgeDecision {
  satisfied: boolean;
  reason: string;
}

export interface JudgeOptions {
  maxTurns?: number; // default 20
  model?: string; // undefined → use session default
}

export interface GoalJudgeStatus {
  status: JudgeStatus | undefined;
  iteration: number;
  startedAt: number;
  reason?: string;
  goal: string;
}

export interface GoalJudgeInstance {
  startGoalJudgeLoop: (
    sessionId: string,
    goal: string,
    options?: JudgeOptions
  ) => Promise<void>;
  stopGoalJudgeLoop: (sessionId: string) => Promise<void>;
  useGoalJudgeStatus: (sessionId: string | null) => GoalJudgeStatus;
  /** Internal — exposed for tests that need to assert subscription state. */
  _internal: {
    subs: Map<string, { unsubscribe: () => void }>;
  };
}

const DEFAULT_MAX_TURNS = 20;
const JUDGE_CONTEXT_TURNS = 8;

// === Judge prompt template (final; per plan §"judge call 实现细节") ===
function buildJudgePrompt(goal: string, recentTurns: string): string {
  return [
    'You are a strict judge. Evaluate whether the following completion condition is met by the AI agent\'s recent work.',
    '',
    `Condition: ${goal}`,
    '',
    'Recent conversation (last 8 turns):',
    recentTurns,
    '',
    'Respond with JSON ONLY, no preamble, no markdown fence. Schema:',
    '{ "satisfied": boolean, "reason": "1-2 sentence rationale in 简体中文" }',
  ].join('\n');
}

/** Strip <think>...</think> blocks (P2 pitfall) + <think>.* (unterminated) before JSON.parse. */
function stripThinkBlocks(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .trim();
}

/** Render the last N user/assistant messages into a short transcript for the judge. */
function renderRecentTurns(messages: ReadonlyArray<{ role: string; content: string }>): string {
  const transcript = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => m.content && m.content.trim().length > 0)
    .slice(-JUDGE_CONTEXT_TURNS * 2) // user+assistant pairs
    .map((m) => `[${m.role}] ${m.content.slice(0, 500)}`)
    .join('\n');
  return transcript || '(no prior turns)';
}

/** Make a single judge LLM call and parse the {satisfied, reason} JSON. */
async function callJudgeOnce(opts: {
  projectId: string;
  sessionId: string;
  goal: string;
  recentTurns: string;
  model?: string;
}): Promise<JudgeDecision> {
  const judgeRequestId = `judge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const api = window.electronAPI?.llm;
  if (!api?.chat || !api?.onChunk) {
    throw new Error('judge: electronAPI.llm.chat / onChunk 不可用');
  }
  const prompt = buildJudgePrompt(opts.goal, opts.recentTurns);

  return new Promise<JudgeDecision>((resolve, reject) => {
    let accumulated = '';
    let resolved = false;
    const cleanup = api.onChunk(judgeRequestId, (_event: unknown, data: any) => {
      if (resolved) return;
      if (data?.type === 'message_chunk' && typeof data.text === 'string') {
        accumulated += data.text;
      } else if (data?.type === 'message_done') {
        resolved = true;
        cleanup();
        try {
          const cleaned = stripThinkBlocks(accumulated);
          const parsed = JSON.parse(cleaned);
          if (
            parsed &&
            typeof parsed === 'object' &&
            typeof parsed.satisfied === 'boolean' &&
            typeof parsed.reason === 'string'
          ) {
            resolve({ satisfied: parsed.satisfied, reason: parsed.reason });
          } else {
            reject(new Error('judge: JSON schema 不合法（缺少 satisfied/reason）'));
          }
        } catch (err: any) {
          reject(new Error('judge: JSON parse 失败: ' + (err?.message || 'unknown')));
        }
      } else if (data?.type === 'runtime_error') {
        resolved = true;
        cleanup();
        reject(new Error('judge: runtime_error: ' + (data?.error || 'unknown')));
      }
    });

    api
      .chat(judgeRequestId, {
        projectId: opts.projectId,
        sessionId: opts.sessionId,
        message: { id: judgeRequestId, content: prompt },
        overrides: opts.model ? { model: opts.model } : undefined,
      })
      .catch((err: any) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

// ===== Factory =====
export function createGoalJudge(): GoalJudgeInstance {
  // Closure-private subscriptions map (Issue 8 fix — factory isolation).
  const subs = new Map<string, { unsubscribe: () => void }>();

  async function startGoalJudgeLoop(
    sessionId: string,
    goal: string,
    options: JudgeOptions = {}
  ): Promise<void> {
    // 防重入：同 sessionId 已有 loop → 先停
    if (subs.has(sessionId)) {
      await stopGoalJudgeLoop(sessionId);
    }

    const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    const sessionState = useSessionStore.getState();
    sessionState.setGoalJudgeStatus(sessionId, {
      status: 'idle',
      iteration: 0,
      startedAt: Date.now(),
      reason: undefined,
    });

    const projectId = useProjectStore.getState().currentProjectId;
    if (!projectId) {
      console.warn('[useGoalJudge] startGoalJudgeLoop: no active project');
      return;
    }

    // 1) 首轮：把 goal 作为 user message 注入主 agent。
    //    不传 overrides（平等 user message；judge 自己用独立 channel）
    try {
      await useSessionStore.getState().sendMessage(projectId, goal);
    } catch (err) {
      console.error('[useGoalJudge] initial sendMessage failed:', err);
      useSessionStore.getState().setGoalJudgeStatus(sessionId, {
        status: 'failed',
        reason: 'goal 注入失败：' + ((err as any)?.message || 'unknown'),
      });
      return;
    }

    // 2) 订阅 sessionStore.isStreaming 转换。true→false 翻转 = 主 agent 一轮结束。
    let prevStreaming = useSessionStore.getState().isStreaming;
    const unsubscribe = useSessionStore.subscribe((s: { isStreaming: boolean }) => {
      const nowStreaming = s.isStreaming;
      // 只关心 true → false 翻转（main agent 一轮完成）
      if (prevStreaming && !nowStreaming) {
        // 跑 judge（async fire-and-forget）
        void runJudgeIteration(sessionId, goal, maxTurns, projectId, options.model);
      }
      prevStreaming = nowStreaming;
    });

    subs.set(sessionId, { unsubscribe });
  }

  async function runJudgeIteration(
    sessionId: string,
    goal: string,
    maxTurns: number,
    projectId: string,
    model: string | undefined
  ): Promise<void> {
    // 若已被外部 stopGoalJudgeLoop 清掉，直接返回
    if (!subs.has(sessionId)) return;

    useSessionStore.getState().setGoalJudgeStatus(sessionId, { status: 'judging' });

    const messages = useSessionStore.getState().messages;
    const recentTurns = renderRecentTurns(messages);

    let decision: JudgeDecision;
    try {
      decision = await callJudgeOnce({
        projectId,
        sessionId,
        goal,
        recentTurns,
        model,
      });
    } catch (err: any) {
      useSessionStore.getState().setGoalJudgeStatus(sessionId, {
        status: 'failed',
        reason: 'judge 失败：' + ((err && err.message) || 'unknown'),
      });
      // 失败：停掉 loop（不再进 sendMessage 死循环）
      await stopGoalJudgeLoop(sessionId);
      return;
    }

    if (decision.satisfied) {
      useSessionStore.getState().setGoalJudgeStatus(sessionId, {
        status: 'satisfied',
        reason: decision.reason,
      });
      await stopGoalJudgeLoop(sessionId);
      return;
    }

    // 未满足：检查 20-turn cap（P7）
    const current = useSessionStore.getState().getGoalJudgeStatus(sessionId);
    const nextIteration = (current?.iteration ?? 0) + 1;
    if (nextIteration >= maxTurns) {
      useSessionStore.getState().setGoalJudgeStatus(sessionId, {
        status: 'paused',
        iteration: nextIteration,
        reason: `已达 ${maxTurns} 轮上限`,
      });
      toast.warning('/goal 暂停', {
        description: `已达 ${maxTurns} 轮上限。输入 /goal 清空。`,
      });
      await stopGoalJudgeLoop(sessionId);
      return;
    }

    // 注入下一轮 user message
    useSessionStore.getState().setGoalJudgeStatus(sessionId, {
      status: 'unsatisfied',
      iteration: nextIteration,
      reason: decision.reason,
    });
    try {
      await useSessionStore.getState().sendMessage(projectId, '继续：' + decision.reason);
    } catch (err) {
      console.error('[useGoalJudge] continue sendMessage failed:', err);
      useSessionStore.getState().setGoalJudgeStatus(sessionId, {
        status: 'failed',
        reason: 'continue 注入失败：' + ((err as any)?.message || 'unknown'),
      });
      await stopGoalJudgeLoop(sessionId);
    }
  }

  async function stopGoalJudgeLoop(sessionId: string): Promise<void> {
    const sub = subs.get(sessionId);
    if (sub) {
      try {
        sub.unsubscribe();
      } catch {
        // swallow — unsub is idempotent
      }
      subs.delete(sessionId);
    }
    useSessionStore.getState().clearGoalJudgeStatus(sessionId);
  }

  function useGoalJudgeStatus(sessionId: string | null): GoalJudgeStatus {
    // Hooks: subscribe via useSyncExternalStore to goalJudgeStatus + sessionGoals slices.
    // Zustand stores implement useSyncExternalStore semantics through a `subscribe`
    // method. We use the lower-level `subscribe` API + a snapshot reader to keep
    // the hook's contract minimal (no `useSessionStore(selector)` shim needed).
    const subscribe = useMemo(
      () => (cb: () => void) => useSessionStore.subscribe(cb),
      []
    );
    const getSnapshot = () => {
      if (!sessionId) {
        return { entry: undefined as GoalJudgeStatusEntry | undefined, goal: '' };
      }
      const s = useSessionStore.getState();
      return { entry: s.goalJudgeStatus.get(sessionId), goal: s.sessionGoals.get(sessionId) ?? '' };
    };
    // useSyncExternalStore with a stable subscribe + getSnapshot
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    useEffect(() => {
      // Force re-render when sessionId changes (the snapshot above is fresh per render).
    }, [sessionId]);
    return {
      status: snapshot.entry?.status,
      iteration: snapshot.entry?.iteration ?? 0,
      startedAt: snapshot.entry?.startedAt ?? 0,
      reason: snapshot.entry?.reason,
      goal: snapshot.goal,
    };
  }

  return {
    startGoalJudgeLoop,
    stopGoalJudgeLoop,
    useGoalJudgeStatus,
    _internal: { subs },
  };
}

// ===== Default singleton + convenience aliases =====
export const goalJudge: GoalJudgeInstance = createGoalJudge();

export const startGoalJudgeLoop = goalJudge.startGoalJudgeLoop;
export const stopGoalJudgeLoop = goalJudge.stopGoalJudgeLoop;
export const useGoalJudgeStatus = goalJudge.useGoalJudgeStatus;
