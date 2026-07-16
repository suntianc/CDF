import { describe, expect, it } from 'vitest';
import type { CatalogAgent } from '../agent-catalog';
import { captureDelegatedAgentConfigurationSnapshot } from './delegated-agent-configuration-snapshot';

const target: CatalogAgent = {
  id: 'custom-1', role: 'custom', name: 'Researcher', slug: 'researcher',
  description: 'original', provider_id: 'provider-1', system_prompt: 'original prompt',
  config: { toolScope: { mode: 'narrow', builtInTools: ['read_file'] } },
  mcpServerExclusionIds: [], skillNames: [],
  created_at: 1, updated_at: 1,
};

describe('DelegatedAgentConfigurationSnapshot', () => {
  it('freezes identity/configuration and intersects Global Skill preload by source identity', () => {
    const mutableTarget = structuredClone(target);
    const snapshot = captureDelegatedAgentConfigurationSnapshot({
      target: mutableTarget,
      mcpServerExclusionIds: ['mcp-private'],
      skillNames: ['built-in:review', 'global:review', 'built-in:missing'],
      conversationSkillSnapshot: [
        { name: 'review', qualifiedName: 'review', sourceKind: 'built-in', sourcePath: '/builtin', skillPath: '/builtin/review', description: '', modelDiscovery: 'full', userInvocable: false },
        { name: 'review', qualifiedName: 'review', sourceKind: 'user', sourcePath: '/global', skillPath: '/global/review', description: '', modelDiscovery: 'full', userInvocable: false },
      ],
    });

    mutableTarget.name = 'renamed after queue';
    (mutableTarget.config!.toolScope as { builtInTools: string[] }).builtInTools.push('write_file');

    expect(snapshot.target).toMatchObject({ name: 'Researcher', system_prompt: 'original prompt' });
    expect(snapshot.target.config).toEqual({ toolScope: { mode: 'narrow', builtInTools: ['read_file'] } });
    expect(snapshot.mcpServerExclusionIds).toEqual(['mcp-private']);
    expect(snapshot.globalSkillPreloadRefs).toEqual(['built-in:review', 'global:review']);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('combines the root-run stable target identity with configuration current at run creation', () => {
    const snapshot = captureDelegatedAgentConfigurationSnapshot({
      target: {
        ...target,
        name: 'Renamed Researcher',
        slug: 'renamed-researcher',
        system_prompt: 'prompt edited after the root run started',
        config: { model: 'new-model' },
      },
      targetIdentity: {
        id: target.id,
        role: target.role,
        name: target.name,
        slug: target.slug,
        description: target.description,
      },
      mcpServerExclusionIds: [],
      skillNames: [],
      conversationSkillSnapshot: [],
    });

    expect(snapshot.target).toMatchObject({
      id: 'custom-1',
      name: 'Researcher',
      slug: 'researcher',
      system_prompt: 'prompt edited after the root run started',
      config: { model: 'new-model' },
    });
  });
});
