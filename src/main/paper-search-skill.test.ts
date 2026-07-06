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
    expect(markdown).toContain('<projectPath>/.cdf/paper-collection-cache/latest.json');
    expect(markdown).toContain('<projectPath>/.cdf/paper-collection-cache/index.json');
    expect(markdown).toContain('30 minutes');
    expect(markdown).toContain('30 分钟');
    expect(markdown).toContain('read `<projectPath>/.cdf/paper-collection-cache/latest.json`');
    expect(markdown).toContain('If `consumedAt` is missing or the elapsed time is under 30 minutes');
    expect(markdown).toContain('overwrite `latest.json` without archiving');
    expect(markdown).toContain('date -u +%Y-%m-%dT%H:%M:%SZ');
    expect(markdown).toContain('searchedAt');
    expect(markdown).toContain('consumedAt');
    expect(markdown).toContain('禁止编造时间');
    expect(markdown).toContain('Only write the schema fields');
    expect(markdown).toContain('Do not add extra fields');
    expect(markdown).toContain('pdfAccess');
    expect(markdown).toContain('open | paywalled | unknown');
    expect(markdown).toContain('no results were found');
    expect(markdown).toContain('paid or has no open PDF');
    expect(markdown).toContain('original error');
    expect(markdown).toContain('stop. Wait for the user');
    expect(markdown).not.toContain('paper-search download');
    expect(markdown).not.toMatch(/`\/paper-collection-cache\//);
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

  it('describes journal metrics key detection without leaking config secrets', () => {
    const markdown = getPaperSearchSkillMarkdown({
      cliPath: '/tmp/cdf-built-in-skills/paper-search/runtime/paper-search.cjs',
    });

    expect(markdown).toContain('config list --pretty');
    expect(markdown).toContain('configured');
    expect(markdown).toContain('masked');
    expect(markdown).toContain('Do not run `config get`');
    expect(markdown).toContain('Do not run `config set` or `config unset`');
    expect(markdown).toContain('先试、按失败处理');
    expect(markdown).toContain('预印本无期刊指标');
  });

  it('requires enrichment before presenting and caching search candidates', () => {
    const markdown = getPaperSearchSkillMarkdown({
      cliPath: '/tmp/cdf-built-in-skills/paper-search/runtime/paper-search.cjs',
    });

    expect(markdown).toContain('## Enrichment');
    expect(markdown).toContain('After platform discovery and before presenting candidates or writing cache');
    expect(markdown).toContain('run `node "/tmp/cdf-built-in-skills/paper-search/runtime/paper-search.cjs" run get_paper_by_doi --json-args');
    expect(markdown).toContain('fill `journal`, `volume`, `issue`, `pages`, and `year` from the `data.papers` entry whose `source` is `crossref`');
    expect(markdown).toContain('fall back to another source entry with a non-empty `journal`');
    expect(markdown).toContain('search "<title>" --sources crossref --max-results 3');
    expect(markdown).toContain('strict title match');
    expect(markdown).toContain('ignoring case and punctuation');
    expect(markdown).toContain('For every non-empty enriched journal name');
    expect(markdown).toContain('Present enriched candidates with the journal name and available metrics');
    expect(markdown).toContain('arXiv 预印本,未见正式发表版本');
    expect(markdown).toContain('Do not let one enrichment source timeout or failure block the whole candidate list');
  });

  it('publishes search and journal metrics entrypoints without a download command', () => {
    const resources = getPaperSearchSkillResources({
      cliPath: '/tmp/skill/runtime/paper-search.cjs',
    });
    const manifest = JSON.parse(resources[0].content);

    expect(manifest.commands).toMatchObject({
      searchArxiv: expect.stringContaining('search "<query>"'),
      searchRegistries: expect.stringContaining('crossref,openalex'),
      enrichDoi: expect.stringContaining('run get_paper_by_doi --json-args'),
      configList: expect.stringContaining('config list --pretty'),
      journalMetrics: expect.stringContaining('journal-metrics "<journal>"'),
    });
    expect(manifest.commands.enrichDoi).toContain('{"doi":"<doi>"}');
    expect(JSON.stringify(manifest.commands)).not.toContain('download');
    expect(JSON.stringify(manifest.commands)).not.toContain('config get');
    expect(JSON.stringify(manifest.cache)).not.toMatch(/"\/paper-collection-cache\//);
    expect(manifest.cache.candidateFields).toEqual([...PAPER_SEARCH_CANDIDATE_FIELDS]);
  });
});
