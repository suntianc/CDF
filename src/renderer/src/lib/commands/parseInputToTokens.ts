import type { CommandSource, SlashCommand } from '../../../../shared/types';

/**
 * Phase 08.1 — D-03: parse a user-typed string for the leading slash
 * command and the trailing free text. Mirrors `dispatcher.resolve()`'s
 * matcher logic (lines 19-39) so the overlay can never disagree with the
 * dispatcher about whether the leading text is a known command.
 *
 * Hard constraint: only ONE token per input (D-03 / SPEC R6). Later
 * `/` characters in the string are treated as plain text and remain in
 * the `text` tail.
 *
 * The returned `text` field is the raw tail AFTER the leading
 * `/${cmd.name}` (NOT trimmed). The leading space (if present) is
 * preserved so the rendered overlay can place a non-breaking gap
 * between the pill and the user's args.
 *
 * Examples (with `goalCmd = { name: 'goal', source: 'system' }`):
 *   `/goal fix login`  → token: { name: 'goal', source: 'system' }, text: ' fix login'
 *   `/goal `           → token: { name: 'goal', source: 'system' }, text: ''
 *   `/goal`            → token: { name: 'goal', source: 'system' }, text: ''
 *   `/unknown abc`     → no token, text: '/unknown abc'
 *   `hello world`      → no token, text: 'hello world'
 *   `` (empty)         → no token, text: ''
 *   `/goal /foo bar`   → token: { name: 'goal', source: 'system' }, text: ' /foo bar'
 */
export function parseInputToTokens(
  text: string,
  registry: ReadonlyArray<SlashCommand>
): { token?: { name: string; source: CommandSource }; text: string } {
  if (!text.startsWith('/')) {
    return { text };
  }

  // Mirror the dispatcher's matcher exactly: a command matches when
  // the input is `/name` (end of input), `/name ` (command + trailing
  // space), or `/name <args>` (command + space + at least one arg char).
  const match = registry.find((c) => {
    const cmdPrefix = '/' + c.name;
    return (
      text === cmdPrefix ||
      text === cmdPrefix + ' ' ||
      text.startsWith(cmdPrefix + ' ')
    );
  });
  if (!match) {
    return { text };
  }

  // Strip the leading `/${match.name}` and return the raw tail. The slice
  // length depends on which matcher condition was hit:
  //   - `text === '/name'`             → slice len('/name')    → ''
  //   - `text === '/name '`            → slice len('/name ')   → ''
  //   - `text.startsWith('/name ')` (args follow) → slice len('/name')
  //     → ' <args>' (preserves the single leading space so the rendered
  //     overlay can place a non-breaking gap between the pill and the args).
  const cmdPrefix = '/' + match.name;
  const prefixLen = text === cmdPrefix || text === cmdPrefix + ' '
    ? text.length   // strip everything → ''
    : cmdPrefix.length;  // keep the leading space
  return {
    token: { name: match.name, source: match.source },
    text: text.slice(prefixLen),
  };
}
