import path from 'path';
import type { EmbeddingMode, TextEmbedder } from './vector-store';
import { downloadFileWithSha256, type ModelDownloadRequest } from './model-download';

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

interface LocalModelFile {
  path: string;
  sha256: string;
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
  if (!options.modelFiles || options.modelFiles.length === 0) {
    throw new Error('Local Embedding Source download requires a hash-verified download manifest.');
  }
  const downloadFile = options.downloadFile ?? downloadFileWithSha256;
  const primaryHost = trimTrailingSlash(options.remoteHost ?? 'https://huggingface.co/');
  const mirrorHost = trimTrailingSlash(options.mirrorHost ?? 'https://hf-mirror.com/');

  for (const file of options.modelFiles) {
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
