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
//   3. Subscribe to the target session's streaming transitions (proxy for
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
  stopGoalJudgeLoop: (sessionId: string, options?: { clearStatus?: boolean }) => Promise<void>;
  useGoalJudgeStatus: (sessionId: string | null) => GoalJudgeStatus;
  /** Internal — exposed for tests that need to assert subscription state. */
  _internal: {
    subs: Map<string, { unsubscribe: () => void }>;
  };
}

const DEFAULT_MAX_TURNS = 20;
const JUDGE_CONTEXT_TURNS = 8;

function buildContinueInstruction(reason: string): string {
  return [
    '继续完成原始任务。',
    '不要评估目标，不要输出 JSON，不要只说“将要做”或“现在开始”。',
    '立即执行下一步可观察动作：需要改文件就调用文件工具，需要查证就调用读取/搜索工具；若确实无法执行，给出具体阻塞原因。',
    `当前未完成原因：${reason}`,
  ].join('\n');
}

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

function extractFirstJsonObject(raw: string): string {
  const cleaned = stripThinkBlocks(raw);
  const start = cleaned.indexOf('{');
  if (start === -1) return cleaned;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }
  return cleaned.slice(start);
}

function truncateForJudge(value: unknown, maxLength = 300): string {
  let text = '';
  if (typeof value === 'string') {
    text = value;
  } else if (value !== null && value !== undefined) {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function renderToolSummary(content: string): string | null {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || parsed.type !== 'tool') return null;
    const parts = [
      `name=${parsed.name || 'unknown'}`,
      `status=${parsed.status || 'unknown'}`,
    ];
    const input = truncateForJudge(parsed.input, 160);
    const output = truncateForJudge(parsed.output, 220);
    const error = truncateForJudge(parsed.error, 220);
    if (input) parts.push(`input=${input}`);
    if (output) parts.push(`output=${output}`);
    if (error) parts.push(`error=${error}`);
    return `[tool] ${parts.join(' ')}`;
  } catch {
    return null;
  }
}

/** Render the last N user/assistant/tool messages into a short transcript for the judge. */
function renderRecentTurns(messages: ReadonlyArray<{ role: string; content: string }>): string {
  const transcript = messages
    .map((m) => {
      if (!m.content || !m.content.trim()) return null;
      if (m.role === 'user' || m.role === 'assistant') {
        return `[${m.role}] ${truncateForJudge(m.content, 500)}`;
      }
      if (m.role === 'system') {
        return renderToolSummary(m.content);
      }
      return null;
    })
    .filter((line): line is string => Boolean(line))
    .slice(-JUDGE_CONTEXT_TURNS * 3) // user + assistant + summarized tools
    .join('\n');
  return transcript || '(no prior turns)';
}

function isSessionReadyForJudge(state: ReturnType<typeof useSessionStore.getState>, sessionId: string): boolean {
  if (state.activeSessionId !== sessionId) {
    return true;
  }
  if (state.pendingApproval) {
    return false;
  }
  return !state.agentToolCalls.some((call) => call.status === 'running');
}

/** Make a single judge LLM call and parse the {satisfied, reason} JSON. */
async function callJudgeOnce(opts: {
  projectId: string;
  sessionId: string;
  goal: string;
  recentTurns: string;
  model?: string;
  providerId?: string;
}): Promise<JudgeDecision> {
  const api = window.electronAPI?.llm;
  if (!api?.judge) {
    throw new Error('judge: electronAPI.llm.judge 不可用');
  }
  const prompt = buildJudgePrompt(opts.goal, opts.recentTurns);

  const overrides: any = {};
  if (opts.providerId) overrides.providerId = opts.providerId;
  if (opts.model) overrides.model = opts.model;

  const response = await api.judge({
    projectId: opts.projectId,
    prompt,
    overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
  });

  try {
    const parsed = JSON.parse(extractFirstJsonObject(response?.text ?? ''));
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.satisfied === 'boolean' &&
      typeof parsed.reason === 'string'
    ) {
      return { satisfied: parsed.satisfied, reason: parsed.reason };
    }
    throw new Error('judge: JSON schema 不合法（缺少 satisfied/reason）');
  } catch (err: any) {
    throw new Error('judge: JSON parse 失败: ' + (err?.message || 'unknown'));
  }
}

