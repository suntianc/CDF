import { describe, expect, it } from 'vitest';
import {
  AGENT_SKILL_OVERRIDES_CONFIG_KEY,
  readUserSkillOverrides,
  USER_SKILL_OVERRIDES_STORE_KEY,
  parseSkillOverrideRecord,
  readAgentSkillOverrides,
  resolveSkillVisibility,
} from './skill-visibility';

describe('resolveSkillVisibility', () => {
  it('uses agent overrides before project, user, and frontmatter defaults', () => {
    const resolved = resolveSkillVisibility({
      name: 'review',
      frontmatter: {
        disableModelInvocation: true,
        userInvocable: false,
      },
      overrides: {
        user: {
          review: 'on',
        },
        project: {
          review: 'off',
        },
        agent: {
          review: 'name-only',
        },
      },
    });

    expect(resolved).toMatchObject({
      name: 'review',
      qualifiedName: 'review',
      visibility: 'name-only',
      visibilitySource: 'agent',
      modelDiscovery: 'name-only',
      userInvocable: true,
    });
  });

  it('treats on as an explicit override that can re-enable lower-layer restrictions', () => {
    const resolved = resolveSkillVisibility({
      name: 'review',
      frontmatter: {
        disableModelInvocation: true,
        userInvocable: false,
      },
      overrides: {
        user: {
          review: 'off',
        },
        project: {
          review: 'off',
        },
        agent: {
          review: 'on',
        },
      },
    });

    expect(resolved).toMatchObject({
      visibility: 'on',
      visibilitySource: 'agent',
      modelDiscovery: 'full',
      userInvocable: true,
    });
  });

  it('parses override records by keeping only valid four-state values', () => {
    const result = parseSkillOverrideRecord({
      review: 'off',
      deploy: 'user-invocable-only',
      broken: 'sometimes',
      nested: {
        state: 'off',
      },
    });

    expect(result.overrides).toEqual({
      review: 'off',
      deploy: 'user-invocable-only',
    });
    expect(result.warnings.join('\n')).toContain('broken');
    expect(result.warnings.join('\n')).toContain('sometimes');
    expect(result.warnings.join('\n')).toContain('nested');
  });

  it('reads user/global overrides from the local store key', () => {
    const requestedKeys: string[] = [];

    const result = readUserSkillOverrides((key) => {
      requestedKeys.push(key);
      return {
        review: 'name-only',
        broken: 'never',
      };
    });

    expect(requestedKeys).toEqual([USER_SKILL_OVERRIDES_STORE_KEY]);
    expect(result.overrides).toEqual({
      review: 'name-only',
    });
    expect(result.warnings.join('\n')).toContain('broken');
  });

  it('reads agent overrides from agents.config without using agent skill preload rows', () => {
    const result = readAgentSkillOverrides({
      [AGENT_SKILL_OVERRIDES_CONFIG_KEY]: {
        review: 'off',
        deploy: 'on',
        broken: 'ask-first',
      },
      skillNames: ['global:review'],
    });

    expect(result.overrides).toEqual({
      review: 'off',
      deploy: 'on',
    });
    expect(result.warnings.join('\n')).toContain('broken');
  });

  it('maps disable-model-invocation frontmatter to explicit-invocation-only visibility', () => {
    const resolved = resolveSkillVisibility({
      name: 'secret-review',
      frontmatter: {
        disableModelInvocation: true,
      },
    });

    expect(resolved).toMatchObject({
      visibility: 'user-invocable-only',
      visibilitySource: 'frontmatter',
      modelDiscovery: 'hidden',
      userInvocable: true,
    });
  });

  it('keeps model discovery while removing explicit invocation for user-invocable false', () => {
    const resolved = resolveSkillVisibility({
      name: 'auto-only',
      frontmatter: {
        userInvocable: false,
      },
    });

    expect(resolved).toMatchObject({
      visibility: 'on',
      visibilitySource: 'frontmatter',
      modelDiscovery: 'full',
      userInvocable: false,
    });
  });
});
