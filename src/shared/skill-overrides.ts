export const SKILL_OVERRIDE_STATES = [
  'on',
  'name-only',
  'user-invocable-only',
  'off',
] as const;

export type SkillOverrideState = typeof SKILL_OVERRIDE_STATES[number];

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
