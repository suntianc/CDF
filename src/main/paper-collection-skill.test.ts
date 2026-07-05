import { describe, expect, it } from 'vitest';
import {
  getPaperCollectionSkillMarkdown,
  getPaperCollectionSkillResources,
} from './paper-collection-skill';

describe('Paper Collection Skill', () => {
  it('describes the arXiv-first paper collection workflow and compliance guardrails', () => {
    const markdown = getPaperCollectionSkillMarkdown({
      cliPath: '/tmp/cdf-built-in-skills/paper-collection/runtime/paper-search.cjs',
    });

    expect(markdown).toContain('paper-collection');
    expect(markdown).toContain('Paper Collection Skill');
    expect(markdown).toContain('arXiv tools first');
    expect(markdown).toContain('paper-search search');
    expect(markdown).toContain('paper-search journal-metrics');
    expect(markdown).toContain('paper-search download');
    expect(markdown).toContain('papers/<slug>.md');
    expect(markdown).toContain('papers/<slug>.pdf');
    expect(markdown).toContain('knowledge_search');
    expect(markdown).toContain('knowledge_create');
    expect(markdown).toContain('query each journal once');
    expect(markdown).toContain('Do not enable Sci-Hub');
    expect(markdown).toContain('Do not create a second Paper Entry');
    expect(markdown).toContain('/tmp/cdf-built-in-skills/paper-collection/runtime/paper-search.cjs');
  });

  it('publishes a compact entrypoint manifest for the bundled CLI', () => {
    const resources = getPaperCollectionSkillResources({
      cliPath: '/tmp/skill/runtime/paper-search.cjs',
    });

    expect(resources).toEqual([
      {
        relativePath: 'entrypoints.json',
        content: expect.stringContaining('/tmp/skill/runtime/paper-search.cjs'),
      },
    ]);
    expect(JSON.parse(resources[0].content)).toMatchObject({
      commands: {
        search: expect.stringContaining('search "<query>"'),
        journalMetrics: expect.stringContaining('journal-metrics "<journal>"'),
        download: expect.stringContaining('download <paper-id>'),
      },
    });
  });
});
