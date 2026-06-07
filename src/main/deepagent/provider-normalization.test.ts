import { AIMessageChunk } from '@langchain/core/messages';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import { describe, expect, it } from 'vitest';
import { normalizeOpenAICompatibleChunk } from './provider-normalization';

describe('normalizeOpenAICompatibleChunk', () => {
  it('preserves tool calls when a chunk also carries reasoning', () => {
    const chunk = new ChatGenerationChunk({
      text: '',
      message: new AIMessageChunk({
        content: '',
        additional_kwargs: {
          reasoning_content: 'I should write the file now.',
        },
        tool_call_chunks: [
          {
            name: 'write_file',
            args: '{"file_path":"/tmp/computer.js","content":"code"}',
            id: 'tool-1',
            index: 0,
          },
        ],
      }),
    });

    const normalized = normalizeOpenAICompatibleChunk(chunk);

    expect(normalized.reasoningDelta).toBe('I should write the file now.');
    expect(normalized.chunks).toHaveLength(2);
    expect((normalized.chunks[0].message as AIMessageChunk).additional_kwargs.reasoning_content).toBe(
      'I should write the file now.'
    );

    const toolChunkMessage = normalized.chunks[1].message as AIMessageChunk;
    expect(toolChunkMessage.additional_kwargs.reasoning_content).toBeUndefined();
    expect(toolChunkMessage.tool_call_chunks).toEqual([
      {
        name: 'write_file',
        args: '{"file_path":"/tmp/computer.js","content":"code"}',
        id: 'tool-1',
        index: 0,
      },
    ]);
  });
});
