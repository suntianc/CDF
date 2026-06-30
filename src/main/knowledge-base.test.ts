import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createKnowledgeSearchTool,
  ensureKnowledgeBase,
  listKnowledgeEntries,
  searchKnowledgeEntries,
} from './knowledge-base';

describe('Knowledge Base', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-knowledge-'));
  });

  afterEach(() => {
    fs.rmSync(projectPath, { recursive: true, force: true });
  });

  it('initializes the project Knowledge Base with OKF reserved files', () => {
    ensureKnowledgeBase(projectPath);

    const knowledgeRoot = path.join(projectPath, '.cdf', 'knowledge');
    expect(fs.existsSync(path.join(knowledgeRoot, 'index.md'))).toBe(true);
    expect(fs.existsSync(path.join(knowledgeRoot, 'log.md'))).toBe(true);
  });

  it('lists Knowledge Entries while excluding OKF reserved files', () => {
    ensureKnowledgeBase(projectPath);
    const knowledgeRoot = path.join(projectPath, '.cdf', 'knowledge');
    fs.mkdirSync(path.join(knowledgeRoot, 'papers'), { recursive: true });
    fs.writeFileSync(
      path.join(knowledgeRoot, 'papers', 'transformer.md'),
      '---\ntitle: Attention Notes\ntags: [papers]\n---\n\nTransformer notes.',
      'utf-8',
    );

    const entries = listKnowledgeEntries(projectPath);

    expect(entries.map((entry) => entry.relativePath)).toEqual(['papers/transformer.md']);
  });

  it('returns parsed metadata, body, and warnings for incomplete hand-authored entries', () => {
    ensureKnowledgeBase(projectPath);
    const knowledgeRoot = path.join(projectPath, '.cdf', 'knowledge');
    fs.writeFileSync(
      path.join(knowledgeRoot, 'rag.md'),
      '---\ntitle: RAG Notes\n---\n\nRetrieval augmented generation notes.',
      'utf-8',
    );

    const [entry] = listKnowledgeEntries(projectPath);

    expect(entry).toMatchObject({
      relativePath: 'rag.md',
      title: 'RAG Notes',
      tags: [],
      body: 'Retrieval augmented generation notes.',
    });
    expect(entry.warnings).toEqual(expect.arrayContaining([
      'Missing managed field: id',
      'Missing managed field: tags',
      'Missing managed field: created_at',
      'Missing managed field: updated_at',
      'Missing managed field: source',
    ]));
  });

  it('searches tags with all matching by default and any matching when requested', () => {
    ensureKnowledgeBase(projectPath);
    const knowledgeRoot = path.join(projectPath, '.cdf', 'knowledge');
    fs.writeFileSync(
      path.join(knowledgeRoot, 'rag-eval.md'),
      '---\ntitle: RAG Evaluation\ntags: [rag, evaluation]\n---\n\nNotes.',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(knowledgeRoot, 'rag-indexing.md'),
      '---\ntitle: RAG Indexing\ntags: [rag, indexing]\n---\n\nNotes.',
      'utf-8',
    );

    expect(searchKnowledgeEntries(projectPath, { tags: ['rag', 'evaluation'] }).map((entry) => entry.relativePath))
      .toEqual(['rag-eval.md']);
    expect(searchKnowledgeEntries(projectPath, { tags: ['evaluation', 'indexing'], tagMatch: 'any' }).map((entry) => entry.relativePath))
      .toEqual(['rag-eval.md', 'rag-indexing.md']);
  });

  it('searches keyword across user-facing knowledge text without matching ids', () => {
    ensureKnowledgeBase(projectPath);
    const knowledgeRoot = path.join(projectPath, '.cdf', 'knowledge');
    fs.writeFileSync(
      path.join(knowledgeRoot, 'source.md'),
      [
        '---',
        'id: "uuid-rag-only"',
        'title: "Source Notes"',
        'tags: ["paper"]',
        'source:',
        '  type: "url"',
        '  title: "Evaluation Handbook"',
        '  url: "https://example.com/eval"',
        '---',
        '',
        'Body text.',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(knowledgeRoot, 'body.md'),
      '---\nid: "body-id"\ntitle: Body Notes\ntags: []\n---\n\nThis mentions Retrieval in the body.',
      'utf-8',
    );

    expect(searchKnowledgeEntries(projectPath, { keyword: 'retrieval' }).map((entry) => entry.relativePath))
      .toEqual(['body.md']);
    expect(searchKnowledgeEntries(projectPath, { keyword: 'evaluation' }).map((entry) => entry.relativePath))
      .toEqual(['source.md']);
    expect(searchKnowledgeEntries(projectPath, { keyword: 'uuid-rag-only' }).map((entry) => entry.relativePath))
      .toEqual([]);
  });

  it('filters by source date and sorts by update time', () => {
    ensureKnowledgeBase(projectPath);
    const knowledgeRoot = path.join(projectPath, '.cdf', 'knowledge');
    fs.writeFileSync(
      path.join(knowledgeRoot, 'old.md'),
      [
        '---',
        'title: Old Paper',
        'tags: []',
        'created_at: "2026-01-01T00:00:00.000Z"',
        'updated_at: "2026-01-03T00:00:00.000Z"',
        'source:',
        '  type: "paper"',
        '  date: "2024-01-01"',
        '---',
        '',
        'Old paper.',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(knowledgeRoot, 'new.md'),
      [
        '---',
        'title: New Paper',
        'tags: []',
        'created_at: "2026-01-02T00:00:00.000Z"',
        'updated_at: "2026-01-04T00:00:00.000Z"',
        'source:',
        '  type: "paper"',
        '  date: "2025-01-01"',
        '---',
        '',
        'New paper.',
      ].join('\n'),
      'utf-8',
    );

    expect(searchKnowledgeEntries(projectPath, {
      dateField: 'source_date',
      dateFrom: '2024-06-01',
    }).map((entry) => entry.relativePath)).toEqual(['new.md']);
    expect(searchKnowledgeEntries(projectPath, {
      sortBy: 'updated_at',
      sortOrder: 'desc',
    }).map((entry) => entry.relativePath)).toEqual(['new.md', 'old.md']);
  });

  it('exposes Knowledge Entry discovery as a structured Agent tool result', async () => {
    ensureKnowledgeBase(projectPath);
    const knowledgeRoot = path.join(projectPath, '.cdf', 'knowledge');
    fs.writeFileSync(
      path.join(knowledgeRoot, 'agent.md'),
      '---\ntitle: Agent Knowledge\ntags: [agent]\n---\n\nAgent-readable content.',
      'utf-8',
    );

    const tool = createKnowledgeSearchTool(projectPath);
    const result = JSON.parse(String(await (tool as any).invoke({ keyword: 'agent' })));

    expect(result).toMatchObject({
      success: true,
      entries: [
        {
          relativePath: 'agent.md',
          title: 'Agent Knowledge',
          tags: ['agent'],
        },
      ],
    });
  });
});
