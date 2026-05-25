import { describe, expect, it } from 'vitest';
import { createLangChainModel, getOllamaBaseUrl, normalizeMiniMaxToolCalls } from './llm-adapter';

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

  it('should infer assistant role for MiniMax stream deltas without role', () => {
    const model = createLangChainModel({
      apiKey: 'test-key',
      defaultModel: 'MiniMax-M2.7-highspeed',
      providerType: 'minimax',
    }) as any;

    const chunk = model.completions._convertCompletionsDeltaToBaseMessageChunk(
      {
        tool_calls: [
          {
            id: 'call-1',
            index: 0,
            type: 'function',
            function: {
              name: 'read_file',
              arguments: '{"path":"/README.md"}',
            },
          },
        ],
      },
      { choices: [{ index: 0 }] },
      undefined
    );

    expect(chunk.tool_call_chunks).toEqual([
      {
        id: 'call-1',
        index: 0,
        name: 'read_file',
        args: '{"path":"/README.md"}',
        type: 'tool_call_chunk',
      },
    ]);
  });

  it('should enable MiniMax reasoning split by default', () => {
    const model = createLangChainModel({
      apiKey: 'test-key',
      defaultModel: 'MiniMax-M2.7-highspeed',
      providerType: 'minimax',
    }) as any;

    expect(model.modelKwargs).toEqual({ reasoning_split: true });
  });

  it('should expose MiniMax reasoning_content as think text chunks', async () => {
    const model = createLangChainModel({
      apiKey: 'test-key',
      defaultModel: 'MiniMax-M2.7-highspeed',
      providerType: 'minimax',
    }) as any;

    model.completions.completionWithRetry = async function* () {
      yield {
        choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: '先思考' } }],
      };
      yield {
        choices: [{ index: 0, delta: { reasoning_content: '再调用工具' } }],
      };
      yield {
        choices: [{
          index: 0,
          finish_reason: 'tool_calls',
          delta: {
            tool_calls: [
              {
                id: 'call-1',
                index: 0,
                type: 'function',
                function: {
                  name: 'read_file',
                  arguments: '{"path":"/README.md"}',
                },
              },
            ],
          },
        }],
      };
    };

    const chunks: any[] = [];
    for await (const chunk of model._streamResponseChunks([], {})) {
      chunks.push(chunk);
    }

    expect(chunks.map((c) => c.text)).toEqual(['', '', '']);
    expect(chunks.map((c) => c.message.additional_kwargs?.reasoning_content)).toEqual([
      '先思考',
      '再调用工具',
      undefined,
    ]);
    expect(chunks[2].message.tool_call_chunks).toEqual([
      {
        id: 'call-1',
        index: 0,
        name: 'read_file',
        args: '{"path":"/README.md"}',
        type: 'tool_call_chunk',
      },
    ]);
  });

  it('should normalize MiniMax literal thinking tags to think tags', async () => {
    const model = createLangChainModel({
      apiKey: 'test-key',
      defaultModel: 'MiniMax-M2.7-highspeed',
      providerType: 'minimax',
    }) as any;

    model.completions.completionWithRetry = async function* () {
      yield {
        choices: [{
          index: 0,
          delta: {
            role: 'assistant',
            content: '<thinking>标签思考</thinking>\n正文',
          },
        }],
      };
    };

    const chunks = [];
    for await (const chunk of model._streamResponseChunks([], {})) {
      chunks.push(chunk.text);
    }

    expect(chunks).toEqual(['<think>标签思考</think>\n正文']);
  });

  it('should split reasoning and normal text if they are returned in a single chunk', async () => {
    const model = createLangChainModel({
      apiKey: 'test-key',
      defaultModel: 'MiniMax-M2.7-highspeed',
      providerType: 'minimax',
    }) as any;

    model.completions.completionWithRetry = async function* () {
      yield {
        choices: [{
          index: 0,
          delta: {
            role: 'assistant',
            reasoning_content: '合并思考内容',
            content: '普通正文内容',
          },
        }],
      };
    };

    const chunks: any[] = [];
    for await (const chunk of model._streamResponseChunks([], {})) {
      chunks.push({
        text: chunk.text,
        reasoning: chunk.message.additional_kwargs?.reasoning_content,
      });
    }

    expect(chunks).toEqual([
      { text: '', reasoning: '合并思考内容' },
      { text: '普通正文内容', reasoning: undefined },
    ]);
  });

  it('should promote MiniMax content-block tool calls to AIMessage tool_calls', () => {
    const result = {
      generations: [[
        {
          message: {
            content: [
              {
                type: 'text',
                text: '<think>需要读取 README</think>',
                id: 'call_function_1',
                name: 'read_file',
                args: '{"file_path":"/README.md","offset":0,"limit":100}',
              },
            ],
            tool_calls: [],
          },
        },
      ]],
    };

    normalizeMiniMaxToolCalls(result);

    expect(result.generations[0][0].message.tool_calls).toEqual([
      {
        type: 'tool_call',
        id: 'call_function_1',
        name: 'read_file',
        args: {
          file_path: '/README.md',
          offset: 0,
          limit: 100,
        },
      },
    ]);
    expect(result.generations[0][0].message.content).toEqual([
      {
        type: 'tool_call',
        id: 'call_function_1',
        name: 'read_file',
        args: {
          file_path: '/README.md',
          offset: 0,
          limit: 100,
        },
      },
    ]);
  });
});

describe('getOllamaBaseUrl', () => {
  it('should normalize common Ollama endpoint URLs', () => {
    expect(getOllamaBaseUrl('http://localhost:11434/api/chat')).toBe('http://localhost:11434');
    expect(getOllamaBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434');
  });
});
