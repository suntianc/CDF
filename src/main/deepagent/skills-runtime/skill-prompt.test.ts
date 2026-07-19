import { describe, expect, it } from 'vitest';
import { renderCdfSkillsPrompt } from './skill-prompt';
import type { ResolvedSkillCatalogEntry } from './skill-sources';

function skill(overrides: Partial<ResolvedSkillCatalogEntry> = {}): ResolvedSkillCatalogEntry {
  return {
    name: 'review',
    description: 'Review the project',
    sourceKind: 'project',
    sourcePath: '/project/.cdf/skills',
    skillPath: '/project/.cdf/skills/review/SKILL.md',
    modelDiscovery: 'full',
    userInvocable: true,
    ...overrides,
  };
}

describe('renderCdfSkillsPrompt', () => {
  it('renders full model-discoverable Project Skills by qualified name', () => {
    const prompt = renderCdfSkillsPrompt([
      skill({ qualifiedName: 'review' }),
      skill({
        qualifiedName: 'apps/web:review',
        sourceKind: 'project-additional',
        description: 'Review the web app',
        skillPath: '/project/apps/web/.cdf/skills/review/SKILL.md',
      }),
    ]);

    expect(prompt).toContain('**review**: Review the project');
    expect(prompt).toContain('**apps/web:review**: Review the web app');
  });

  it('keeps disable-model-invocation Skills out of model discovery', () => {
    const prompt = renderCdfSkillsPrompt([skill({
      name: 'manual-review',
      description: 'Explicit invocation only',
      modelDiscovery: 'hidden',
    })]);

    expect(prompt).not.toContain('manual-review');
    expect(prompt).not.toContain('Explicit invocation only');
  });

  it('preloads the full instructions of a selected discoverable Skill', () => {
    const prompt = renderCdfSkillsPrompt([skill()], {
      preloadSkillNames: ['review'],
      readSkill: () => '# Review\n\nPreloaded instructions',
    });

    expect(prompt).toContain('## Preloaded Skills');
    expect(prompt).toContain('Preloaded instructions');
  });
});
