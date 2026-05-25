import { describe, expect, it } from 'vitest';
import { ChatAnthropic } from '@langchain/anthropic';
import { createLangChainModel, getOllamaBaseUrl } from './llm-adapter';

describe('createLangChainModel', () => {
  it('should create OpenAI-compatible models', () => {
    const model = createLangChainModel({
      apiKey: 'test-key',
      apiUrl: 'https://api.example.com/v1/chat/completions',
      defaultModel: 'gpt-4o-mini',
      providerType: 'openai',
    }) as any;

    expect(model.model).toBe('gpt-4o-mini');
    expect(model.clientConfig?.baseURL).toBe('https://api.example.com/v1');
  });

  it('should use ChatAnthropic for MiniMax', () => {
    const model = createLangChainModel({
      apiKey: 'test-key',
      apiUrl: 'https://api.minimaxi.com/anthropic/v1',
      defaultModel: 'MiniMax-M2.7-highspeed',
      providerType: 'minimax',
    }) as any;

    expect(model).toBeInstanceOf(ChatAnthropic);
    expect(model.model).toBe('MiniMax-M2.7-highspeed');
  });

  it('should use ChatAnthropic for MiniMax-overseas', () => {
    const model = createLangChainModel({
      apiKey: 'test-key',
      apiUrl: 'https://api.minimax.io/anthropic',
      defaultModel: 'MiniMax-M2.5',
      providerType: 'minimax-overseas',
    }) as any;

    expect(model).toBeInstanceOf(ChatAnthropic);
    expect(model.model).toBe('MiniMax-M2.5');
  });

  it('should use ChatAnthropic for DeepSeek', () => {
    const model = createLangChainModel({
      apiKey: 'test-key',
      apiUrl: 'https://api.deepseek.com/anthropic/v1',
      defaultModel: 'deepseek-chat',
      providerType: 'deepseek',
    }) as any;

    expect(model).toBeInstanceOf(ChatAnthropic);
    expect(model.model).toBe('deepseek-chat');
  });
});

describe('getOllamaBaseUrl', () => {
  it('should normalize common Ollama endpoint URLs', () => {
    expect(getOllamaBaseUrl('http://localhost:11434/api/chat')).toBe('http://localhost:11434');
    expect(getOllamaBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434');
  });
});
