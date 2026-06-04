import { useSessionStore } from '@/stores/sessionStore';
import { useProjectStore } from '@/stores/projectStore';
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
 * D-01 four kinds:
 * - SystemSilent: Phase 7 placeholder — no LLM call. Plan 06-02 just logs.
 * - SystemLocal: Phase 7 placeholder — no LLM call. Plan 06-02 just logs.
 * - PlanMode: LLM call with `payload.overrides = { planOnly: true }`
 *   (consumed by `llm.ts:324` extension point).
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
    case 'SystemSilent':
      // Phase 7 will write to sessionGoals Map. Plan 06-02: silent placeholder.
      console.log('[dispatcher] SystemSilent:', plan.command.name, plan.args);
      return;

    case 'SystemLocal':
      // Phase 7 will query messages table for token count + render placeholder bubble.
      // Plan 06-02: local-only placeholder (no LLM call).
      console.log('[dispatcher] SystemLocal:', plan.command.name, plan.args);
      return;

    case 'PlanMode':
      // D-01 + llm.ts:324 extension point: `overrides.planOnly = true` flips
      // deepagent runtime into plan-only mode. M3 thinking chunk must
      // contain `<think>…plan only…</think>` (verified in Phase 7 SLASH-REGRESSION).
      await sendMessage(projectId, plan.args, { planOnly: true });
      return;

    case 'PluginRewrite':
      // D-18 + PITFALLS P7: args are appended to message.content as
      // natural-language context. They are NOT passed to the tool's schema
      // args — that path would enable command injection via crafted arg
      // strings. We do NOT pass `overrides` to sendMessage.
      await sendMessage(projectId, plan.prompt);
      return;
  }
}
