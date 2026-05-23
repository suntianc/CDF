import { beforeEach, describe, expect, it, vi } from 'vitest';

const { anthropicStreamMock, chatAnthropicCtor, anthropicSdkCtor } = vi.hoisted(() => {
  const anthropicStreamMock = vi.fn();
  const chatAnthropicCtor = vi.fn(() => ({
    stream: anthropicStreamMock,
  }));
  const anthropicSdkCtor = vi.fn((options) => options);
  return { anthropicStreamMock, chatAnthropicCtor, anthropicSdkCtor };
});

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(),
}));

vi.mock('@langchain/ollama', () => ({
  ChatOllama: vi.fn(),
}));

vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: chatAnthropicCtor,
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: anthropicSdkCtor,
}));

import { runLLMChat } from './llm';

async function* makeStream(chunks: string[]) {
  for (const chunk of chunks) {
    yield { content: chunk };
  }
}

describe('runLLMChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pass normalized MiniMax anthropic base url to ChatAnthropic', async () => {
    anthropicStreamMock.mockResolvedValueOnce(makeStream(['收', '到']));

    const send = vi.fn();
    const sender = { send } as any;

    await runLLMChat(sender, 'req-1', {
      providerType: 'anthropic',
      apiUrl: 'https://api.minimax.io/anthropic/v1',
      apiKey: 'sk-cp-test-key',
      model: 'MiniMax-M2.7-highspeed',
      messages: [{ role: 'user', content: 'ping' }],
    });

    const anthropicConfig = chatAnthropicCtor.mock.calls[0]?.[0];

    expect(chatAnthropicCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        anthropicApiUrl: 'https://api.minimax.io/anthropic',
        model: 'MiniMax-M2.7-highspeed',
      })
    );
    expect(anthropicConfig.apiKey).toBeUndefined();
    expect(anthropicConfig.createClient).toBeTypeOf('function');

    anthropicConfig.createClient({ baseURL: 'https://api.minimax.io/anthropic' });
    expect(anthropicSdkCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://api.minimax.io/anthropic',
        apiKey: null,
        authToken: 'sk-cp-test-key',
      })
    );

    expect(anthropicStreamMock).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenNthCalledWith(1, 'llm:chunk-req-1', { type: 'chunk', text: '收' });
    expect(send).toHaveBeenNthCalledWith(2, 'llm:chunk-req-1', { type: 'chunk', text: '到' });
    expect(send).toHaveBeenLastCalledWith('llm:chunk-req-1', { type: 'done' });
  });
});
