export const SKILL_OVERRIDE_STATES = [
  'on',
  'name-only',
  'user-invocable-only',
  'off',
] as const;

export type SkillOverrideState = typeof SKILL_OVERRIDE_STATES[number];

/**
 * Effective, resolved visibility of a Skill. Supersets the four settable
 * override states with `model-only`: a Skill whose author marked it
 * `userInvocable: false` (without disabling model invocation) stays fully
 * discoverable by the model but cannot be explicitly invoked by the user.
 * `model-only` is resolution/presentation-only — users cannot set it as an
 * override, so {@link SKILL_OVERRIDE_STATES} and {@link parseSkillOverrideState}
 * intentionally keep the four-state vocabulary.
 */
export type SkillEffectiveVisibility = SkillOverrideState | 'model-only';

export type SkillVisibilitySource =
  | 'agent'
  | 'project'
  | 'user'
  | 'frontmatter'
  | 'default';

export type SkillModelDiscovery = 'full' | 'name-only' | 'hidden';

export function parseSkillOverrideState(value: unknown): SkillOverrideState | null {
  return typeof value === 'string' &&
    (SKILL_OVERRIDE_STATES as readonly string[]).includes(value)
    ? value as SkillOverrideState
    : null;
}
