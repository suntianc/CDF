import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { createLocalE5Embedder } from './local-embedder';

const cacheDir = process.env.CDF_LOCAL_EMBEDDING_CACHE_DIR
  || path.join(os.homedir(), '.cache', 'huggingface', 'transformers');

function hasLocalE5ModelCache(): boolean {
  return fs.existsSync(path.join(cacheDir, 'Xenova', 'multilingual-e5-small'))
    || fs.existsSync(path.join(cacheDir, 'models--Xenova--multilingual-e5-small'));
}

describe.skipIf(!hasLocalE5ModelCache())('Local E5 Embedder integration', () => {
  it('embeds a query with the cached local model', async () => {
    const embedder = createLocalE5Embedder({ cacheDir, localModelPath: cacheDir });

    const [vector] = await embedder.embed(['retrieval test'], 'query');

    expect(vector).toBeInstanceOf(Float32Array);
    expect(vector.length).toBe(384);
  });
});
