import { describe, expect, it } from 'vitest';
import { createLocalE5Embedder } from './local-embedder';

describe('Local E5 Embedder', () => {
  it('hides E5 query and passage prefixes behind the embedding interface', async () => {
    const calls: Array<string | string[]> = [];
    const remoteFlags: boolean[] = [];
    const embedder = createLocalE5Embedder({
      cacheDir: '/tmp/cdf-models',
      pipelineFactory: async (_model, options) => {
        remoteFlags.push(options.allowRemoteModels);
        return async (input: string | string[]) => {
        calls.push(input);
        const batchSize = Array.isArray(input) ? input.length : 1;
        return {
          data: new Float32Array(Array.from({ length: batchSize * 3 }, (_, index) => index % 3 === 0 ? 1 : 0)),
          dims: [batchSize, 3],
        };
      };
      },
    });

    await embedder.embed(['how to search', '另一个问题'], 'query');
    await embedder.embed(['stored paper paragraph'], 'passage');

    expect(calls).toEqual([
      ['query: how to search', 'query: 另一个问题'],
      ['passage: stored paper paragraph'],
    ]);
    expect(remoteFlags).toEqual([false]);
  });

  it('requires explicit approved download before loading a missing local model', async () => {
    const embedder = createLocalE5Embedder({
      cacheDir: '/tmp/cdf-models',
      allowDownload: true,
      pipelineFactory: async () => async () => ({ data: new Float32Array([1, 0, 0]), dims: [1, 3] }),
    });

    await expect(embedder.embed(['offline first'], 'passage')).rejects.toThrow(
      'requires a hash-verified download manifest',
    );
  });

  it('downloads an approved hash-verified model manifest before local inference', async () => {
    const downloadedFiles: Array<{ destination: string; urls: string[]; expectedSha256: string }> = [];
    let pipelineLoaded = false;
    const embedder = createLocalE5Embedder({
      cacheDir: '/tmp/cdf-cache',
      localModelPath: '/tmp/cdf-models',
      allowDownload: true,
      modelFiles: [
        { path: 'onnx/model_quantized.onnx', sha256: 'abc123' },
      ],
      downloadFile: async (request) => {
        downloadedFiles.push({
          destination: request.destination,
          urls: request.urls,
          expectedSha256: request.expectedSha256,
        });
      },
      pipelineFactory: async (_model, options) => {
        pipelineLoaded = true;
        expect(options.allowRemoteModels).toBe(false);
        return async () => ({ data: new Float32Array([1, 0, 0]), dims: [1, 3] });
      },
    });

    await embedder.embed(['offline first'], 'passage');

    expect(pipelineLoaded).toBe(true);
    expect(downloadedFiles).toEqual([
      {
        destination: '/tmp/cdf-models/Xenova/multilingual-e5-small/onnx/model_quantized.onnx',
        urls: [
          'https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/onnx/model_quantized.onnx',
          'https://hf-mirror.com/Xenova/multilingual-e5-small/resolve/main/onnx/model_quantized.onnx',
        ],
        expectedSha256: 'abc123',
      },
    ]);
  });
});
