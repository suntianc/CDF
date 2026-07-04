import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createVectorStore, inspectVectorStore, type TextEmbedder } from './vector-store';

class FakeEmbedder implements TextEmbedder {
  readonly source;

  constructor(source: TextEmbedder['source'] = {
    id: 'local:e5-small',
    model: 'intfloat/multilingual-e5-small',
    kind: 'local' as const,
    dims: 3,
  }) {
    this.source = source;
  }

  async embed(texts: string[], _mode: 'query' | 'passage'): Promise<Float32Array[]> {
    return texts.map((text) => {
      if (text.includes('alpha')) return new Float32Array([1, 0, 0]);
      if (text.includes('beta')) return new Float32Array([0, 1, 0]);
      return new Float32Array([0, 0, 1]);
    });
  }
}

describe('VectorStore', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-vectors-'));
  });

  afterEach(() => {
    fs.rmSync(projectPath, { recursive: true, force: true });
  });

  it('creates a collection bound to its Embedding Source and queries text through the same interface', async () => {
    const progress: Array<{ completed: number; total: number }> = [];
    const store = createVectorStore({
      projectPath,
      embedder: new FakeEmbedder(),
      batchSize: 1,
      onProgress: (event) => progress.push(event),
    });
    const collection = store.collection('papers');

    await collection.upsert([
      { id: 'a', text: 'alpha research note', metadata: { title: 'Alpha' } },
      { id: 'b', text: 'beta implementation note', metadata: { title: 'Beta' } },
    ]);

    expect(collection.info()).toMatchObject({
      name: 'papers',
      sourceId: 'local:e5-small',
      model: 'intfloat/multilingual-e5-small',
      dims: 3,
      count: 2,
    });
    expect(fs.readFileSync(path.join(projectPath, '.gitignore'), 'utf-8')).toContain('.cdf/vectors.db');
    expect(progress).toEqual([
      { completed: 1, total: 2 },
      { completed: 2, total: 2 },
    ]);

    const results = await collection.query('alpha question', 1);

    expect(results).toEqual([
      {
        id: 'a',
        score: expect.any(Number),
        metadata: { title: 'Alpha' },
      },
    ]);

    store.close();
  });

  it('refuses to silently switch an existing collection to another Embedding Source', async () => {
    const localStore = createVectorStore({ projectPath, embedder: new FakeEmbedder() });
    await localStore.collection('papers').upsert([
      { id: 'a', text: 'alpha research note', metadata: {} },
    ]);
    localStore.close();

    const cloudStore = createVectorStore({
      projectPath,
      embedder: new FakeEmbedder({
        id: 'cloud:openai:text-embedding-3-small',
        model: 'text-embedding-3-small',
        kind: 'cloud',
        dims: 3,
      }),
    });

    expect(() => cloudStore.collection('papers')).toThrow(
      'cannot be used with "cloud:openai:text-embedding-3-small" without an explicit rebuild',
    );

    cloudStore.close();
  });

  it('reports rebuild impact through the VectorStore interface', async () => {
    const localStore = createVectorStore({ projectPath, embedder: new FakeEmbedder() });
    await localStore.collection('papers').upsert([
      { id: 'a', text: 'alpha research note', metadata: {} },
      { id: 'b', text: 'beta research note', metadata: {} },
    ]);
    localStore.close();

    const inspector = inspectVectorStore(projectPath);

    expect(inspector.rebuildImpactForSource('cloud:provider:text-embedding-3-small')).toEqual({
      collections: 1,
      items: 2,
    });
    expect(inspector.rebuildImpactForSource('local:e5-small')).toEqual({
      collections: 0,
      items: 0,
    });
  });
});
