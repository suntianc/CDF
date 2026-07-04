import path from 'path';
import fs from 'fs';
import type { EmbeddingMode, TextEmbedder } from './vector-store';
import { downloadFileWithSha256, type ModelDownloadProgress, type ModelDownloadRequest } from './model-download';

export const LOCAL_E5_SOURCE = {
  id: 'local:Xenova/multilingual-e5-small:int8',
  model: 'Xenova/multilingual-e5-small',
  kind: 'local' as const,
  dims: 384,
};

type FeatureExtractorOutput = {
  data: Float32Array | number[];
  dims?: number[];
};

type FeatureExtractor = (
  input: string | string[],
  options?: { pooling?: 'mean'; normalize?: boolean },
) => Promise<FeatureExtractorOutput> | FeatureExtractorOutput;

type PipelineFactory = (
  model: string,
  options: {
    cacheDir: string;
    localModelPath: string;
    allowRemoteModels: boolean;
    onProgress?: (event: unknown) => void;
  },
) => Promise<FeatureExtractor>;

export interface LocalModelFile {
  path: string;
  sha256: string;
}

export const LOCAL_E5_MODEL_FILES: LocalModelFile[] = [
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
];

export interface LocalModelStatus {
  ready: boolean;
  missingFiles: string[];
}

interface LocalE5EmbedderOptions {
  cacheDir: string;
  localModelPath?: string;
  remoteHost?: string;
  mirrorHost?: string;
  allowDownload?: boolean;
  modelFiles?: LocalModelFile[];
  onProgress?: (event: unknown) => void;
  downloadFile?: (request: ModelDownloadRequest) => Promise<void>;
  pipelineFactory?: PipelineFactory;
}

export type LocalModelDownloadProgress = ModelDownloadProgress & {
  file: string;
  fileIndex: number;
  fileCount: number;
};

export interface EnsureLocalE5ModelOptions {
  localModelPath: string;
  remoteHost?: string;
  mirrorHost?: string;
  modelFiles?: LocalModelFile[];
  downloadFile?: (request: ModelDownloadRequest) => Promise<void>;
  onProgress?: (event: LocalModelDownloadProgress) => void;
}

export function createLocalE5Embedder(options: LocalE5EmbedderOptions): TextEmbedder {
  const factory = options.pipelineFactory ?? createTransformersPipeline;
  let extractorPromise: Promise<FeatureExtractor> | undefined;

  async function getExtractor(): Promise<FeatureExtractor> {
    extractorPromise ??= loadLocalPipeline(factory, options);
    return extractorPromise;
  }

  return {
    source: LOCAL_E5_SOURCE,
    async embed(texts: string[], mode: EmbeddingMode): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      const extractor = await getExtractor();
      const input = texts.map((text) => addE5Prefix(text, mode));
      const output = await extractor(input, { pooling: 'mean', normalize: true });
      return normalizeFeatureExtractionOutput(output, texts.length);
    },
  };
}

function addE5Prefix(text: string, mode: EmbeddingMode): string {
  return `${mode}: ${text}`;
}

export function getLocalE5ModelStatus(localModelPath: string, modelFiles = LOCAL_E5_MODEL_FILES): LocalModelStatus {
  const missingFiles = modelFiles
    .filter((file) => !fs.existsSync(path.join(localModelPath, LOCAL_E5_SOURCE.model, file.path)))
    .map((file) => file.path);
  return {
    ready: missingFiles.length === 0,
    missingFiles,
  };
}

