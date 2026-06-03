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

  it('should use ChatAnthropic for MiniMax M3 (1M context)', () => {
    const model = createLangChainModel({
      apiKey: 'test-key',
      apiUrl: 'https://api.minimaxi.com/anthropic/v1',
      defaultModel: 'MiniMax-M3',
      providerType: 'minimax',
    }) as any;

    expect(model).toBeInstanceOf(ChatAnthropic);
    expect(model.model).toBe('MiniMax-M3');
    expect(model.apiUrl).toBe('https://api.minimaxi.com/anthropic');
    expect(model.maxTokens).toBe(4096);
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

  it('should use ChatAnthropic for MiniMax M3 overseas', () => {
    const model = createLangChainModel({
      apiKey: 'sk-cp-overseas-token',
      apiUrl: 'https://api.minimax.io/anthropic',
      defaultModel: 'MiniMax-M3',
      providerType: 'minimax-overseas',
    }) as any;

    expect(model).toBeInstanceOf(ChatAnthropic);
    expect(model.model).toBe('MiniMax-M3');
    expect(model.apiUrl).toBe('https://api.minimax.io/anthropic');
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

  it('should pass thinking: { type: "adaptive" } to ChatAnthropic for MiniMax', () => {
    const model = createLangChainModel({
      apiKey: 'test-key',
      apiUrl: 'https://api.minimaxi.com/anthropic/v1',
      defaultModel: 'MiniMax-M3',
      providerType: 'minimax',
    }) as any;

    expect(model.thinking).toEqual({ type: 'adaptive' });
  });

  it('should pass thinking: { type: "adaptive" } to ChatAnthropic for MiniMax-overseas', () => {
    const model = createLangChainModel({
      apiKey: 'sk-cp-overseas-token',
      apiUrl: 'https://api.minimax.io/anthropic',
      defaultModel: 'MiniMax-M3',
      providerType: 'minimax-overseas',
    }) as any;

    expect(model.thinking).toEqual({ type: 'adaptive' });
  });

  it('should not set thinking field for non-MiniMax providers', () => {
    const openaiModel = createLangChainModel({
      apiKey: 'test-key',
      apiUrl: 'https://api.example.com/v1/chat/completions',
      defaultModel: 'gpt-4o-mini',
      providerType: 'openai',
    }) as any;
    expect(openaiModel.thinking).toBeUndefined();

    const anthropicModel = createLangChainModel({
      apiKey: 'test-key',
      apiUrl: 'https://api.anthropic.com',
      defaultModel: 'claude-3-5-sonnet-20241022',
      providerType: 'anthropic',
    }) as any;
    // ChatAnthropic class field default is { type: "disabled" } — adapter must NOT override to "adaptive"
    expect(anthropicModel.thinking).toEqual({ type: 'disabled' });

    const ollamaModel = createLangChainModel({
      apiKey: 'test-key',
      apiUrl: 'http://localhost:11434',
      defaultModel: 'llama3',
      providerType: 'ollama',
    }) as any;
    expect(ollamaModel.thinking).toBeUndefined();

    const deepseekModel = createLangChainModel({
      apiKey: 'test-key',
      apiUrl: 'https://api.deepseek.com/anthropic/v1',
      defaultModel: 'deepseek-chat',
      providerType: 'deepseek',
    }) as any;
    expect(deepseekModel.thinking).toEqual({ type: 'disabled' });

    const zhipuModel = createLangChainModel({
      apiKey: 'test-key',
      apiUrl: 'https://open.bigmodel.cn/api/anthropic/v1',
      defaultModel: 'glm-4.5',
      providerType: 'zhipu',
    }) as any;
    expect(zhipuModel.thinking).toEqual({ type: 'disabled' });
  });
});

describe('getOllamaBaseUrl', () => {
  it('should normalize common Ollama endpoint URLs', () => {
    expect(getOllamaBaseUrl('http://localhost:11434/api/chat')).toBe('http://localhost:11434');
    expect(getOllamaBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434');
  });
});
