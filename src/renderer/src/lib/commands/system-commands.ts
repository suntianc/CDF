import type { SlashCommand } from '../../../../shared/types';

/**
 * Renderer-side fallback for the 3 system commands. Mirrors what
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
  },
  {
    name: 'plan',
    description: '进入 plan 模式',
    source: 'system',
    target: 'plan',
    sourceLabel: 'system',
    badge: '[system]',
  },
];
