import { describe, expect, it } from 'vitest';
import { renderCdfSkillsPrompt } from './skill-prompt';
import type { ResolvedSkillCatalogEntry } from './skill-sources';

function skill(overrides: Partial<ResolvedSkillCatalogEntry>): ResolvedSkillCatalogEntry {
  return {
    name: 'review',
    description: 'Full review description',
    sourceKind: 'project',
    sourcePath: '/project/.cdf/skills',
    skillPath: '/project/.cdf/skills/review/SKILL.md',
    visibility: 'on',
    visibilitySource: 'default',
    modelDiscovery: 'full',
    userInvocable: true,
    ...overrides,
  };
}

describe('renderCdfSkillsPrompt', () => {
  it('renders name-only skills without leaking description text or instruction paths', () => {
    const prompt = renderCdfSkillsPrompt([
      skill({
        name: 'secret-review',
        description: 'Sensitive review trigger: internal incident response',
        skillPath: '/project/.cdf/skills/secret-review/SKILL.md',
        visibility: 'name-only',
        visibilitySource: 'project',
        modelDiscovery: 'name-only',
      }),
    ]);

    expect(prompt).toContain('secret-review');
    expect(prompt).toContain('name-only');
    expect(prompt).not.toContain('/project/.cdf/skills/secret-review/SKILL.md');
    expect(prompt).not.toContain('secret-review/SKILL.md');
    expect(prompt).not.toContain('Sensitive review trigger');
    expect(prompt).not.toContain('internal incident response');
  });

  it('omits user-invocable-only and off skills from model discovery output', () => {
    const prompt = renderCdfSkillsPrompt([
      skill({
        name: 'manual-only',
        description: 'Only a user slash invocation should reveal this',
        skillPath: '/project/.cdf/skills/manual-only/SKILL.md',
        visibility: 'user-invocable-only',
        visibilitySource: 'project',
        modelDiscovery: 'hidden',
        userInvocable: true,
      }),
      skill({
        name: 'disabled-skill',
        description: 'Disabled skill details',
        skillPath: '/project/.cdf/skills/disabled-skill/SKILL.md',
        visibility: 'off',
        visibilitySource: 'agent',
        modelDiscovery: 'hidden',
        userInvocable: false,
      }),
    ]);

    expect(prompt).not.toContain('manual-only');
    expect(prompt).not.toContain('disabled-skill');
    expect(prompt).not.toContain('Only a user slash invocation');
    expect(prompt).not.toContain('Disabled skill details');
  });

  it('uses qualified names for coexisting skills in model discovery output', () => {
    const prompt = renderCdfSkillsPrompt([
      skill({
        name: 'deploy',
        qualifiedName: 'deploy',
        description: 'Deploy the whole project',
        skillPath: '/project/.cdf/skills/deploy/SKILL.md',
      }),
      skill({
        name: 'deploy',
        qualifiedName: 'apps/web:deploy',
        qualifier: 'apps/web',
        description: 'Deploy the web app',
        sourceKind: 'project-additional',
        sourcePath: '/project/apps/web/.cdf/skills',
        skillPath: '/project/apps/web/.cdf/skills/deploy/SKILL.md',
      }),
    ]);

    expect(prompt).toContain('**deploy**: Deploy the whole project');
    expect(prompt).toContain('**apps/web:deploy**: Deploy the web app');
  });

  it('includes full instructions for preloaded skills whose effective visibility is on', () => {
    const prompt = renderCdfSkillsPrompt(
      [
        skill({
          name: 'review',
          description: 'Review description',
          skillPath: '/project/.cdf/skills/review/SKILL.md',
        }),
      ],
      {
        preloadSkillNames: ['review'],
        readSkill: () => '# Review\n\nFull preloaded instructions',
      }
    );

    expect(prompt).toContain('## Preloaded Skills');
    expect(prompt).toContain('review');
    expect(prompt).toContain('Full preloaded instructions');
  });

  it('does not preload full instructions for skills hidden by effective visibility', () => {
    const prompt = renderCdfSkillsPrompt(
      [
        skill({
          name: 'name-only-review',
          description: 'Name only description must stay hidden',
          skillPath: '/project/.cdf/skills/name-only-review/SKILL.md',
          visibility: 'name-only',
          visibilitySource: 'agent',
          modelDiscovery: 'name-only',
          userInvocable: true,
        }),
        skill({
          name: 'manual-only',
          description: 'Manual only description must stay hidden',
          skillPath: '/project/.cdf/skills/manual-only/SKILL.md',
          visibility: 'user-invocable-only',
          visibilitySource: 'agent',
          modelDiscovery: 'hidden',
          userInvocable: true,
        }),
      ],
      {
        preloadSkillNames: ['name-only-review', 'manual-only'],
        readSkill: () => '# Hidden Skill\n\nHidden full instructions',
      }
    );

    expect(prompt).toContain('name-only-review');
    expect(prompt).toContain('name-only');
    expect(prompt).not.toContain('Name only description must stay hidden');
    expect(prompt).not.toContain('Manual only description must stay hidden');
    expect(prompt).not.toContain('## Preloaded Skills');
    expect(prompt).not.toContain('manual-only');
    expect(prompt).not.toContain('Hidden full instructions');
  });
});
