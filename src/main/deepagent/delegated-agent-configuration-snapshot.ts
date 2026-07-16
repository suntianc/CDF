import type { CatalogAgent } from '../agent-catalog';
import type { ConversationSkillSnapshotEntry } from '../../shared/skills';
import {
  globalSkillReferenceToKey,
  resolvedGlobalSkillKey,
} from '../../shared/skill-identifiers';

/**
 * Per-run, process-lifetime configuration captured before a delegated run is
 * persisted and queued. It deliberately has no database representation.
 */
export interface DelegatedAgentConfigurationSnapshot {
  target: CatalogAgent;
  mcpServerExclusionIds: string[];
  globalSkillPreloadRefs: string[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

export function captureDelegatedAgentConfigurationSnapshot(input: {
  /** Current Catalog configuration resolved when the Delegated Agent Run is created. */
  target: CatalogAgent;
  /** Stable identity exposed by this root Agent Run's Delegation Target Set. */
  targetIdentity?: Pick<CatalogAgent, 'id' | 'role' | 'name' | 'slug' | 'description'>;
  mcpServerExclusionIds: readonly string[];
  skillNames: readonly string[];
  conversationSkillSnapshot: readonly ConversationSkillSnapshotEntry[];
}): DelegatedAgentConfigurationSnapshot {
  const availableGlobalSkillKeys = new Set(
    input.conversationSkillSnapshot
      .map(resolvedGlobalSkillKey)
      .filter((key): key is string => key !== null),
  );
  const globalSkillPreloadRefs = [...new Set(input.skillNames
    .filter((reference) => {
      const key = globalSkillReferenceToKey(reference);
      return key !== null && availableGlobalSkillKeys.has(key);
    })
    .map((reference) => reference.trim()))];

  const target = clone(input.target);
  if (input.targetIdentity) {
    target.id = input.targetIdentity.id;
    target.role = input.targetIdentity.role;
    target.name = input.targetIdentity.name;
    target.slug = input.targetIdentity.slug;
    target.description = input.targetIdentity.description;
  }

  return freeze({
    target,
    mcpServerExclusionIds: [...new Set(input.mcpServerExclusionIds)],
    globalSkillPreloadRefs,
  });
}
