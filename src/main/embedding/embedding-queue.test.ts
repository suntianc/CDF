import { describe, expect, it } from 'vitest';
import { embedBatchWithProgress } from './embedding-queue';
import type { TextEmbedder } from './vector-store';

describe('Embedding Queue', () => {
  it('embeds batches with progress and stops when cancelled', async () => {
    const calls: string[][] = [];
    const controller = new AbortController();
    const embedder: TextEmbedder = {
      source: {
        id: 'local:test',
        model: 'test-model',
        kind: 'local',
        dims: 2,
      },
      async embed(texts) {
        calls.push([...texts]);
        if (calls.length === 1) controller.abort();
        return texts.map(() => new Float32Array([1, 0]));
      },
    };
    const progress: Array<{ completed: number; total: number }> = [];

    await expect(embedBatchWithProgress(embedder, ['a', 'b', 'c'], {
      mode: 'passage',
      batchSize: 1,
      signal: controller.signal,
      onProgress: (event) => progress.push(event),
    })).rejects.toThrow('Embedding batch was cancelled');

    expect(calls).toEqual([['a']]);
    expect(progress).toEqual([{ completed: 1, total: 3 }]);
  });
});
