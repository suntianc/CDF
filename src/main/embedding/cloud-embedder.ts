import type { EmbeddingMode, EmbeddingSource, TextEmbedder } from './vector-store';
import type { LLMProvider } from '../../shared/types';
import { supportsEmbeddingDimensionsParameter } from './provider-defaults';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface CloudEmbeddingOptions {
  providerId: string;
  providerType: LLMProvider['provider_type'];
  apiKey?: string;
  apiUrl?: string;
  model: string;
  dims: number;
  fetch?: FetchLike;
}

interface CloudEmbeddingProviderOptions {
  apiKey?: string;
  model: string;
  dims: number;
  fetch?: FetchLike;
}

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
  error?: { message?: string };
}

export function createCloudEmbeddingEmbedder(options: CloudEmbeddingOptions): TextEmbedder {
  const source: EmbeddingSource = {
    id: `cloud:${options.providerId}:${options.model}`,
    model: options.model,
    kind: 'cloud',
    dims: options.dims,
  };
  const fetchImpl = options.fetch ?? fetch;

  return {
    source,
    async embed(texts: string[], _mode: EmbeddingMode): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      const endpoint = embeddingEndpoint(options.apiUrl);
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: options.model,
            input: texts,
            ...(supportsEmbeddingDimensionsParameter(options.providerType, options.model)
              ? { dimensions: options.dims }
              : {}),
          }),
        });
      } catch (error) {
        throw new Error(`Cloud Embedding Source "${source.id}" is unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }

      const payload = await readEmbeddingResponse(response, source.id);
      return payload.data.map((item) => {
        if (!Array.isArray(item.embedding) || item.embedding.length !== options.dims) {
          throw new Error(`Cloud Embedding Source "${source.id}" returned an unexpected embedding shape.`);
        }
        return new Float32Array(item.embedding);
      });
    },
  };
}

export function createCloudEmbeddingEmbedderFromProvider(
  provider: LLMProvider,
  options: CloudEmbeddingProviderOptions,
): TextEmbedder {
  return createCloudEmbeddingEmbedder({
    providerId: provider.id,
    providerType: provider.provider_type,
    apiKey: options.apiKey,
    apiUrl: provider.api_url,
    model: options.model,
    dims: options.dims,
    fetch: options.fetch,
  });
}

function embeddingEndpoint(apiUrl?: string): string {
  const base = (apiUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  return base.endsWith('/embeddings') ? base : `${base}/embeddings`;
}

async function readEmbeddingResponse(response: Response, sourceId: string): Promise<{ data: Array<{ embedding: number[] }> }> {
  let payload: EmbeddingResponse;
  try {
    payload = await response.json() as EmbeddingResponse;
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const detail = payload.error?.message || response.statusText || `HTTP ${response.status}`;
    throw new Error(`Cloud Embedding Source "${sourceId}" failed: ${detail}`);
  }
  if (!Array.isArray(payload.data)) {
    throw new Error(`Cloud Embedding Source "${sourceId}" returned an invalid embeddings response.`);
  }
  return payload as { data: Array<{ embedding: number[] }> };
}
