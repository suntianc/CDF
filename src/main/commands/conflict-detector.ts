import {
  CommandConflictError,
  type CommandSource,
  type SlashCommand,
} from '../../shared/types';

/** Pure function: groups commands by NFKC-normalized name and returns a
 *  `CommandConflictError` for each group of size > 1. Returns the array of
 *  errors — does NOT throw (D-07 lock). */
export function detectConflicts(
  commands: ReadonlyArray<SlashCommand>
): CommandConflictError[] {
  const groups = new Map<string, SlashCommand[]>();
  for (const cmd of commands) {
    const key = cmd.name.normalize('NFKC').toLowerCase();
    const list = groups.get(key);
    if (list) {
      list.push(cmd);
    } else {
      groups.set(key, [cmd]);
    }
  }

  const errors: CommandConflictError[] = [];
  for (const [, list] of groups) {
    if (list.length > 1) {
      const conflicts = list.map((c) => ({ source: c.source as CommandSource, badge: c.badge }));
      errors.push(new CommandConflictError(list[0].name, conflicts));
    }
  }
  return errors;
}
