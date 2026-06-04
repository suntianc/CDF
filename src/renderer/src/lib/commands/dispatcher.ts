import { useSessionStore } from '@/stores/sessionStore';
import { useProjectStore } from '@/stores/projectStore';
import { toast } from 'sonner';
import type {
  CommandDispatchAction,
  SlashCommand,
} from '../../../../shared/types';

/**
 * Resolve a `/`-prefixed user input to one of 4 CommandDispatchAction kinds.
 *
 * D-02: args is the substring AFTER `/${commandName}`, trimmed. NO flag parsing —
 * Phase 7 will add a real args parser. Phase 6 only passes the raw string.
 *
 * Returns null if:
 * - input doesn't start with `/`
 * - no command in the registry matches (unknown command, or empty registry)
 */
export function resolve(
  inputVal: string,
  commands: ReadonlyArray<SlashCommand>
): CommandDispatchAction | null {
  if (!inputVal.startsWith('/')) return null;

  // Find the first command whose `/name` (followed by space or end-of-input)
  // matches the start of the input.
  const match = commands.find((c) => {
    const cmdPrefix = '/' + c.name;
    return (
      inputVal === cmdPrefix ||
      inputVal.startsWith(cmdPrefix + ' ') ||
      inputVal === cmdPrefix + ' '
    );
  });
  if (!match) return null;

  // D-02: raw string passthrough. `slice('/' + name.length)` strips the
  // command; `.trim()` removes leading whitespace.
  const args = inputVal.slice(('/' + match.name).length).trim();

  if (match.source === 'system') {
    if (match.name === 'goal') {
      return { kind: 'SystemSilent', command: match, args };
    }
    if (match.name === 'context') {
      return { kind: 'SystemLocal', command: match, args };
    }
    if (match.name === 'plan') {
      return { kind: 'PlanMode', command: match, args };
    }
    // Unknown system command — fall through to null
    return null;
  }

  // MCP / Skills / Workflows / Custom commands all use PluginRewrite.
  // D-18: args are appended to the natural-language prompt and passed as
  // message.content; they are NOT injected into the tool's schema args.
  return {
    kind: 'PluginRewrite',
    command: match,
    args,
    prompt: `请调用 ${match.name} 工具，参数：${args || '(无参数)'}`,
  };
}

/**
 * Execute a resolved CommandDispatchAction.
 *
 * D-01 four kinds (Phase 7: real implementations, no more console.log placeholders):
 * - SystemSilent: writes goal to `useSessionStore.sessionGoals` (in-memory, no LLM)
 * - SystemLocal:  calls `electronAPI.context.currentSession` for token breakdown
 * - PlanMode:     emits `[plan]` toast + `sendMessage(..., { planOnly: true })`
 * - PluginRewrite: LLM call with NO overrides; args are baked into the
 *   prompt's natural-language text.
 *
 * BLOCKER 1 fix: `currentProjectId` lives in `useProjectStore` (NOT
 * `useSessionStore`). Confirmed at `src/renderer/src/stores/projectStore.ts:11`.
 */
export async function dispatch(plan: CommandDispatchAction): Promise<void> {
  const projectId = useProjectStore.getState().currentProjectId;
  if (!projectId) {
    console.warn('[dispatcher] No active project; cannot dispatch');
    return;
  }

  const { sendMessage } = useSessionStore.getState();

  switch (plan.kind) {
    case 'SystemSilent': {
      // D-02/D-03/D-04: write to sessionGoals Map (in-memory, persists across sessions).
      // D-01: placeholder bubble via sonner toast (Phase 8 polish can swap to MessageItem).
      const { activeSessionId, setSessionGoal } = useSessionStore.getState();
      if (!activeSessionId) {
        console.warn('[dispatcher] SystemSilent: no active session');
        return;
      }
      const goal = (plan.args || '').trim();  // C-02: trim head/tail whitespace
      setSessionGoal(activeSessionId, goal);
      toast.info('[system] 正在执行 /goal…', {
        description: `session=${activeSessionId.slice(0, 8)}  goal=${goal || '(无描述)'}`,
        duration: 2000,
      });
      return;
    }

    case 'SystemLocal': {
      // D-06/D-07/D-08: pull token breakdown from main process IPC; render static bubble.
      const { activeSessionId } = useSessionStore.getState();
      if (!activeSessionId) {
        console.warn('[dispatcher] SystemLocal: no active session');
        return;
      }
      try {
        const result = await window.electronAPI.context.currentSession(activeSessionId);
        toast.info('[system] 上下文', {
          description:
            `对话: ${result.breakdown.conversation} tokens\n` +
            `Skills: ${result.breakdown.skills} tokens\n` +
            `MCP: ${result.breakdown.mcp} tokens\n` +
            `Workflows: ${result.breakdown.workflows} tokens\n` +
            `Total: ${result.total} tokens`,
          duration: 4000,
        });
      } catch (err: any) {
        console.error('[dispatcher] SystemLocal IPC failed:', err);
        toast.error('[system] 上下文拉取失败', { description: err?.message || '未知错误' });
      }
      return;
    }

    case 'PlanMode': {
      // D-10/D-11: [plan] marker bubble (持续到首个 message_chunk 到达, C-04).
      const description = plan.args.trim() || '(无描述)';
      toast.info(`[plan] 进入 plan 模式：${description}`, {
        description: 'LLM 不会调用 write_file / edit_file / bash',
        duration: 3000,
      });
      // D-12: 透传 planOnly 给 sendMessage → llm.ts → runtime.ts (Gap 1+2+3 chain).
      await sendMessage(projectId, plan.args, { planOnly: true });
      return;
    }

    case 'PluginRewrite':
      // D-18 + PITFALLS P7: args are appended to message.content as
      // natural-language context. They are NOT passed to the tool's schema
      // args — that path would enable command injection via crafted arg
      // strings. We do NOT pass `overrides` to sendMessage.
      await sendMessage(projectId, plan.prompt);
      return;
  }
}
