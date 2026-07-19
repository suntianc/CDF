import type { GlobalSkillSourceKind, SkillSourceKind } from './skills';

const SKILL_REFERENCE_SOURCE_PREFIXES = [
  'project-nested',
  'project-additional',
  'project',
  'global',
  'built-in',
  'enterprise',
] as const;

export function skillReferenceToPreloadName(skillReference: string): string {
  const trimmed = skillReference.trim();
  if (!trimmed) return '';

  for (const sourcePrefix of SKILL_REFERENCE_SOURCE_PREFIXES) {
    const prefix = `${sourcePrefix}:`;
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length).trim();
  }
  return trimmed;
}

export function skillReferencesToPreloadNames(skillReferences: string[]): string[] {
  return skillReferences
    .map(skillReferenceToPreloadName)
    .filter((skillName): skillName is string => skillName.length > 0);
}

/** Canonical source-aware identity used to join a global Agent preload to a
 * resolved Skill (including an immutable Conversation catalog). */
export function globalSkillReferenceKey(
  sourceKind: GlobalSkillSourceKind,
  name: string,
): string {
  return `${sourceKind}:${name.trim()}`;
}

export function globalSkillReferenceToKey(reference: string): string | null {
  const trimmed = reference.trim();
  if (trimmed.startsWith('built-in:')) {
    const name = trimmed.slice('built-in:'.length).trim();
    return name ? globalSkillReferenceKey('built-in', name) : null;
  }
  if (trimmed.startsWith('global:')) {
    const name = trimmed.slice('global:'.length).trim();
    return name ? globalSkillReferenceKey('user', name) : null;
  }
  return null;
}

export function resolvedGlobalSkillKey(skill: {
  sourceKind: SkillSourceKind;
  name: string;
  qualifiedName?: string;
}): string | null {
  if (skill.sourceKind !== 'built-in' && skill.sourceKind !== 'user') return null;
  return globalSkillReferenceKey(skill.sourceKind, skill.qualifiedName ?? skill.name);
}
