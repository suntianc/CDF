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

function writeFakePaperSearchCli(cliPath: string): void {
  fs.writeFileSync(cliPath, [
    '#!/usr/bin/env node',
    "const fs = require('fs');",
    "const path = require('path');",
    'const args = process.argv.slice(2);',
    "if (args[0] === 'search') {",
    "  const query = args[1] || '';",
    "  const paper = query.includes('download-fails') ? {",
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
});
