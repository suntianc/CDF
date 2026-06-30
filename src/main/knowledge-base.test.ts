import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createKnowledgeCreateTool,
  createKnowledgeSearchTool,
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  ensureKnowledgeBase,
  listKnowledgeEntries,
  readKnowledgeEntry,
  searchKnowledgeEntries,
  updateKnowledgeEntry,
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
      'Missing OKF required field: type',
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

  it('searches keyword across OKF user-facing knowledge text without matching ids', () => {
    ensureKnowledgeBase(projectPath);
    const knowledgeRoot = path.join(projectPath, '.cdf', 'knowledge');
    fs.writeFileSync(
      path.join(knowledgeRoot, 'resource.md'),
      [
        '---',
        'id: "uuid-rag-only"',
        'type: Reference',
        'title: "Source Notes"',
        'description: "Collected evaluation source"',
        'tags: ["paper"]',
        'resource: "https://example.com/eval"',
        '---',
        '',
        'Body text.',
      ].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(knowledgeRoot, 'body.md'),
      '---\nid: "body-id"\ntype: Reference\ntitle: Body Notes\ntags: []\n---\n\nThis mentions Retrieval in the body.',
      'utf-8',
    );

    expect(searchKnowledgeEntries(projectPath, { keyword: 'retrieval' }).map((entry) => entry.relativePath))
      .toEqual(['body.md']);
    expect(searchKnowledgeEntries(projectPath, { keyword: 'evaluation' }).map((entry) => entry.relativePath))
      .toEqual(['resource.md']);
    expect(searchKnowledgeEntries(projectPath, { keyword: 'uuid-rag-only' }).map((entry) => entry.relativePath))
      .toEqual([]);
  });

  it('filters and sorts by OKF timestamp', () => {
    ensureKnowledgeBase(projectPath);
    const knowledgeRoot = path.join(projectPath, '.cdf', 'knowledge');
    fs.writeFileSync(
      path.join(knowledgeRoot, 'old.md'),
      [
        '---',
        'type: Reference',
        'title: Old Paper',
        'tags: []',
        'timestamp: "2024-01-01T00:00:00.000Z"',
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
        'type: Reference',
        'title: New Paper',
        'tags: []',
        'timestamp: "2025-01-01T00:00:00.000Z"',
        '---',
        '',
        'New paper.',
      ].join('\n'),
      'utf-8',
    );

    expect(searchKnowledgeEntries(projectPath, {
      dateField: 'timestamp',
      dateFrom: '2024-06-01',
    }).map((entry) => entry.relativePath)).toEqual(['new.md']);
    expect(searchKnowledgeEntries(projectPath, {
      sortBy: 'timestamp',
      sortOrder: 'desc',
    }).map((entry) => entry.relativePath)).toEqual(['new.md', 'old.md']);
  });

  it('exposes Knowledge Entry discovery as a structured Agent tool result', async () => {
    ensureKnowledgeBase(projectPath);
    const knowledgeRoot = path.join(projectPath, '.cdf', 'knowledge');
    fs.writeFileSync(
      path.join(knowledgeRoot, 'agent.md'),
      '---\ntype: Reference\ntitle: Agent Knowledge\ntags: [agent]\n---\n\nAgent-readable content.',
      'utf-8',
    );

    const tool = createKnowledgeSearchTool(projectPath);
    const result = JSON.parse(String(await (tool as any).invoke({ keyword: 'agent' })));

    expect(result).toMatchObject({
      success: true,
      entries: [
        {
          relativePath: 'agent.md',
          type: 'Reference',
          title: 'Agent Knowledge',
          tags: ['agent'],
        },
      ],
    });
  });

  it('exposes guarded Agent creation through knowledge_create with OKF frontmatter by default', async () => {
    const tool = createKnowledgeCreateTool(projectPath);
    const result = JSON.parse(String(await (tool as any).invoke({
      title: 'Agent Finding',
      tags: ['agent', 'finding'],
      body: 'Reusable implementation finding.',
    })));

    expect(result).toMatchObject({
      success: true,
      entry: {
        relativePath: 'agent-finding.md',
        type: 'Reference',
        title: 'Agent Finding',
        tags: ['agent', 'finding'],
        timestamp: expect.any(String),
        warnings: [],
      },
    });

    const created = readKnowledgeEntry(projectPath, result.entry.relativePath);
    expect(created.frontmatter).toMatchObject({
      type: 'Reference',
      title: 'Agent Finding',
      tags: ['agent', 'finding'],
    });
    expect(created.frontmatter.timestamp).toEqual(expect.any(String));
    expect(created.frontmatter.source).toBeUndefined();
  });

  it('does not automatically append to the Knowledge Base log when knowledge_create runs', async () => {
    ensureKnowledgeBase(projectPath);
    const logPath = path.join(projectPath, '.cdf', 'knowledge', 'log.md');
    const before = fs.readFileSync(logPath, 'utf-8');

    const tool = createKnowledgeCreateTool(projectPath);
    const result = JSON.parse(String(await (tool as any).invoke({
      title: 'Logged Later',
      body: 'This should not write the log automatically.',
    })));

    expect(result.success).toBe(true);
    expect(result.logHint).toContain('log.md');
    expect(fs.readFileSync(logPath, 'utf-8')).toBe(before);
  });

  it('creates a Knowledge Entry at a relative path and reads it back by that path', () => {
    const created = createKnowledgeEntry(projectPath, {
      relativePath: 'notes/rag.md',
      type: 'Finding',
      title: 'RAG Notes',
      tags: ['rag'],
      body: 'Retrieval notes.',
    });

    const read = readKnowledgeEntry(projectPath, created.relativePath);

    expect(created.relativePath).toBe('notes/rag.md');
    expect(read).toMatchObject({
      relativePath: 'notes/rag.md',
      title: 'RAG Notes',
      tags: ['rag'],
      body: 'Retrieval notes.',
    });
    expect(fs.existsSync(path.join(projectPath, '.cdf', 'knowledge', 'notes', 'rag.md'))).toBe(true);
    expect(read.frontmatter).toMatchObject({
      type: 'Finding',
      timestamp: expect.any(String),
    });
  });

  it('generates a safe relative path from title and handles collisions', () => {
    const first = createKnowledgeEntry(projectPath, {
      title: 'RAG Notes',
      tags: ['rag'],
      body: 'First.',
    });
    const second = createKnowledgeEntry(projectPath, {
      title: 'RAG Notes',
      tags: ['rag'],
      body: 'Second.',
    });

    expect(first.relativePath).toBe('rag-notes.md');
    expect(second.relativePath).toBe('rag-notes-2.md');
    expect(readKnowledgeEntry(projectPath, second.relativePath).body).toBe('Second.');
  });

  it('rejects explicit create path collisions without overwriting the existing entry', () => {
    createKnowledgeEntry(projectPath, {
      relativePath: 'collision.md',
      title: 'Original',
      body: 'Original body.',
    });

    expect(() => createKnowledgeEntry(projectPath, {
      relativePath: 'collision.md',
      title: 'Replacement',
      body: 'Replacement body.',
    })).toThrow('already exists');
    expect(readKnowledgeEntry(projectPath, 'collision.md').body).toBe('Original body.');
  });

  it('updates an incomplete hand-authored entry with strict managed metadata while preserving unknown fields', () => {
    ensureKnowledgeBase(projectPath);
    const knowledgeRoot = path.join(projectPath, '.cdf', 'knowledge');
    fs.writeFileSync(
      path.join(knowledgeRoot, 'paper.md'),
      [
        '---',
        'type: Draft',
        'title: Draft Paper',
        'doi: 10.123/example',
        'source:',
        '  type: legacy',
        '---',
        '',
        'Original body.',
      ].join('\n'),
      'utf-8',
    );

    const updated = updateKnowledgeEntry(projectPath, 'paper.md', {
      type: 'Reference',
      title: 'Updated Paper',
      description: 'Updated description.',
      resource: 'doi:10.123/example',
      tags: ['paper'],
      body: 'Updated body.',
    });

    expect(updated).toMatchObject({
      relativePath: 'paper.md',
      title: 'Updated Paper',
      tags: ['paper'],
      body: 'Updated body.',
    });
    expect(updated.frontmatter).toMatchObject({
      type: 'Reference',
      title: 'Updated Paper',
      description: 'Updated description.',
      resource: 'doi:10.123/example',
      tags: ['paper'],
      doi: '10.123/example',
      source: { type: 'legacy' },
    });
    expect(updated.frontmatter.timestamp).toEqual(expect.any(String));
  });

  it('reports broken YAML and refuses to overwrite it during update', () => {
    ensureKnowledgeBase(projectPath);
    const knowledgeRoot = path.join(projectPath, '.cdf', 'knowledge');
    const filePath = path.join(knowledgeRoot, 'broken.md');
    const original = '---\ntitle: [broken\n---\n\nBody.';
    fs.writeFileSync(filePath, original, 'utf-8');

    const read = readKnowledgeEntry(projectPath, 'broken.md');

    expect(read.warnings.some((warning) => warning.startsWith('Invalid frontmatter:'))).toBe(true);
    expect(() => updateKnowledgeEntry(projectPath, 'broken.md', { title: 'Nope' }))
      .toThrow('Cannot update Knowledge Entry with invalid frontmatter');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(original);
  });

  it('deletes Knowledge Entries but rejects OKF reserved files', () => {
    const entry = createKnowledgeEntry(projectPath, {
      relativePath: 'delete-me.md',
      title: 'Delete Me',
      body: 'Temporary.',
    });

    expect(deleteKnowledgeEntry(projectPath, entry.relativePath)).toEqual({ deleted: true });
    expect(listKnowledgeEntries(projectPath).map((item) => item.relativePath)).toEqual([]);
    expect(() => deleteKnowledgeEntry(projectPath, 'index.md')).toThrow('reserved file');
  });

  it('rejects unsafe paths and symlink escapes', () => {
    ensureKnowledgeBase(projectPath);
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-knowledge-outside-'));
    const outsideFile = path.join(outsideDir, 'outside.md');
    fs.writeFileSync(outsideFile, 'outside', 'utf-8');
    const linkPath = path.join(projectPath, '.cdf', 'knowledge', 'linked.md');
    fs.symlinkSync(outsideFile, linkPath);

    expect(() => createKnowledgeEntry(projectPath, {
      relativePath: '/absolute.md',
      title: 'Bad',
    })).toThrow('relative Markdown path');
    expect(() => createKnowledgeEntry(projectPath, {
      relativePath: '../escape.md',
      title: 'Bad',
    })).toThrow('unsafe segment');
    expect(() => createKnowledgeEntry(projectPath, {
      relativePath: 'not-markdown.txt',
      title: 'Bad',
    })).toThrow('end with .md');
    expect(() => createKnowledgeEntry(projectPath, {
      relativePath: '.hidden.md',
      title: 'Bad',
    })).toThrow('unsafe segment');
    expect(() => readKnowledgeEntry(projectPath, 'linked.md')).toThrow('symlink');

    fs.rmSync(outsideDir, { recursive: true, force: true });
  });
});
