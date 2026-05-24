import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { createLangChainModel } from './llm-adapter';

describe('createLangChainModel message filtering', () => {
  it('should filter non-leading system messages in streaming OpenAI calls', async () => {
    const model = createLangChainModel({
      apiKey: 'test-key',
      defaultModel: 'gpt-4o-mini',
      providerType: 'openai',
    }) as any;
    let requestMessages: Array<{ role: string; content: string }> = [];

    model.completions.completionWithRetry = async function* (request: any) {
      requestMessages = request.messages;
      yield {
        choices: [{ delta: { content: 'ok' }, index: 0 }],
      };
    };

    const chunks = model._streamResponseChunks([
      new HumanMessage('第一轮'),
      new SystemMessage('工具执行状态'),
      new HumanMessage('继续'),
    ], {});

    for await (const _chunk of chunks) {
      // consume stream
    }

    expect(requestMessages.map((message) => message.role)).toEqual(['user', 'user', 'user']);
    expect(requestMessages[1].content).toBe('[系统提示] 工具执行状态');
  });

  it('should filter restored plain system-role objects', async () => {
    const model = createLangChainModel({
      apiKey: 'test-key',
      defaultModel: 'gpt-4o-mini',
      providerType: 'openai',
    }) as any;
    let requestMessages: Array<{ role: string; content: string }> = [];

    model.completions.completionWithRetry = async function* (request: any) {
      requestMessages = request.messages;
      yield {
        choices: [{ delta: { content: 'ok' }, index: 0 }],
      };
    };

    const chunks = model._streamResponseChunks([
      new HumanMessage('第一轮'),
      { role: 'system', content: '恢复出的系统状态' },
      new HumanMessage('继续'),
    ], {});

    for await (const _chunk of chunks) {
      // consume stream
    }

    expect(requestMessages.map((message) => message.role)).toEqual(['user', 'user', 'user']);
    expect(requestMessages[1].content).toBe('[系统提示] 恢复出的系统状态');
  });
});
