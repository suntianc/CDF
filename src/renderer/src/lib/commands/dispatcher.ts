import { useSessionStore } from '@/stores/sessionStore';
import { useProjectStore } from '@/stores/projectStore';
import { useContextModalStore } from '@/stores/contextModalStore';
import { startGoalJudgeLoop, stopGoalJudgeLoop } from '@/hooks/useGoalJudge';
import type {
  ChatRuntimeOverrides,
  CommandDispatchAction,
  SkillAttribution,
  SkillCommandSourceKind,
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
  const effectiveMatch = resolvePathAwareSkillCommand(match, args, commands);

  if (effectiveMatch.source === 'system') {
    if (effectiveMatch.name === 'goal') {
      // 08.2 P3 C1-05: /goal now drives a judge agent loop. Empty args
      // resolves with goal='' so the dispatch case can recognize "clear".
      return { kind: 'GoalLoop', command: effectiveMatch, args, goal: (args || '').trim() };
    }
    if (effectiveMatch.name === 'context') {
      return { kind: 'SystemLocal', command: effectiveMatch, args };
    }
    // Unknown system command — fall through to null
    return null;
  }

  // MCP / Skills / Custom commands all use PluginRewrite.
  // D-18: args are appended to the natural-language prompt and passed as
  // message.content; they are NOT injected into the tool's schema args.
  // v1.1 polish: MCP commands are server-dimension (one `/<server>` per MCP
  // server, NOT one per tool). The prompt tells the LLM to pick a tool
  // from the server's available tools rather than hardcoding a tool name.
  const prompt = createPluginRewritePrompt(effectiveMatch, args);
  return {
    kind: 'PluginRewrite',
    command: effectiveMatch,
    args,
    prompt,
  };
}

function normalizeProjectRelativePath(value: string): string {
  return value
    .trim()
    .replace(/^@+/, '')
    .replace(/[\]),.;:，。；：）}"']+$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//g, '')
    .replace(/^\/+/g, '');
}

