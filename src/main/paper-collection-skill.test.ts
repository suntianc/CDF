import { describe, expect, it } from 'vitest';
import {
  getPaperCollectionSkillMarkdown,
  getPaperCollectionSkillResources,
} from './paper-collection-skill';

describe('Paper Collection Skill', () => {
  it('describes import-only Mode A and Mode B workflows with compliance guardrails', () => {
    const markdown = getPaperCollectionSkillMarkdown({
      cliPath: '/tmp/cdf-built-in-skills/paper-collection/runtime/paper-search.cjs',
    });
    const frontmatter = markdown.slice(0, markdown.indexOf('---', 4));

    expect(markdown).toContain('paper-collection');
    expect(markdown).toContain('Paper Collection Skill');
    expect(frontmatter).not.toMatch(/\bsearch\b/i);
    expect(markdown).toContain('Mode A');
    expect(markdown).toContain('<projectPath>/.cdf/paper-collection-cache/latest.json');
    expect(markdown).toContain('tell the user to run Paper Search first');
    expect(markdown).toContain('cached search has no candidates');
    expect(markdown).toContain('Do not call `journal-metrics`');
    expect(markdown).toContain('Mode B');
    expect(markdown).toContain('resolvePaperPdfResourcePath');
    expect(markdown).toContain('reconcile with that cached candidate');
    expect(markdown).toContain('30 分钟');
    expect(markdown).toContain('date -u +%Y-%m-%dT%H:%M:%SZ');
    expect(markdown).toContain('consumedAt');
    expect(markdown).toContain('禁止编造时间');
    expect(markdown).toContain('Only write the schema fields');
    expect(markdown).toContain('Do not add extra fields');
    expect(markdown).toContain('papers/<slug>.md');
    expect(markdown).toContain('papers/<slug>.pdf');
    expect(markdown).toContain('knowledge_search');
    expect(markdown).toContain('knowledge_create');
    expect(markdown).toContain('Do not enable Sci-Hub');
    expect(markdown).toContain('Do not create a second Paper Entry');
    expect(markdown).toContain('/tmp/cdf-built-in-skills/paper-collection/runtime/paper-search.cjs');
    expect(markdown).not.toMatch(/`\/paper-collection-cache\//);
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
        download: expect.stringContaining('download <paper-id>'),
      },
      cache: {
        latest: '<projectPath>/.cdf/paper-collection-cache/latest.json',
        index: '<projectPath>/.cdf/paper-collection-cache/index.json',
      },
    });
    expect(JSON.stringify(JSON.parse(resources[0].content).cache)).not.toMatch(/"\/paper-collection-cache\//);
    expect(JSON.stringify(JSON.parse(resources[0].content).commands)).not.toContain('journal-metrics');
    expect(JSON.stringify(JSON.parse(resources[0].content).commands)).not.toContain('search "<query>"');
  });
});
