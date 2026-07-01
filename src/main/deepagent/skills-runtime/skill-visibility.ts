import {
  parseSkillOverrideState,
  type SkillEffectiveVisibility,
  type SkillModelDiscovery,
  type SkillOverrideState,
  type SkillVisibilitySource,
} from '../../../shared/skill-overrides';

interface SkillVisibilityFrontmatter {
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
}

export interface SkillVisibilityInput {
  name: string;
  qualifiedName?: string;
  frontmatter?: SkillVisibilityFrontmatter;
  overrides?: {
    agent?: Record<string, unknown>;
    project?: Record<string, unknown>;
    user?: Record<string, unknown>;
  };
}

export interface ResolvedSkillVisibility {
  name: string;
  qualifiedName: string;
  visibility: SkillEffectiveVisibility;
  visibilitySource: SkillVisibilitySource;
  modelDiscovery: SkillModelDiscovery;
  userInvocable: boolean;
}

export const USER_SKILL_OVERRIDES_STORE_KEY = 'skillOverrides';
export const AGENT_SKILL_OVERRIDES_CONFIG_KEY = 'skillOverrides';

export function parseSkillOverrideRecord(raw: unknown): {
  overrides: Record<string, SkillOverrideState>;
  warnings: string[];
} {
  const overrides: Record<string, SkillOverrideState> = {};
  const warnings: string[] = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) {
      warnings.push(`Ignored invalid Skill override record: ${String(raw)}`);
    }
    return { overrides, warnings };
  }

  for (const [skillName, rawOverride] of Object.entries(raw)) {
    const override = parseSkillOverrideState(rawOverride);
    if (override) {
      overrides[skillName] = override;
    } else {
      warnings.push(`Ignored invalid Skill override for ${skillName}: ${String(rawOverride)}`);
    }
  }

  return { overrides, warnings };
}

export function readUserSkillOverrides(getValue: (key: string) => unknown): {
  overrides: Record<string, SkillOverrideState>;
  warnings: string[];
} {
  return parseSkillOverrideRecord(getValue(USER_SKILL_OVERRIDES_STORE_KEY));
}

export function readAgentSkillOverrides(config: unknown): {
  overrides: Record<string, SkillOverrideState>;
  warnings: string[];
} {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { overrides: {}, warnings: [] };
  }
  return parseSkillOverrideRecord(
    (config as Record<string, unknown>)[AGENT_SKILL_OVERRIDES_CONFIG_KEY]
  );
}

function flagsForVisibility(visibility: SkillEffectiveVisibility): {
  modelDiscovery: SkillModelDiscovery;
  userInvocable: boolean;
} {
  switch (visibility) {
    case 'on':
      return { modelDiscovery: 'full', userInvocable: true };
    case 'name-only':
      return { modelDiscovery: 'name-only', userInvocable: true };
    case 'user-invocable-only':
      return { modelDiscovery: 'hidden', userInvocable: true };
    case 'off':
      return { modelDiscovery: 'hidden', userInvocable: false };
    case 'model-only':
      return { modelDiscovery: 'full', userInvocable: false };
  }
}

function firstOverride(input: SkillVisibilityInput): {
  visibility: SkillOverrideState;
  source: SkillVisibilitySource;
} | null {
  const qualifiedName = input.qualifiedName ?? input.name;
  const candidates: Array<[SkillVisibilitySource, Record<string, unknown> | undefined]> = [
    ['agent', input.overrides?.agent],
    ['project', input.overrides?.project],
    ['user', input.overrides?.user],
  ];

  for (const [source, overrides] of candidates) {
    const visibility = parseSkillOverrideState(overrides?.[qualifiedName] ?? overrides?.[input.name]);
    if (visibility) return { visibility, source };
  }

  return null;
}

function frontmatterDefault(frontmatter?: SkillVisibilityFrontmatter): SkillEffectiveVisibility {
  if (frontmatter?.disableModelInvocation && frontmatter.userInvocable === false) return 'off';
  if (frontmatter?.disableModelInvocation) return 'user-invocable-only';
  // Model can still auto-discover the Skill, but the author blocked explicit
  // user invocation. This is `model-only`, not `on` — `on` must stay visible to
  // both model discovery and user invocation.
  if (frontmatter?.userInvocable === false) return 'model-only';
  return 'on';
}

export function resolveSkillVisibility(input: SkillVisibilityInput): ResolvedSkillVisibility {
  const override = firstOverride(input);
  const visibility = override?.visibility ?? frontmatterDefault(input.frontmatter);
  const source = override?.source ?? (
    input.frontmatter?.disableModelInvocation || input.frontmatter?.userInvocable === false
      ? 'frontmatter'
      : 'default'
  );
  const flags = flagsForVisibility(visibility);

  return {
    name: input.name,
    qualifiedName: input.qualifiedName ?? input.name,
    visibility,
    visibilitySource: source,
    modelDiscovery: flags.modelDiscovery,
    // `flags` already reflects the effective visibility (including the
    // frontmatter-derived `model-only`), so it is the single source of truth
    // for user-invocation availability.
    userInvocable: flags.userInvocable,
  };
}
