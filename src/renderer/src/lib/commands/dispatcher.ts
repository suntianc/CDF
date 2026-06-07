import { useSessionStore } from '@/stores/sessionStore';
import { useProjectStore } from '@/stores/projectStore';
import { useContextModalStore } from '@/stores/contextModalStore';
import { startGoalJudgeLoop, stopGoalJudgeLoop } from '@/hooks/useGoalJudge';
import type {
  ChatRuntimeOverrides,
  CommandDispatchAction,
  SlashCommand,
} from '../../../../shared/types';
import { substituteArgs } from './argSubstitution';

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
      // 08.2 P3 C1-05: /goal now drives a judge agent loop. Empty args
      // resolves with goal='' so the dispatch case can recognize "clear".
      return { kind: 'GoalLoop', command: match, args, goal: (args || '').trim() };
    }
    if (match.name === 'context') {
      return { kind: 'SystemLocal', command: match, args };
    }
    // Unknown system command — fall through to null
    return null;
  }

  // MCP / Skills / Workflows / Custom commands all use PluginRewrite.
  // D-18: args are appended to the natural-language prompt and passed as
  // message.content; they are NOT injected into the tool's schema args.
  // v1.1 polish: MCP commands are server-dimension (one `/<server>` per MCP
  // server, NOT one per tool). The prompt tells the LLM to pick a tool
  // from the server's available tools rather than hardcoding a tool name.
  const prompt = match.source === 'mcp'
    ? `请使用 ${match.name} MCP 服务器上的合适工具处理：${args || '(无具体参数)'}`
    : `请调用 ${match.name} 工具，参数：${args || '(无参数)'}`;
  return {
    kind: 'PluginRewrite',
    command: match,
    args,
    prompt,
  };
}

/**
 * Execute a resolved CommandDispatchAction.
 *
 * D-01 dispatch kinds:
 * - SystemSilent: no-op (legacy, unreachable from /goal)
 * - SystemLocal:  calls `electronAPI.context.currentSession` for token breakdown
 * - GoalLoop:     drives the internal judge agent loop
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
      // Phase 7 placeholder. In 08.2 P3, /goal moved to GoalLoop kind;
      // SystemSilent is no longer reachable from the /goal slash command.
      // Kept as a defensive no-op so any external code that still emits
      // SystemSilent (none in v1.1) does not break the dispatch switch.
      console.warn('[dispatcher] SystemSilent path is no longer used by /goal (08.2 P3)');
      return;
    }

    case 'SystemLocal': {
      // 08.2 P4 C2-02 + C2-03 + C2-04: /context now opens the Radix Dialog
      // <ContextModal> (Claude Code 完整版). No toast, no sendMessage — the
      // LLM never sees this data (C2-03). Data fetch is owned by the modal
      // component (useEffect on isOpen). Dual entry: /context slash AND the
      // persistent <ContextButton> both call useContextModalStore.open().
      const { activeSessionId } = useSessionStore.getState();
      if (!activeSessionId) {
        console.warn('[dispatcher] SystemLocal: no active session');
        return;
      }
      useContextModalStore.getState().open();
      return;
    }

    case 'GoalLoop': {
      // 08.2 P3 C1-05 + D-04: /goal drives an internal judge agent loop.
      // Empty args, or literal "clear", → clear semantics:
      //   stop the loop, clear the stored goal. No toast (bubble is the UI;
      //   per UI-SPEC.md §Surface 1 the bubble is the only feedback surface).
      // Non-empty goal → stop any prior loop (防重入), set session goal,
      //   fire-and-forget the judge loop.
      const { activeSessionId, setSessionGoal } = useSessionStore.getState();
      if (!activeSessionId) {
        console.warn('[dispatcher] GoalLoop: no active session');
        return;
      }
      const goal = (plan.goal || '').trim();
      if (!goal || goal.toLowerCase() === 'clear') {
        await stopGoalJudgeLoop(activeSessionId);
        setSessionGoal(activeSessionId, '');
        return;
      }
      await stopGoalJudgeLoop(activeSessionId);
      setSessionGoal(activeSessionId, goal);
      void startGoalJudgeLoop(activeSessionId, goal);
      return;
    }

    case 'PluginRewrite':
      // 08.2 P1 D-01/D-03/D-09: lazy body load + $ARGUMENTS substitution + body
      // replaces user message. The command name does NOT appear in the user
      // message (D-03).
      //
      // Priority: if `plan.command.bodyPath` is set, read the .md body via
      // IPC, substitute placeholders, and send the substituted body as the
      // user message. If body is empty (race / missing file / path-traversal
      // rejected), fall through to the existing prompt-rewrite path so the
      // system stays usable.
      //
      // D-09 allowed-tools: pass frontmatter.allowedTools as runtime override
      // (type-level seam; runtime hard enforcement is deferred to v1.2+ per
      // Issue 2 probe — see SUMMARY "ALLOWED-TOOLS RUNTIME GAP").
      {
        const overrides: ChatRuntimeOverrides = {};
        const allowed = plan.command.frontmatter?.allowedTools;
        if (Array.isArray(allowed) && allowed.length > 0) {
          overrides.allowedTools = allowed;
        }
        const hasOverrides = Object.keys(overrides).length > 0;
        const bodyPath = plan.command.bodyPath;
        if (bodyPath) {
          const { body } = await window.electronAPI.commands.readBody(bodyPath);
          if (body) {
            const substituted = substituteArgs(body, {
              args: plan.args,
              arguments: plan.command.frontmatter?.arguments,
            });
            if (hasOverrides) {
              await sendMessage(projectId, substituted, overrides);
            } else {
              await sendMessage(projectId, substituted);
            }
            return;
          }
        }
        // Fall through (D-18): existing prompt-rewrite path for system/MCP
        // /workflow commands (no bodyPath) or when body read returned empty.
        if (hasOverrides) {
          await sendMessage(projectId, plan.prompt, overrides);
        } else {
          await sendMessage(projectId, plan.prompt);
        }
        return;
      }
  }
}
