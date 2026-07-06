import { describe, expect, it } from 'vitest';
import {
  getPaperSearchSkillMarkdown,
  getPaperSearchSkillResources,
  PAPER_SEARCH_CANDIDATE_FIELDS,
} from './paper-search-skill';

describe('Paper Search Skill', () => {
  it('describes search-only discovery, cache writing, and failure semantics', () => {
    const markdown = getPaperSearchSkillMarkdown({
      cliPath: '/tmp/cdf-built-in-skills/paper-search/runtime/paper-search.cjs',
    });

    expect(markdown).toContain('name: paper-search');
    expect(markdown).toContain('Search for candidate papers');
    expect(markdown).toContain('paper-search.cjs');
    expect(markdown).toContain('journal-metrics');
    expect(markdown).toContain('/paper-collection-cache/latest.json');
    expect(markdown).toContain('/paper-collection-cache/index.json');
    expect(markdown).toContain('30 minutes');
    expect(markdown).toContain('30 分钟');
    expect(markdown).toContain('read `/paper-collection-cache/latest.json`');
    expect(markdown).toContain('If `consumedAt` is missing or the elapsed time is under 30 minutes');
    expect(markdown).toContain('overwrite `latest.json` without archiving');
    expect(markdown).toContain('pdfAccess');
    expect(markdown).toContain('open | paywalled | unknown');
    expect(markdown).toContain('no results were found');
    expect(markdown).toContain('paid or has no open PDF');
    expect(markdown).toContain('original error');
    expect(markdown).toContain('stop. Wait for the user');
    expect(markdown).not.toContain('paper-search download');
  });

  it('publishes the candidate field contract used by the Paper Library panel', () => {
    expect(PAPER_SEARCH_CANDIDATE_FIELDS).toEqual([
      'title',
      'authors',
      'abstract',
      'journal',
      'volume',
      'issue',
      'pages',
      'year',
      'doi',
      'journalMetrics',
      'pdfAccess',
    ]);
  });

  it('publishes search and journal metrics entrypoints without a download command', () => {
    const resources = getPaperSearchSkillResources({
      cliPath: '/tmp/skill/runtime/paper-search.cjs',
    });
    const manifest = JSON.parse(resources[0].content);

    expect(manifest.commands).toMatchObject({
      searchArxiv: expect.stringContaining('search "<query>"'),
      searchRegistries: expect.stringContaining('crossref,openalex'),
      journalMetrics: expect.stringContaining('journal-metrics "<journal>"'),
    });
    expect(JSON.stringify(manifest.commands)).not.toContain('download');
    expect(manifest.cache.candidateFields).toEqual([...PAPER_SEARCH_CANDIDATE_FIELDS]);
  });
});
