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
    expect(model.temperature).toBeUndefined();
  });

  it('should pass thinking: { type: "adaptive" } to ChatAnthropic for MiniMax-overseas', () => {
    const model = createLangChainModel({
      apiKey: 'sk-cp-overseas-token',
      apiUrl: 'https://api.minimax.io/anthropic',
      defaultModel: 'MiniMax-M3',
      providerType: 'minimax-overseas',
    }) as any;

    expect(model.thinking).toEqual({ type: 'adaptive' });
    expect(model.temperature).toBeUndefined();
  });

  it('should not set thinking field for non-MiniMax providers', () => {
    const openaiModel = createLangChainModel({
      apiKey: 'test-key',
      apiUrl: 'https://api.example.com/v1/chat/completions',
      defaultModel: 'gpt-4o-mini',
      providerType: 'openai',
    }) as any;
    expect(openaiModel.thinking).toBeUndefined();
    expect(openaiModel.temperature).toBe(0);

    const anthropicModel = createLangChainModel({
      apiKey: 'test-key',
      apiUrl: 'https://api.anthropic.com',
      defaultModel: 'claude-3-5-sonnet-20241022',
      providerType: 'anthropic',
    }) as any;
    // ChatAnthropic class field default is { type: "disabled" } — adapter must NOT override to "adaptive"
    expect(anthropicModel.thinking).toEqual({ type: 'disabled' });
    expect(anthropicModel.temperature).toBe(0);

    const ollamaModel = createLangChainModel({
      apiKey: 'test-key',
      apiUrl: 'http://localhost:11434',
      defaultModel: 'llama3',
      providerType: 'ollama',
    }) as any;
    expect(ollamaModel.thinking).toBeUndefined();
    expect(ollamaModel.temperature).toBe(0);

    const deepseekModel = createLangChainModel({
      apiKey: 'test-key',
      apiUrl: 'https://api.deepseek.com/anthropic/v1',
      defaultModel: 'deepseek-chat',
      providerType: 'deepseek',
    }) as any;
    expect(deepseekModel.thinking).toEqual({ type: 'disabled' });
    expect(deepseekModel.temperature).toBe(0);

    const zhipuModel = createLangChainModel({
      apiKey: 'test-key',
      apiUrl: 'https://open.bigmodel.cn/api/anthropic/v1',
      defaultModel: 'glm-4.5',
      providerType: 'zhipu',
    }) as any;
    expect(zhipuModel.thinking).toEqual({ type: 'disabled' });
    expect(zhipuModel.temperature).toBe(0);
  });
});

describe('getOllamaBaseUrl', () => {
  it('should normalize common Ollama endpoint URLs', () => {
    expect(getOllamaBaseUrl('http://localhost:11434/api/chat')).toBe('http://localhost:11434');
    expect(getOllamaBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434');
  });
});

// ===== Streaming / thinking preservation regression =====
// Load-bearing test for the 6-hunk patch-package on @langchain/anthropic@1.4.0.
// Verifies that the adapter chain is wired correctly for streamed reasoning
// output. The actual `<think>` emission is verified in the patch-package layer
// (src/main/deepagent/llm.ts streamEvents), which is not unit-testable in isolation.
describe('LLM adapter streaming / thinking chain', () => {
  it('anthropic adapter enables streaming + maxTokens', () => {
    // The chain dispatcher → IPC → runLLMChat → runtime → chat model requires
    // streaming + maxTokens to be set on the chat model.
    const model = createLangChainModel({
      apiKey: 'test-key',
      apiUrl: 'https://api.anthropic.com/v1',
      defaultModel: 'claude-3-5-sonnet-20241022',
      providerType: 'anthropic',
    }) as any;

    expect(model.streaming).toBe(true);
    expect(model.maxTokens).toBe(4096);
  });

  it('minimax adapter sets thinking=adaptive (M3 thinking baseline)', () => {
    // For minimax providers, the adapter sets thinking='adaptive' so the
    // patch-package chain can preserve thinking blocks through streamEvents.
    const model = createLangChainModel({
      apiKey: 'test-key',
      apiUrl: 'https://api.minimaxi.com/v1',
      defaultModel: 'abab6.5g-chat',
      providerType: 'minimax',
    }) as any;

    expect(model.thinking).toEqual({ type: 'adaptive' });
  });

  it('patch-package layer imports (load-bearing 6-hunk patch guard)', () => {
    // Verifies that the 6-hunk patch-package files are present in patches/.
    // If npm install strips them, this test fails — alerting us that
    // M3 thinking preservation has been broken.
    const fs = require('fs');
    const path = require('path');
    const patchDir = path.resolve(__dirname, '../../../patches');
    expect(fs.existsSync(patchDir)).toBe(true);
    const patches = fs.readdirSync(patchDir).filter((f: string) => f.endsWith('.patch'));
    // The 6-hunk patch-package is on @langchain/anthropic@1.4.0
    const anthropicPatch = patches.find((f: string) => f.includes('@langchain+anthropic'));
    expect(anthropicPatch, '6-hunk patch-package on @langchain/anthropic must be present').toBeDefined();
  });
});
