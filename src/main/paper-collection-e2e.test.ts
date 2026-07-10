import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createKnowledgeEntry,
  getKnowledgeBaseRoot,
  listKnowledgeEntries,
  resolvePaperPdfResourcePath,
  searchKnowledgeEntries,
} from './knowledge-base';
import { materializePaperSearchRuntime } from './deepagent/skill-manager';
import {
  appendToIndex,
  createInMemoryPaperCollectionThreadState,
  markLatestConsumed,
  maybeArchive,
  readArchive,
  readIndex,
  readLatest,
  writeLatest,
  type PaperCollectionCachePayload,
} from './paper-collection-cache';

function writeFakePaperSearchCli(cliPath: string): void {
  fs.writeFileSync(cliPath, [
    '#!/usr/bin/env node',
    "const fs = require('fs');",
    "const path = require('path');",
    'const args = process.argv.slice(2);',
    "if (args[0] === 'search') {",
    "  const query = args[1] || '';",
    "  const paper = query.includes('needs-enrichment') ? {",
    "    id: '1706.03762v7',",
    "    title: 'Attention Is All You Need',",
    "    authors: ['Ashish Vaswani', 'Noam Shazeer'],",
    "    source: 'arxiv',",
    "    year: 2017,",
    "    doi: '10.48550/arXiv.1706.03762',",
    "    pdfUrl: 'https://arxiv.org/pdf/1706.03762v7',",
    "  } : query.includes('download-fails') ? {",
    "    id: 'download-fails',",
    "    title: 'Download Fails Paper',",
    "    authors: ['Grace Hopper'],",
    "    source: 'arxiv',",
    "    journal: 'arXiv',",
    "    year: 2024,",
    "    pdfUrl: 'https://arxiv.org/pdf/download-fails',",
    "  } : {",
    "    id: '1706.03762v7',",
    "    title: 'Attention Is All You Need',",
    "    authors: ['Ashish Vaswani', 'Noam Shazeer'],",
    "    source: 'arxiv',",
    "    journal: 'Advances in Neural Information Processing Systems',",
    "    volume: '30',",
    "    pages: '5998-6008',",
    "    year: 2017,",
    "    doi: '10.48550/arXiv.1706.03762',",
    "    pdfUrl: 'https://arxiv.org/pdf/1706.03762v7',",
    "  };",
    "  process.stdout.write(JSON.stringify({ ok: true, papers: [paper], text: 'Found 1 papers' }));",
    '  process.exit(0);',
    '}',
    "if (args[0] === 'run' && args[1] === 'get_paper_by_doi') {",
    "  const jsonArgs = args[args.indexOf('--json-args') + 1] || '{}';",
    '  const parsed = JSON.parse(jsonArgs);',
    "  if (parsed.doi === '10.48550/arXiv.1706.03762') {",
    '    process.stdout.write(JSON.stringify({',
    '      ok: true,',
    "      tool: 'get_paper_by_doi',",
    "      message: 'Found DOI metadata',",
    '      data: {',
    "        doi: '10.48550/arXiv.1706.03762',",
    "        sources_used: ['crossref', 'openalex'],",
    '        papers: [',
    '          {',
    "            title: 'Attention Is All You Need',",
    "            source: 'crossref',",
    "            journal: 'Advances in Neural Information Processing Systems',",
    "            volume: '30',",
    "            issue: '',",
    "            pages: '5998-6008',",
    '            year: 2017,',
    "            doi: '10.48550/arXiv.1706.03762'",
    '          },',
    '          {',
    "            title: 'Attention Is All You Need',",
    "            source: 'openalex',",
    "            journal: '',",
    "            volume: '',",
    "            issue: '',",
    "            pages: '',",
    '            year: 2017,',
    "            doi: '10.48550/arXiv.1706.03762'",
    '          }',
    '        ],',
    "        failed_sources: ['pubmed'],",
    "        errors: { pubmed: 'timed out' }",
    '      },',
    "      diagnostic: { severity: 'warning', summary: 'Some requested sources failed: pubmed' }",
    '    }));',
    '    process.exit(0);',
    '  }',
    "  process.stderr.write(JSON.stringify({ ok: false, error: 'DOI not found' }));",
    '  process.exit(4);',
    '}',
    "if (args[0] === 'download') {",
    '  const paperId = args[1];',
    "  if (paperId === 'download-fails') {",
    "    process.stderr.write(JSON.stringify({ ok: false, error: 'PDF unavailable' }));",
    '    process.exit(3);',
    '  }',
    "  const savePath = args[args.indexOf('--save-path') + 1];",
    "  const slug = paperId.replace(/v\\d+$/, '');",
    '  fs.mkdirSync(savePath, { recursive: true });',
    "  const filePath = path.join(savePath, `${slug}.pdf`);",
    "  fs.writeFileSync(filePath, '%PDF-1.4\\n%%EOF\\n');",
    '  process.stdout.write(JSON.stringify({ ok: true, path: filePath }));',
    '  process.exit(0);',
    '}',
    "if (args[0] === 'journal-metrics') {",
    "  const journal = args[1] || '';",
    '  const countFile = process.env.CDF_FAKE_METRICS_COUNT_FILE;',
    '  if (countFile) {',
    "    const current = fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, 'utf-8')) : 0;",
    "    fs.writeFileSync(countFile, String(current + 1));",
    '  }',
    '  process.stdout.write(JSON.stringify({',
    '    ok: true,',
    '    data: [{',
    '      journal,',
    '      impactFactor: 12.5,',
    "      casTier: '1区',",
    "      jcrQuartile: 'Q1',",
    "      indexing: ['SCI', 'EI'],",
    '      year: 2025,',
    "      source: 'easyScholar'",
    '    }]',
    '  }));',
    '  process.exit(0);',
    '}',
    "process.stderr.write('unsupported command');",
    'process.exit(1);',
  ].join('\n'), 'utf-8');
  fs.chmodSync(cliPath, 0o755);
}