function extractPathMentionContext(args: string): string[] {
  const seen = new Set<string>();
  for (const match of args.matchAll(/@([^\s"'`<>]+)/g)) {
    const normalized = normalizeProjectRelativePath(match[1]);
    if (normalized) seen.add(normalized);
  }
  return Array.from(seen);
}

function getNestedSkillQualifier(command: SlashCommand): string {
  if (command.skillSourceKind !== 'project-nested') return '';
  const qualifiedName = command.qualifiedName ?? command.name;
  const separatorIndex = qualifiedName.lastIndexOf(':');
  if (separatorIndex <= 0) return '';
  return normalizeProjectRelativePath(qualifiedName.slice(0, separatorIndex));
}

function pathContextMatchesQualifier(pathContext: string[], qualifier: string): boolean {
  return pathContext.some((pathContextItem) =>
    pathContextItem === qualifier || pathContextItem.startsWith(`${qualifier}/`)
  );
}

function resolvePathAwareSkillCommand(
  command: SlashCommand,
  args: string,
  commands: ReadonlyArray<SlashCommand>
): SlashCommand {
  if (!command.source.startsWith('skill:')) return command;
  if ((command.qualifiedName ?? command.name).includes(':')) return command;
  const pathContext = extractPathMentionContext(args);
  if (pathContext.length === 0) return command;
  const skillName = command.skillName ?? command.name;
  const matches = commands
    .filter((candidate) => {
      if (!candidate.source.startsWith('skill:')) return false;
      if ((candidate.skillName ?? candidate.name) !== skillName) return false;
      const qualifier = getNestedSkillQualifier(candidate);
      return qualifier && pathContextMatchesQualifier(pathContext, qualifier);
    })
    .sort((a, b) => getNestedSkillQualifier(b).length - getNestedSkillQualifier(a).length);

  return matches[0] ?? command;
}

function createPluginRewritePrompt(command: SlashCommand, args: string): string {
  if (command.source === 'mcp') {
    return `请使用 ${command.name} MCP 服务器上的合适工具处理：${args || '(无具体参数)'}`;
  }

  if (command.source.startsWith('skill:')) {
    const skillName = command.qualifiedName ?? command.name;
    const lines = [
      `请使用 Skill \`${skillName}\` 处理下面的请求。`,
      command.sourceLabel ? `Skill 来源：${command.sourceLabel}。` : '',
      '该 Skill 的完整说明会由 CDF 在执行时注入；不要自行读取 Skill 指令路径。',
      `用户参数：${args || '(无参数)'}`,
    ].filter(Boolean);
    return lines.join('\n');
  }

  return `请调用 ${command.name} 工具，参数：${args || '(无参数)'}`;
}

function createSkillInstructionPrompt(command: SlashCommand, args: string, skillBody: string): string {
  const skillName = command.qualifiedName ?? command.name;
  const lines = [
    `请使用 Skill \`${skillName}\` 处理下面的请求。`,
    command.sourceLabel ? `Skill 来源：${command.sourceLabel}。` : '',
    'Skill 指令：',
    skillBody.trim(),
    `用户参数：${args || '(无参数)'}`,
  ].filter(Boolean);
  return lines.join('\n');
}

function createUnavailableSkillPrompt(command: SlashCommand, args: string): string {
  const skillName = command.qualifiedName ?? command.name;
  const lines = [
    `Skill \`${skillName}\` 当前不可用或无法读取。`,
    command.sourceLabel ? `Skill 来源：${command.sourceLabel}。` : '',
    '不要尝试读取该 Skill 的指令文件；请直接说明该 Skill 当前不可用，并基于用户参数给出可执行的下一步建议。',
    `用户参数：${args || '(无参数)'}`,
  ].filter(Boolean);
  return lines.join('\n');
}

function inferSkillCommandSourceKind(command: SlashCommand): SkillCommandSourceKind | null {
  if (command.skillSourceKind) return command.skillSourceKind;
  if (command.source === 'skill:project') return 'project';
  if (command.source === 'skill:global') return 'user';
  return null;
}

function createExplicitSkillAttribution(command: SlashCommand): SkillAttribution | null {
  if (!command.skillPath) return null;
  const sourceKind = inferSkillCommandSourceKind(command);
  if (!sourceKind) return null;

  return {
    phase: 'explicit-invocation',
    name: command.skillName ?? command.name,
    qualifiedName: command.qualifiedName ?? command.name,
    sourceKind,
    sourceLabel: command.sourceLabel,
    skillPath: command.skillPath,
    modelDiscovery: command.modelDiscovery ?? 'full',
    userInvocable: command.userInvocable ?? true,
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

  const sessionState = useSessionStore.getState();
  const { sendMessage } = sessionState;
  const activeSession = sessionState.sessions?.find(
    (session: { id: string; agent_id?: string | null }) => session.id === sessionState.activeSessionId
  );

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
        if (plan.command.source.startsWith('skill:') && plan.command.skillPath) {
          const { body } = await window.electronAPI.commands.readSkillBody(
            projectId,
            activeSession?.agent_id,
            plan.command.skillPath,
            sessionState.activeSessionId,
          );
          if (body) {
            const substitutedBody = substituteArgs(body, {
              args: plan.args,
              arguments: plan.command.frontmatter?.arguments,
            });
            const skillPrompt = createSkillInstructionPrompt(plan.command, plan.args, substitutedBody);
            const skillAttribution = createExplicitSkillAttribution(plan.command);
            const sendOptions = skillAttribution
              ? { skillAttributions: [skillAttribution] }
              : undefined;
            if (hasOverrides) {
              await sendMessage(projectId, skillPrompt, overrides, undefined, sendOptions);
            } else {
              await sendMessage(projectId, skillPrompt, undefined, undefined, sendOptions);
            }
            return;
          }
          const unavailablePrompt = createUnavailableSkillPrompt(plan.command, plan.args);
          if (hasOverrides) {
            await sendMessage(projectId, unavailablePrompt, overrides);
          } else {
            await sendMessage(projectId, unavailablePrompt);
          }
          return;
        }
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
        // commands (no bodyPath) or when body read returned empty.
        if (hasOverrides) {
          await sendMessage(projectId, plan.prompt, overrides);
        } else {
          await sendMessage(projectId, plan.prompt);
        }
        return;
      }
  }
}
