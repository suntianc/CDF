import { describe, expect, it } from 'vitest';
import { createCloudEmbeddingEmbedder, createCloudEmbeddingEmbedderFromProvider } from './cloud-embedder';
import type { LLMProvider } from '../../shared/types';

describe('Cloud Embedding Embedder', () => {
  it('embeds text through an OpenAI-compatible provider credential', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const embedder = createCloudEmbeddingEmbedder({
      providerId: 'provider-1',
      providerType: 'openai',
      apiKey: 'sk-test',
      apiUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
      dims: 3,
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({
          data: [
            { embedding: [1, 0, 0] },
            { embedding: [0, 1, 0] },
          ],
        }), { status: 200 });
      },
    });

    const vectors = await embedder.embed(['alpha', 'beta'], 'passage');

    expect(vectors.map((vector) => Array.from(vector))).toEqual([[1, 0, 0], [0, 1, 0]]);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://api.openai.com/v1/embeddings');
    expect(requests[0].init.headers).toMatchObject({
      Authorization: 'Bearer sk-test',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(requests[0].init.body))).toEqual({
      model: 'text-embedding-3-small',
      input: ['alpha', 'beta'],
      dimensions: 3,
    });
  });

  it('returns an explicit error when a cloud Embedding Source cannot be reached', async () => {
    const embedder = createCloudEmbeddingEmbedder({
      providerId: 'provider-1',
      providerType: 'openai',
      apiKey: 'sk-test',
      apiUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
      dims: 3,
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });

    await expect(embedder.embed(['alpha'], 'query')).rejects.toThrow(
      'Cloud Embedding Source "cloud:provider-1:text-embedding-3-small" is unavailable',
    );
  });

  it('reuses a configured LLM provider credential to construct a cloud Embedding Source', async () => {
    const provider: LLMProvider = {
      id: 'provider-1',
      name: 'OpenAI',
      provider_type: 'openai',
      api_url: 'https://api.openai.com/v1',
      default_model: 'gpt-4o',
      context_limit: 128000,
      is_active: 1,
      created_at: 1,
      updated_at: 1,
    };
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const embedder = createCloudEmbeddingEmbedderFromProvider(provider, {
      apiKey: 'sk-provider',
      model: 'text-embedding-3-small',
      dims: 3,
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ data: [{ embedding: [1, 0, 0] }] }), { status: 200 });
      },
    });

    await embedder.embed(['alpha'], 'query');

    expect(embedder.source).toMatchObject({
      id: 'cloud:provider-1:text-embedding-3-small',
      kind: 'cloud',
      model: 'text-embedding-3-small',
    });
    expect(requests[0].init.headers).toMatchObject({
      Authorization: 'Bearer sk-provider',
    });
  });

  it('does not send dimensions for providers without a known dimensions parameter', async () => {
    const requests: RequestInit[] = [];
    const embedder = createCloudEmbeddingEmbedder({
      providerId: 'provider-1',
      providerType: 'custom',
      apiKey: 'sk-test',
      apiUrl: 'https://example.com/v1',
      model: 'custom-embedding',
      dims: 3,
      fetch: async (_url, init) => {
        requests.push(init ?? {});
        return new Response(JSON.stringify({ data: [{ embedding: [1, 0, 0] }] }), { status: 200 });
      },
    });

    await embedder.embed(['alpha'], 'passage');

    expect(JSON.parse(String(requests[0].body))).toEqual({
      model: 'custom-embedding',
      input: ['alpha'],
    });
  });
});
