/**
 * Pure string substitution for /command body placeholders.
 *
 * Supported placeholders (per CONTEXT.md D-02 / Claude Code alignment):
 *   - $ARGUMENTS → entire args string verbatim (整串替换; CJK 不转义)
 *   - $0, $1, $2, ... → positional args (whitespace-split, 0-indexed)
 *   - $name → named arg, ONLY when `name` is declared in frontmatter
 *            `arguments: [name1, name2, ...]`. Undeclared $name stays intact.
 *
 * No eval, no flag parsing, no template-string code construction (V10
 * malicious code). The function is a sequence of `String.prototype.replace*`
 * + `RegExp.exec` calls only.
 *
 * Example:
 *   body = "请部署到 $0，参数：$ARGUMENTS，附加：$extra"
 *   args = "production --force 顺带更新 changelog"
 *   arguments = ["extra"]   // frontmatter `arguments: [extra]`
 *   → "请部署到 production，参数：production --force 顺带更新 changelog，附加：顺带更新"
 *
 * Note: $0 is the FIRST positional arg (not the command name — the command
 * name is stripped by the dispatcher before substitution).
 */
export interface ArgSubstitutionContext {
  /** Raw args string after the command name (e.g. "production --force 顺带更新 changelog"). */
  args: string;
  /** Optional: frontmatter `arguments: [name1, name2, ...]`. Names declared here
   *  are looked up by their positional index in the split args. */
  arguments?: string[];
}

const POSITIONAL_RE = /\$(\d+)/g;
// Identifier-style: starts with letter or underscore, followed by letters/digits/underscore.
const NAMED_RE = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;

export function substituteArgs(body: string, ctx: ArgSubstitutionContext): string {
  // Step 0: split args once for positional/named lookup. Use trim() + filter to
  // handle leading/trailing/double whitespace. PITFALLS P7: NEVER use eval or
  // Function on ctx.args.
  const positional = ctx.args.trim().split(/\s+/).filter(Boolean);

  // Step a: $ARGUMENTS — entire args string verbatim
  let out = body.replaceAll('$ARGUMENTS', ctx.args);

  // Step b: $0 / $1 / $N — positional; out-of-range leaves the literal intact
  out = out.replace(POSITIONAL_RE, (match, idxStr) => {
    const idx = parseInt(idxStr, 10);
    return positional[idx] ?? match;
  });

  // Step c: $name — only when ctx.arguments is non-empty. Build the name→value
  // map first, then substitute declared names. Undeclared $name stays intact.
  if (ctx.arguments && ctx.arguments.length > 0) {
    const named: Record<string, string> = {};
    ctx.arguments.forEach((name, i) => {
      named[name] = positional[i] ?? '';
    });
    out = out.replace(NAMED_RE, (match, name) => {
      if (Object.prototype.hasOwnProperty.call(named, name)) {
        return named[name];
      }
      return match; // undeclared — keep literal
    });
  }

  return out;
}