function materializeFakePaperSearchCli(projectPath: string): string {
  const compiledDir = path.join(projectPath, 'compiled-paper-search');
  fs.mkdirSync(compiledDir, { recursive: true });
  const compiledCliPath = path.join(compiledDir, 'paper-search-cli.cjs');
  const compiledPackagePath = path.join(compiledDir, 'paper-search-cli.package.json');
  writeFakePaperSearchCli(compiledCliPath);
  fs.writeFileSync(compiledPackagePath, '{"version":"0.3.4"}\n', 'utf-8');
  return materializePaperSearchRuntime(
    compiledCliPath,
    compiledPackagePath,
    path.join(projectPath, 'paper-collection-skill'),
  );
}

function slugFromPaperId(paperId: string): string {
  return paperId.replace(/v\d+$/, '');
}

function normalizeJournalName(journal: string): string {
  return journal.trim().toLowerCase();
}

function metricsFromCache(
  payload: PaperCollectionCachePayload,
  journal: string
): Record<string, unknown> | undefined {
  return payload.journalMetricsByJournal[normalizeJournalName(journal)] as Record<string, unknown> | undefined;
}

describe('Paper Collection arXiv loop', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-paper-collection-'));
  });

  afterEach(() => {
    fs.rmSync(projectPath, { recursive: true, force: true });
  });

  it('collects an arXiv paper into the Paper Library with a local PDF resource', () => {
    const cliPath = materializeFakePaperSearchCli(projectPath);
    const searchResult = JSON.parse(execFileSync(process.execPath, [
      cliPath,
      'search',
      '1706.03762',
      '--platform',
      'arxiv',
      '--max-results',
      '1',
      '--pretty',
    ], { encoding: 'utf-8' }));
    const paper = searchResult.papers[0];
    const slug = slugFromPaperId(paper.id);
    const entryPath = `papers/${slug}.md`;
    const knowledgeRoot = getKnowledgeBaseRoot(projectPath);
    const papersDir = path.join(knowledgeRoot, 'papers');

    expect(fs.existsSync(path.join(knowledgeRoot, entryPath))).toBe(false);
    expect(searchKnowledgeEntries(projectPath, { keyword: paper.title })).toHaveLength(0);

    const downloadResult = JSON.parse(execFileSync(process.execPath, [
      cliPath,
      'download',
      paper.id,
      '--platform',
      'arxiv',
      '--save-path',
      papersDir,
      '--pretty',
    ], { encoding: 'utf-8' }));
    const metricsResult = JSON.parse(execFileSync(process.execPath, [
      cliPath,
      'journal-metrics',
      paper.journal,
      '--pretty',
    ], { encoding: 'utf-8' }));
    const metrics = metricsResult.data[0];

    const resource = `papers/${slug}.pdf`;
    const entry = createKnowledgeEntry(projectPath, {
      relativePath: entryPath,
      type: 'Paper',
      title: paper.title,
      description: `Collected from ${paper.source}.`,
      authors: paper.authors,
      source: `arXiv:${slug}`,
      journal: paper.journal,
      volume: paper.volume,
      pages: paper.pages,
      year: paper.year,
      doi: paper.doi,
      journalMetrics: {
        impactFactor: metrics.impactFactor,
        casTier: metrics.casTier,
        jcrQuartile: metrics.jcrQuartile,
        indexing: metrics.indexing,
        year: metrics.year,
        source: metrics.source,
      },
      resource,
      tags: ['arxiv'],
      body: `PDF URL: ${paper.pdfUrl}`,
    });

    expect(downloadResult).toMatchObject({ ok: true, path: path.join(papersDir, `${slug}.pdf`) });
    expect(entry).toMatchObject({
      relativePath: entryPath,
      frontmatter: {
        type: 'Paper',
        authors: ['Ashish Vaswani', 'Noam Shazeer'],
        source: 'arXiv:1706.03762',
        journal: 'Advances in Neural Information Processing Systems',
        journalMetrics: {
          impactFactor: 12.5,
          casTier: '1区',
          jcrQuartile: 'Q1',
          indexing: ['SCI', 'EI'],
          year: 2025,
          source: 'easyScholar',
        },
        resource,
      },
    });
    expect(resolvePaperPdfResourcePath(projectPath, resource)).toBe(path.join(papersDir, `${slug}.pdf`));

    const duplicatePathExists = fs.existsSync(path.join(knowledgeRoot, entryPath));
    const duplicateTitleMatches = searchKnowledgeEntries(projectPath, { keyword: paper.title });
    expect(duplicatePathExists).toBe(true);
    expect(duplicateTitleMatches.map((match) => match.relativePath)).toEqual([entryPath]);
    expect(listKnowledgeEntries(projectPath)).toHaveLength(1);
  });

  it('keeps metadata when PDF download fails and omits the local resource pointer', () => {
    const cliPath = materializeFakePaperSearchCli(projectPath);
    const searchResult = JSON.parse(execFileSync(process.execPath, [
      cliPath,
      'search',
      'download-fails',
      '--platform',
      'arxiv',
      '--max-results',
      '1',
      '--pretty',
    ], { encoding: 'utf-8' }));
    const paper = searchResult.papers[0];

    expect(() => execFileSync(process.execPath, [
      cliPath,
      'download',
      paper.id,
      '--platform',
      'arxiv',
      '--save-path',
      path.join(getKnowledgeBaseRoot(projectPath), 'papers'),
      '--pretty',
    ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })).toThrow();

    const entry = createKnowledgeEntry(projectPath, {
      relativePath: 'papers/download-fails.md',
      type: 'Paper',
      title: paper.title,
      authors: paper.authors,
      source: 'arXiv:download-fails',
      journal: paper.journal,
      year: paper.year,
      tags: ['arxiv'],
      body: `PDF download failed: PDF unavailable\n\nOriginal PDF URL: ${paper.pdfUrl}`,
    });

    expect(entry.frontmatter).toMatchObject({
      type: 'Paper',
      authors: ['Grace Hopper'],
      source: 'arXiv:download-fails',
      journal: 'arXiv',
      year: 2024,
    });
    expect(entry.frontmatter.resource).toBeUndefined();
    expect(entry.body).toContain('PDF download failed');
  });

  it('queries journal metrics once per normalized journal in a collection batch', () => {
    const cliPath = materializeFakePaperSearchCli(projectPath);
    const countFile = path.join(projectPath, 'metrics-count.txt');
    const journals = [
      'Advances in Neural Information Processing Systems',
      ' advances in neural information processing systems ',
    ];
    const metricsByJournal = new Map<string, unknown>();

    for (const journal of journals) {
      const key = normalizeJournalName(journal);
      if (metricsByJournal.has(key)) continue;
      const result = JSON.parse(execFileSync(process.execPath, [
        cliPath,
        'journal-metrics',
        journal,
        '--pretty',
      ], {
        encoding: 'utf-8',
        env: {
          ...process.env,
          CDF_FAKE_METRICS_COUNT_FILE: countFile,
        },
      }));
      metricsByJournal.set(key, result.data[0]);
    }

    expect(metricsByJournal.size).toBe(1);
    expect(fs.readFileSync(countFile, 'utf-8')).toBe('1');
  });

  it('searches candidates, deduplicates journal metrics, and writes the cross-Skill cache', () => {
    const cliPath = materializeFakePaperSearchCli(projectPath);
    const threadState = createInMemoryPaperCollectionThreadState();
    const countFile = path.join(projectPath, 'metrics-count.txt');
    const searchResult = JSON.parse(execFileSync(process.execPath, [
      cliPath,
      'search',
      '1706.03762',
      '--platform',
      'arxiv',
      '--max-results',
      '1',
      '--pretty',
    ], { encoding: 'utf-8' }));
    const candidates = [
      searchResult.papers[0],
      {
        ...searchResult.papers[0],
        id: '1706.03762-copy',
        journal: ` ${searchResult.papers[0].journal.toUpperCase()} `,
      },
    ];
    const journalMetricsByJournal: Record<string, unknown> = {};

    for (const paper of candidates) {
      const key = normalizeJournalName(paper.journal);
      if (journalMetricsByJournal[key]) continue;
      const metricsResult = JSON.parse(execFileSync(process.execPath, [
        cliPath,
        'journal-metrics',
        paper.journal,
        '--pretty',
      ], {
        encoding: 'utf-8',
        env: {
          ...process.env,
          CDF_FAKE_METRICS_COUNT_FILE: countFile,
        },
      }));
      journalMetricsByJournal[key] = metricsResult.data[0];
    }

    writeLatest(threadState, {
      searchedAt: '2026-07-05T10:00:00Z',
      query: '1706.03762',
      source: 'arxiv',
      candidates,
      journalMetricsByJournal,
    });
    appendToIndex(threadState, {
      searchedAt: '2026-07-05T10:00:00Z',
      query: '1706.03762',
      candidateCount: candidates.length,
      status: 'fresh',
    });

    expect(fs.readFileSync(countFile, 'utf-8')).toBe('1');
    expect(readLatest(threadState)?.candidates).toHaveLength(2);
    expect(readIndex(threadState)).toEqual([
      {
        searchedAt: '2026-07-05T10:00:00Z',
        query: '1706.03762',
        candidateCount: 2,
        status: 'fresh',
      },
    ]);
  });

  it('enriches DOI search candidates before querying metrics and writing the cache', () => {
    const cliPath = materializeFakePaperSearchCli(projectPath);
    const threadState = createInMemoryPaperCollectionThreadState();
    const countFile = path.join(projectPath, 'metrics-count.txt');
    const searchResult = JSON.parse(execFileSync(process.execPath, [
      cliPath,
      'search',
      'needs-enrichment',
      '--platform',
      'arxiv',
      '--max-results',
      '1',
      '--pretty',
    ], { encoding: 'utf-8' }));
    const paper = searchResult.papers[0];

    expect(paper.journal).toBeUndefined();

    const enrichment = JSON.parse(execFileSync(process.execPath, [
      cliPath,
      'run',
      'get_paper_by_doi',
      '--json-args',
      JSON.stringify({ doi: paper.doi }),
    ], { encoding: 'utf-8' })).data;
    const publishedPaper = enrichment.papers.find((candidate: Record<string, unknown>) =>
      candidate.source === 'crossref'
    ) ?? enrichment.papers.find((candidate: Record<string, unknown>) =>
      typeof candidate.journal === 'string' && candidate.journal.length > 0
    );

    expect(enrichment.failed_sources).toContain('pubmed');
    expect(enrichment.errors.pubmed).toBe('timed out');
    expect(publishedPaper.source).toBe('crossref');

    const enrichedPaper = {
      ...paper,
      journal: publishedPaper.journal,
      volume: publishedPaper.volume,
      issue: publishedPaper.issue,
      pages: publishedPaper.pages,
      year: publishedPaper.year,
    };
    const journalMetricsByJournal: Record<string, unknown> = {};
    const key = normalizeJournalName(enrichedPaper.journal);
    const metricsResult = JSON.parse(execFileSync(process.execPath, [
      cliPath,
      'journal-metrics',
      enrichedPaper.journal,
      '--pretty',
    ], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CDF_FAKE_METRICS_COUNT_FILE: countFile,
      },
    }));
    journalMetricsByJournal[key] = metricsResult.data[0];

    writeLatest(threadState, {
      searchedAt: '2026-07-05T10:00:00Z',
      query: 'needs-enrichment',
      source: 'arxiv',
      candidates: [enrichedPaper],
      journalMetricsByJournal,
    });

    const latest = readLatest(threadState) as PaperCollectionCachePayload;
    expect(latest.candidates[0]).toMatchObject({
      title: 'Attention Is All You Need',
      journal: 'Advances in Neural Information Processing Systems',
      volume: '30',
      pages: '5998-6008',
      year: 2017,
    });
    expect(latest.journalMetricsByJournal).toHaveProperty(key);
    expect(fs.readFileSync(countFile, 'utf-8')).toBe('1');
  });

  it('imports selected cached candidates without querying journal metrics again and marks the cache consumed', () => {
    const cliPath = materializeFakePaperSearchCli(projectPath);
    const threadState = createInMemoryPaperCollectionThreadState();
    const countFile = path.join(projectPath, 'metrics-count.txt');
    fs.writeFileSync(countFile, '1', 'utf-8');
    const candidates = [
      {
        id: '1706.03762v7',
        title: 'Attention Is All You Need',
        authors: ['Ashish Vaswani', 'Noam Shazeer'],
        source: 'arxiv',
        journal: 'Advances in Neural Information Processing Systems',
        year: 2017,
        doi: '10.48550/arXiv.1706.03762',
        pdfUrl: 'https://arxiv.org/pdf/1706.03762v7',
      },
      {
        id: '1605.08386v1',
        title: 'Another Selected Paper',
        authors: ['Ada Lovelace'],
        source: 'arxiv',
        journal: 'Advances in Neural Information Processing Systems',
        year: 2016,
        doi: '10.48550/arXiv.1605.08386',
        pdfUrl: 'https://arxiv.org/pdf/1605.08386v1',
      },
    ];
    writeLatest(threadState, {
      searchedAt: '2026-07-05T10:00:00Z',
      query: 'transformers',
      source: 'arxiv',
      candidates,
      journalMetricsByJournal: {
        [normalizeJournalName('Advances in Neural Information Processing Systems')]: {
          impactFactor: 12.5,
          casTier: '1区',
          jcrQuartile: 'Q1',
          indexing: ['SCI'],
          year: 2025,
          source: 'easyScholar',
        },
      },
    });
    appendToIndex(threadState, {
      searchedAt: '2026-07-05T10:00:00Z',
      query: 'transformers',
      candidateCount: candidates.length,
      status: 'fresh',
    });

    const latest = readLatest(threadState) as PaperCollectionCachePayload;
    for (const paper of latest.candidates as Array<typeof candidates[number]>) {
      const slug = slugFromPaperId(paper.id);
      const resource = `papers/${slug}.pdf`;
      const downloadResult = JSON.parse(execFileSync(process.execPath, [
        cliPath,
        'download',
        paper.id,
        '--platform',
        'arxiv',
        '--save-path',
        path.join(getKnowledgeBaseRoot(projectPath), 'papers'),
        '--pretty',
      ], { encoding: 'utf-8' }));
      const metrics = metricsFromCache(latest, paper.journal);

      expect(downloadResult.ok).toBe(true);
      createKnowledgeEntry(projectPath, {
        relativePath: `papers/${slug}.md`,
        type: 'Paper',
        title: paper.title,
        authors: paper.authors,
        source: `arXiv:${slug}`,
        journal: paper.journal,
        year: paper.year,
        doi: paper.doi,
        journalMetrics: metrics as import('../shared/types').JournalMetricsSnapshot | undefined,
        resource,
        body: `PDF URL: ${paper.pdfUrl}`,
      });
    }
    markLatestConsumed(threadState, '2026-07-05T10:20:00Z');

    expect(listKnowledgeEntries(projectPath).map((entry) => entry.relativePath).sort()).toEqual([
      'papers/1605.08386.md',
      'papers/1706.03762.md',
    ]);
    expect(fs.readFileSync(countFile, 'utf-8')).toBe('1');
    expect(readLatest(threadState)?.consumedAt).toBe('2026-07-05T10:20:00Z');
    expect(readIndex(threadState)[0].status).toBe('consumed');
  });

  it('imports a user-provided PDF by reconciling metadata from the latest cache', () => {
    const threadState = createInMemoryPaperCollectionThreadState();
    const knowledgeRoot = getKnowledgeBaseRoot(projectPath);
    const papersDir = path.join(knowledgeRoot, 'papers');
    fs.mkdirSync(papersDir, { recursive: true });
    fs.writeFileSync(path.join(papersDir, 'paid-paper.pdf'), '%PDF-1.4\n%%EOF\n', 'utf-8');
    writeLatest(threadState, {
      searchedAt: '2026-07-05T10:00:00Z',
      query: 'paid paper',
      source: 'mixed',
      candidates: [
        {
          title: 'Paid Paper',
          authors: ['Katherine Johnson'],
          source: 'crossref',
          journal: 'Journal of Paid Access',
          year: 2026,
          doi: '10.1000/paid',
        },
      ],
      journalMetricsByJournal: {},
    });
    appendToIndex(threadState, {
      searchedAt: '2026-07-05T10:00:00Z',
      query: 'paid paper',
      candidateCount: 1,
      status: 'fresh',
    });

    const resolvedPdf = resolvePaperPdfResourcePath(projectPath, 'papers/paid-paper.pdf');
    const cached = (readLatest(threadState)?.candidates as Array<Record<string, unknown>>)
      .find((candidate) => candidate.title === 'Paid Paper');

    const entry = createKnowledgeEntry(projectPath, {
      relativePath: 'papers/paid-paper.md',
      type: 'Paper',
      title: cached?.title as string,
      authors: cached?.authors as string[],
      source: cached?.source as string,
      journal: cached?.journal as string,
      year: cached?.year as number,
      doi: cached?.doi as string,
      resource: 'papers/paid-paper.pdf',
      body: 'PDF supplied by the user through institutional access.',
    });
    markLatestConsumed(threadState, '2026-07-05T10:25:00Z');

    expect(resolvedPdf).toBe(path.join(papersDir, 'paid-paper.pdf'));
    expect(entry.frontmatter).toMatchObject({
      title: 'Paid Paper',
      authors: ['Katherine Johnson'],
      doi: '10.1000/paid',
      resource: 'papers/paid-paper.pdf',
    });
    expect(readIndex(threadState)[0].status).toBe('consumed');
  });

  it('rejects an escaped user-provided PDF path without creating a Paper Entry', () => {
    expect(() => resolvePaperPdfResourcePath(projectPath, '/etc/passwd')).toThrow();
    expect(listKnowledgeEntries(projectPath)).toEqual([]);
  });

  it('recovers an archived search payload and continues collection from it', () => {
    const cliPath = materializeFakePaperSearchCli(projectPath);
    const threadState = createInMemoryPaperCollectionThreadState();
    const consumedPayload: PaperCollectionCachePayload = {
      searchedAt: '2026-07-05T10:00:00Z',
      consumedAt: '2026-07-05T10:15:00Z',
      query: 'archived transformer',
      source: 'arxiv',
      candidates: [
        {
          id: '1706.03762v7',
          title: 'Attention Is All You Need',
          authors: ['Ashish Vaswani'],
          source: 'arxiv',
          journal: 'arXiv',
          year: 2017,
          pdfUrl: 'https://arxiv.org/pdf/1706.03762v7',
        },
      ],
      journalMetricsByJournal: {},
    };
    writeLatest(threadState, consumedPayload);
    appendToIndex(threadState, {
      searchedAt: consumedPayload.searchedAt,
      query: consumedPayload.query,
      candidateCount: 1,
      status: 'consumed',
    });

    const archiveResult = maybeArchive(threadState, new Date('2026-07-05T10:45:00Z'));
    const archived = readArchive(threadState, archiveResult.archivePath as string) as PaperCollectionCachePayload;
    const paper = archived.candidates[0] as Record<string, unknown>;
    const slug = slugFromPaperId(paper.id as string);
    execFileSync(process.execPath, [
      cliPath,
      'download',
      paper.id as string,
      '--platform',
      'arxiv',
      '--save-path',
      path.join(getKnowledgeBaseRoot(projectPath), 'papers'),
      '--pretty',
    ], { encoding: 'utf-8' });
    createKnowledgeEntry(projectPath, {
      relativePath: `papers/${slug}.md`,
      type: 'Paper',
      title: paper.title as string,
      authors: paper.authors as string[],
      source: `arXiv:${slug}`,
      journal: paper.journal as string,
      year: paper.year as number,
      resource: `papers/${slug}.pdf`,
      body: 'Recovered from archived search cache.',
    });

    expect(archiveResult.archived).toBe(true);
    expect(readIndex(threadState)[0]).toMatchObject({
      status: 'archived',
      archivePath: archiveResult.archivePath,
    });
    expect(listKnowledgeEntries(projectPath).map((entry) => entry.relativePath)).toEqual(['papers/1706.03762.md']);
  });
});
