import { describe, expect, it } from 'vitest';
import {
  isMiniMaxAnthropicApiUrl,
  normalizeAnthropicApiUrl,
  normalizeProviderApiUrl,
  shouldUseAnthropicAuthToken,
} from './provider-url';

describe('normalizeProviderApiUrl', () => {
  it('should preserve configured provider domain while trimming whitespace', () => {
    expect(normalizeProviderApiUrl('  https://api.minimaxi.com/anthropic/v1  ')).toBe(
      'https://api.minimaxi.com/anthropic/v1'
    );
  });

  it('should keep unrelated urls unchanged', () => {
    expect(normalizeProviderApiUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1');
  });

  it('should normalize anthropic compatible base url to sdk expected root', () => {
    expect(normalizeAnthropicApiUrl('https://api.minimaxi.com/anthropic/v1')).toBe(
      'https://api.minimaxi.com/anthropic'
    );
  });

  it('should detect MiniMax anthropic endpoint', () => {
    expect(isMiniMaxAnthropicApiUrl('https://api.minimaxi.com/anthropic/v1')).toBe(true);
    expect(isMiniMaxAnthropicApiUrl('https://api.minimax.io/anthropic/v1')).toBe(true);
    expect(isMiniMaxAnthropicApiUrl('https://api.openai.com/v1')).toBe(false);
  });

  it('should use bearer auth for MiniMax token plan keys', () => {
    expect(
      shouldUseAnthropicAuthToken('https://api.minimax.io/anthropic/v1', 'sk-cp-example')
    ).toBe(true);
    expect(
      shouldUseAnthropicAuthToken('https://api.minimax.io/anthropic/v1', 'sk-ant-example')
    ).toBe(false);
  });
});
