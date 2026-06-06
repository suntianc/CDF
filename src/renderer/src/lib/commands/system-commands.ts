import type { SlashCommand } from '../../../../shared/types';

/**
 * Renderer-side fallback for the 2 system commands. Mirrors what
 * `collectSystemCommands` in the main process returns. Kept here so the
 * renderer can render the popup before the registry IPC round-trip
 * completes (and so unit tests don't need to mock the IPC bridge).
 *
 * Phase 6: this is the FALLBACK only. When the IPC `commands:list` returns
 * a populated registry, the popup uses that list and this array is ignored.
 */
export const SYSTEM_COMMANDS: ReadonlyArray<SlashCommand> = [
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