export async function ensureLocalE5Model(options: EnsureLocalE5ModelOptions): Promise<LocalModelStatus> {
  const modelFiles = options.modelFiles ?? LOCAL_E5_MODEL_FILES;
  const status = getLocalE5ModelStatus(options.localModelPath, modelFiles);
  if (status.ready) return status;
  await downloadModelFiles({
    cacheDir: options.localModelPath,
    localModelPath: options.localModelPath,
    remoteHost: options.remoteHost,
    mirrorHost: options.mirrorHost,
    modelFiles,
    downloadFile: options.downloadFile,
    onProgress: (event) => {
      if (isModelDownloadProgress(event)) {
        const fileIndex = modelFiles.findIndex((file) => event.url.endsWith(`/${file.path}`));
        options.onProgress?.({
          ...event,
          file: fileIndex >= 0 ? modelFiles[fileIndex].path : '',
          fileIndex: fileIndex >= 0 ? fileIndex + 1 : 0,
          fileCount: modelFiles.length,
        });
      }
    },
  });
  return getLocalE5ModelStatus(options.localModelPath, modelFiles);
}

async function loadLocalPipeline(
  factory: PipelineFactory,
  options: LocalE5EmbedderOptions,
): Promise<FeatureExtractor> {
  const localModelPath = options.localModelPath ?? path.join(options.cacheDir, 'models');
  if (options.allowDownload) {
    await downloadModelFiles({
      ...options,
      localModelPath,
    });
  }
  return factory(LOCAL_E5_SOURCE.model, {
    cacheDir: options.cacheDir,
    localModelPath,
    allowRemoteModels: false,
    onProgress: options.onProgress,
  });
}

async function createTransformersPipeline(
  model: string,
  options: {
    cacheDir: string;
    localModelPath: string;
    allowRemoteModels: boolean;
    onProgress?: (event: unknown) => void;
  },
): Promise<FeatureExtractor> {
  const transformers = await import('@huggingface/transformers');
  transformers.env.cacheDir = options.cacheDir;
  transformers.env.localModelPath = options.localModelPath;
  transformers.env.allowRemoteModels = options.allowRemoteModels;
  return transformers.pipeline('feature-extraction', model, {
    dtype: 'q8',
    local_files_only: !options.allowRemoteModels,
    progress_callback: options.onProgress,
  } as Record<string, unknown>) as Promise<FeatureExtractor>;
}

async function downloadModelFiles(options: LocalE5EmbedderOptions & { localModelPath: string }): Promise<void> {
  const modelFiles = options.modelFiles ?? LOCAL_E5_MODEL_FILES;
  if (modelFiles.length === 0) {
    throw new Error('Local Embedding Source download requires a hash-verified download manifest.');
  }
  const downloadFile = options.downloadFile ?? downloadFileWithSha256;
  const primaryHost = trimTrailingSlash(options.remoteHost ?? 'https://huggingface.co/');
  const mirrorHost = trimTrailingSlash(options.mirrorHost ?? 'https://hf-mirror.com/');

  for (const file of modelFiles) {
    const normalizedPath = file.path.split('\\').join('/').replace(/^\/+/, '');
    await downloadFile({
      urls: [
        `${primaryHost}/${LOCAL_E5_SOURCE.model}/resolve/main/${normalizedPath}`,
        `${mirrorHost}/${LOCAL_E5_SOURCE.model}/resolve/main/${normalizedPath}`,
      ],
      destination: path.join(options.localModelPath, LOCAL_E5_SOURCE.model, normalizedPath),
      expectedSha256: file.sha256,
      onProgress: options.onProgress,
    });
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isModelDownloadProgress(event: unknown): event is ModelDownloadProgress {
  return !!event && typeof event === 'object' && 'url' in event && 'loaded' in event;
}

function normalizeFeatureExtractionOutput(output: FeatureExtractorOutput, batchSize: number): Float32Array[] {
  const data = output.data instanceof Float32Array
    ? output.data
    : new Float32Array(output.data);
  const dims = output.dims ?? [batchSize, data.length / batchSize];
  const vectorSize = dims.length >= 2 ? dims[dims.length - 1] : data.length;

  if (!Number.isInteger(vectorSize) || vectorSize <= 0 || data.length !== batchSize * vectorSize) {
    throw new Error('Local Embedding Source returned an unexpected tensor shape.');
  }

  return Array.from({ length: batchSize }, (_, index) => {
    const start = index * vectorSize;
    return data.slice(start, start + vectorSize);
  });
}
