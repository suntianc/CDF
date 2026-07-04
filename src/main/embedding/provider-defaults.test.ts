import { describe, expect, it } from 'vitest';
import { getDefaultEmbeddingDimsForProvider, getDefaultEmbeddingModelForProvider } from './provider-defaults';

describe('Embedding provider defaults', () => {
  it('matches provider default embedding dimensions', () => {
    expect(getDefaultEmbeddingDimsForProvider('openai')).toBe(1536);
    expect(getDefaultEmbeddingDimsForProvider('zhipu')).toBe(2048);
    expect(getDefaultEmbeddingDimsForProvider('glm-overseas')).toBe(2048);
    expect(getDefaultEmbeddingDimsForProvider('qwen')).toBe(1024);
    expect(getDefaultEmbeddingDimsForProvider('minimax')).toBe(1536);
  });

  it('keeps provider default embedding model ids aligned with settings options', () => {
    expect(getDefaultEmbeddingModelForProvider('qwen')).toBe('text-embedding-v4');
    expect(getDefaultEmbeddingModelForProvider('zhipu')).toBe('embedding-3');
    expect(getDefaultEmbeddingModelForProvider('openai')).toBe('text-embedding-3-small');
  });
});
