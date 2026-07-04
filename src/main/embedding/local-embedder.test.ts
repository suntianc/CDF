import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  LOCAL_E5_MODEL_FILES,
  LOCAL_E5_SOURCE,
  createLocalE5Embedder,
  ensureLocalE5Model,
  getLocalE5ModelStatus,
} from './local-embedder';

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

  it('declares the hash-verified files required by the local model', () => {
    expect(LOCAL_E5_MODEL_FILES).toEqual([
      {
        path: 'config.json',
        sha256: 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1',
      },
      {
        path: 'tokenizer.json',
        sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
      },
      {
        path: 'tokenizer_config.json',
        sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b',
      },
      {
        path: 'special_tokens_map.json',
        sha256: 'd05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7',
      },
      {
        path: 'onnx/model_quantized.onnx',
        sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193',
      },
    ]);
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

  it('reports and ensures local model readiness with file-level progress', async () => {
    const modelRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-local-model-'));
    const modelFiles = [
      { path: 'config.json', sha256: 'hash-config' },
      { path: 'onnx/model_quantized.onnx', sha256: 'hash-onnx' },
    ];
    const progressFiles: string[] = [];

    expect(getLocalE5ModelStatus(modelRoot, modelFiles)).toEqual({
      ready: false,
      missingFiles: ['config.json', 'onnx/model_quantized.onnx'],
    });

    const status = await ensureLocalE5Model({
      localModelPath: modelRoot,
      modelFiles,
      downloadFile: async (request) => {
        fs.mkdirSync(path.dirname(request.destination), { recursive: true });
        fs.writeFileSync(request.destination, request.expectedSha256);
        request.onProgress?.({
          url: request.urls[0],
          loaded: request.expectedSha256.length,
          total: request.expectedSha256.length,
        });
      },
      onProgress: (event) => {
        progressFiles.push(`${event.fileIndex}/${event.fileCount}:${event.file}`);
      },
    });

    expect(status).toEqual({ ready: true, missingFiles: [] });
    expect(progressFiles).toEqual([
      '1/2:config.json',
      '2/2:onnx/model_quantized.onnx',
    ]);
    expect(fs.existsSync(path.join(modelRoot, LOCAL_E5_SOURCE.model, 'config.json'))).toBe(true);
  });
});
