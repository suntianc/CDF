/**
 * Phase 08.1 — D-05: Title-Case a slash command name for the inline token
 * label.
 *
 * Rule: first letter of every hyphen-separated segment is uppercased;
 * hyphens are preserved. Examples:
 *   `gsd-fast`              → `Gsd-Fast`
 *   `goal`                  → `Goal`
 *   `code-review`           → `Code-Review`
 *   `run-skill-generator`   → `Run-Skill-Generator`
 *
 * The rest of each segment is left unchanged. Slash command names in the
 * registry are already lowercase ASCII, so re-casing the rest would be a
 * behavior change the SPEC does not require.
 *
 * Edge cases:
 *   - Empty string passes through unchanged.
 *   - Trailing hyphen (e.g., `foo-`): the empty trailing segment passes
 *     through, so the result is `Foo-` (well-formed, no crash).
 */
export function formatTokenLabel(name: string): string {
  if (!name) return name;
  return name
    .split('-')
    .map((segment) => {
      if (!segment) return segment;
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join('-');
}
