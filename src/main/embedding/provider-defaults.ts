import type { LLMProvider } from '../../shared/types';

export function getDefaultEmbeddingModelForProvider(providerType: LLMProvider['provider_type']): string {
  switch (providerType) {
    case 'qwen':
      return 'text-embedding-v4';
    case 'zhipu':
    case 'glm-overseas':
      return 'embedding-3';
    case 'minimax':
    case 'minimax-overseas':
      return 'embo-01';
    default:
      return 'text-embedding-3-small';
  }
}

export function getDefaultEmbeddingDimsForProvider(providerType: LLMProvider['provider_type']): number {
  switch (providerType) {
    case 'zhipu':
    case 'glm-overseas':
      return 2048;
    case 'qwen':
      return 1024;
    default:
      return 1536;
  }
}

export function supportsEmbeddingDimensionsParameter(
  providerType: LLMProvider['provider_type'],
  model: string,
): boolean {
  if (providerType === 'openai') return model.startsWith('text-embedding-3');
  if (providerType === 'zhipu' || providerType === 'glm-overseas') return model === 'embedding-3';
  if (providerType === 'qwen') return model === 'text-embedding-v4';
  return false;
}
