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
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }

  return trimmed;
}

export function skillReferencesToPreloadNames(skillReferences: string[]): string[] {
  return skillReferences
    .map(skillReferenceToPreloadName)
    .filter((skillName): skillName is string => skillName.length > 0);
}
