import type { SlashCommand } from '../../../shared/types';

/**
 * Phase 6 system commands — 3 hardcoded entries, no IO.
 *
 * D-08 / C-01: badge text `[system]`.
 * Description is for internal log only; Phase 5 popup shows description for
 * system commands (D-09 only excepts MCP from the popup).
 */
export function collectSystemCommands(): SlashCommand[] {
  return [
    {
      name: 'goal',
      description: '设置 session 目标',
      source: 'system',
      target: 'goal',
      sourceLabel: 'system',
      badge: '[system]',
    },
    {
      name: 'context',
      description: '查看 session token 用量',
      source: 'system',
      target: 'context',
      sourceLabel: 'system',
      badge: '[system]',
      // 08.2 polish: <ContextButton> 📊 in the composer is the primary
      // entry; the slash popup would be a duplicate of the same affordance.
      // Slash input `/context` still dispatches via the dispatcher for
      // users who prefer the keyboard path.
      hideFromPopup: true,
    },
  ];
}