// ===== Factory =====
export function createGoalJudge(): GoalJudgeInstance {
  // Closure-private subscriptions map (Issue 8 fix — factory isolation).
  const subs = new Map<string, { unsubscribe: () => void }>();
  // Track active judge iterations per session. If the main agent finishes while
  // a judge iteration is awaiting sendMessage(), queue one follow-up judge run.
  const judgingSessions = new Set<string>();
  const queuedCompletions = new Set<string>();

  async function startGoalJudgeLoop(
    sessionId: string,
    goal: string,
    options: JudgeOptions = {}
  ): Promise<void> {
    // 防重入：同 sessionId 已有 loop → 先停
    if (subs.has(sessionId)) {
      await stopGoalJudgeLoop(sessionId, { clearStatus: false });
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

    const sessionModelOverrides = sessionState.sessionModelOverrides || {};
    const sessionModelOverride = sessionModelOverrides[sessionId];
    const judgeModel = options.model || sessionModelOverride?.model;
    const judgeProviderId = sessionModelOverride?.providerId;

    // 1) 先订阅目标 session 的 streaming 转换。true→false 翻转 = 主 agent 一轮结束。
    let prevStreaming = useSessionStore.getState().getIsSessionStreaming?.(sessionId)
      ?? useSessionStore.getState().isStreaming;
    const unsubscribe = useSessionStore.subscribe(() => {
      const state = useSessionStore.getState();
      const nowStreaming = state.getIsSessionStreaming?.(sessionId) ?? state.isStreaming;
      if (prevStreaming && !nowStreaming) {
        if (!isSessionReadyForJudge(state, sessionId)) {
          prevStreaming = nowStreaming;
          return;
        }
        if (judgingSessions.has(sessionId)) {
          queuedCompletions.add(sessionId);
        } else {
          void runJudgeIteration(sessionId, goal, maxTurns, projectId, judgeModel, judgeProviderId);
        }
      }
      prevStreaming = nowStreaming;
    });
    subs.set(sessionId, { unsubscribe });

    // 2) 首轮：把 goal 作为 user message 注入主 agent。
    //    不传 overrides（平等 user message；judge 自己用独立 channel）
    try {
      await useSessionStore.getState().sendMessage(projectId, goal, undefined, sessionId);
    } catch (err) {
      console.error('[useGoalJudge] initial sendMessage failed:', err);
      useSessionStore.getState().setGoalJudgeStatus(sessionId, {
        status: 'failed',
        reason: 'goal 注入失败：' + ((err as any)?.message || 'unknown'),
      });
      await stopGoalJudgeLoop(sessionId, { clearStatus: false });
    }
  }

  async function runJudgeIteration(
    sessionId: string,
    goal: string,
    maxTurns: number,
    projectId: string,
    model: string | undefined,
    providerId: string | undefined
  ): Promise<void> {
    // 若已被外部 stopGoalJudgeLoop 清掉，直接返回
    if (!subs.has(sessionId)) return;

    // Guard against overlapping judge runs for the same session. The queued
    // completion is drained in finally so the loop still advances one turn.
    if (judgingSessions.has(sessionId)) {
      queuedCompletions.add(sessionId);
      return;
    }
    judgingSessions.add(sessionId);
    try {
      useSessionStore.getState().setGoalJudgeStatus(sessionId, { status: 'judging' });

      const store = useSessionStore.getState();
      const messages = typeof store.getMessagesForSession === 'function'
        ? store.getMessagesForSession(sessionId)
        : store.messages;
      const recentTurns = renderRecentTurns(messages);

      let decision: JudgeDecision;
      try {
        decision = await callJudgeOnce({
          projectId,
          sessionId,
          goal,
          recentTurns,
          model,
          providerId,
        });
      } catch (err: any) {
        useSessionStore.getState().setGoalJudgeStatus(sessionId, {
          status: 'failed',
          reason: 'judge 失败：' + ((err && err.message) || 'unknown'),
        });
        await stopGoalJudgeLoop(sessionId, { clearStatus: false });
        return;
      }

      if (decision.satisfied) {
        useSessionStore.getState().setGoalJudgeStatus(sessionId, {
          status: 'satisfied',
          reason: decision.reason,
        });
        await stopGoalJudgeLoop(sessionId, { clearStatus: false });
        return;
      }

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
        await stopGoalJudgeLoop(sessionId, { clearStatus: false });
        return;
      }

      useSessionStore.getState().setGoalJudgeStatus(sessionId, {
        status: 'unsatisfied',
        iteration: nextIteration,
        reason: decision.reason,
      });
      try {
        await useSessionStore.getState().sendMessage(
          projectId,
          buildContinueInstruction(decision.reason),
          undefined,
          sessionId,
          { hiddenUserMessage: true }
        );
      } catch (err) {
        console.error('[useGoalJudge] continue sendMessage failed:', err);
        useSessionStore.getState().setGoalJudgeStatus(sessionId, {
          status: 'failed',
          reason: 'continue 注入失败：' + ((err as any)?.message || 'unknown'),
        });
        await stopGoalJudgeLoop(sessionId, { clearStatus: false });
      }
    } finally {
      judgingSessions.delete(sessionId);
      if (queuedCompletions.delete(sessionId) && subs.has(sessionId)) {
        void runJudgeIteration(sessionId, goal, maxTurns, projectId, model, providerId);
      }
    }
  }

  async function stopGoalJudgeLoop(
    sessionId: string,
    options: { clearStatus?: boolean } = {}
  ): Promise<void> {
    const sub = subs.get(sessionId);
    if (sub) {
      try {
        sub.unsubscribe();
      } catch {
        // swallow — unsub is idempotent
      }
      subs.delete(sessionId);
    }
    if (options.clearStatus !== false) {
      useSessionStore.getState().clearGoalJudgeStatus(sessionId);
    }
  }

  function useGoalJudgeStatus(sessionId: string | null): GoalJudgeStatus {
    // Subscribe via two independent Zustand selectors. Each selector returns a
    // stable reference (Object.is): when the goalJudgeStatus Map reference is
    // unchanged, Map.get(sessionId) returns the same entry, and
    // Object.is(entry, entry) === true → no re-render. Same for sessionGoals.
    //
    // This replaces the previous useSyncExternalStore implementation whose
    // getSnapshot returned a fresh `{ entry, goal }` object on every call,
    // triggering React 18's "Maximum update depth exceeded" infinite loop
    // (Phase 08.2 P3 review warning WR-01 — promoted to runtime Critical
    // during user testing). Zustand v5 internally uses useSyncExternalStore
    // with Object.is comparison, giving us the correct behavior out of the box.
    const entry = useSessionStore((s: ReturnType<typeof useSessionStore.getState>) =>
      sessionId ? s.goalJudgeStatus.get(sessionId) : undefined
    );
    const goal = useSessionStore((s: ReturnType<typeof useSessionStore.getState>) =>
      sessionId ? (s.sessionGoals.get(sessionId) ?? '') : ''
    );
    return {
      status: entry?.status,
      iteration: entry?.iteration ?? 0,
      startedAt: entry?.startedAt ?? 0,
      reason: entry?.reason,
      goal,
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
