import type { EmbeddingMode, TextEmbedder } from './vector-store';

export interface EmbeddingBatchProgress {
  completed: number;
  total: number;
}

interface EmbeddingBatchOptions {
  mode: EmbeddingMode;
  batchSize?: number;
  signal?: AbortSignal;
  onProgress?: (event: EmbeddingBatchProgress) => void;
}

export async function embedBatchWithProgress(
  embedder: TextEmbedder,
  texts: string[],
  options: EmbeddingBatchOptions,
): Promise<Float32Array[]> {
  const batchSize = options.batchSize ?? 32;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('Embedding batch size must be a positive integer.');
  }

  const vectors: Float32Array[] = [];
  for (let start = 0; start < texts.length; start += batchSize) {
    throwIfCancelled(options.signal);
    const batch = texts.slice(start, start + batchSize);
    vectors.push(...await embedder.embed(batch, options.mode));
    options.onProgress?.({ completed: vectors.length, total: texts.length });
  }
  throwIfCancelled(options.signal);
  return vectors;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Embedding batch was cancelled.');
  }
}
