import { AIMessageChunk } from '@langchain/core/messages';
import { ChatGenerationChunk } from '@langchain/core/outputs';

export interface NormalizedProviderChunk {
  reasoningDelta?: string;
  textDelta?: string;
  chunks: ChatGenerationChunk[];
}

export function normalizeOpenAICompatibleChunk(chunk: ChatGenerationChunk): NormalizedProviderChunk {
  const reasoningDelta = extractReasoning(chunk);
  const rawText = extractText(chunk);
  const textDelta = rawText ? normalizeThinkingTags(rawText) : undefined;
  const chunks: ChatGenerationChunk[] = [];
  if (reasoningDelta) {
    chunks.push(createReasoningChunk(reasoningDelta, chunk.generationInfo));
  }

  if (textDelta) {
    if (reasoningDelta) {
      clearReasoningFields(chunk);
    }
    chunks.push(setChunkText(chunk, textDelta));
  } else if (!reasoningDelta) {
    chunks.push(chunk);
  }

  return {
    reasoningDelta,
    textDelta,
    chunks,
  };
}

export function extractReasoning(chunk: any): string | undefined {
  if (!chunk) return undefined;

  const message = chunk.message;
  if (message) {
    const standardReasoning = message.additional_kwargs?.reasoning_content || message.reasoning_content;
    if (typeof standardReasoning === 'string' && standardReasoning.length > 0) {
      return standardReasoning;
    }

    const reasoningDetails = message.additional_kwargs?.reasoning_details;
    const detailsText = extractReasoningDetails(reasoningDetails);
    if (detailsText) return detailsText;

    const blockReasoning = extractReasoningBlocks(message.contentBlocks || message.content);
    if (blockReasoning) return blockReasoning;
  }

  const rootReasoning = chunk.reasoning_content || chunk.reasoning || chunk.delta?.reasoning_content;
  if (typeof rootReasoning === 'string' && rootReasoning.length > 0) {
    return rootReasoning;
  }

  const choices = chunk.choices || chunk.rawResponse?.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const delta = choices[0]?.delta;
    if (delta) {
      const deltaReasoning = delta.reasoning_content || delta.reasoning_details;
      if (typeof deltaReasoning === 'string' && deltaReasoning.length > 0) {
        return deltaReasoning;
      }
      const detailsText = extractReasoningDetails(deltaReasoning);
      if (detailsText) return detailsText;
    }
  }

  const genInfo = chunk.generationInfo;
  if (genInfo) {
    const infoReasoning = genInfo.reasoning_content;
    if (typeof infoReasoning === 'string' && infoReasoning.length > 0) {
      return infoReasoning;
    }
  }

  const blockReasoning = extractReasoningBlocks(chunk.contentBlocks || chunk.content);
  if (blockReasoning) return blockReasoning;

  return undefined;
}

export function extractText(chunk: any): string | undefined {
  if (typeof chunk?.text === 'string' && chunk.text.length > 0) {
    return chunk.text;
  }
  if (chunk?.message && typeof chunk.message.content === 'string' && chunk.message.content.length > 0) {
    return chunk.message.content;
  }
  return undefined;
}

export function normalizeThinkingTags(text: string): string {
  return text
    .replace(/<thinking>/g, '<think>')
    .replace(/<\/thinking>/g, '</think>');
}

export function createReasoningChunk(text: string, generationInfo?: Record<string, unknown>): ChatGenerationChunk {
  return new ChatGenerationChunk({
    text: '',
    generationInfo,
    message: new AIMessageChunk({
      content: [
        {
          type: 'reasoning',
          reasoning: text,
        } as any,
      ],
      additional_kwargs: {
        reasoning_content: text,
      },
      response_metadata: {
        model_provider: 'openai',
      },
    }),
  });
}

function extractReasoningBlocks(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const textParts = content
    .filter((block: any) => block?.type === 'reasoning' || block?.type === 'thinking')
    .map((block: any) => block.reasoning || block.thinking || block.text)
    .filter((text: any) => typeof text === 'string' && text.length > 0);
  return textParts.length > 0 ? textParts.join('') : undefined;
}

export function normalizeMiniMaxToolCalls(result: any): void {
  for (const generationGroup of result?.generations ?? []) {
    for (const generation of generationGroup ?? []) {
      const message = generation?.message;
      const blocks = Array.isArray(message?.content)
        ? message.content
        : Array.isArray(message?.contentBlocks)
          ? message.contentBlocks
          : [];
      const extracted = blocks
        .filter((block: any) =>
          block?.type === 'text' &&
          typeof block.id === 'string' &&
          typeof block.name === 'string' &&
          block.args !== undefined
        )
        .map((block: any) => ({
          type: 'tool_call',
          id: block.id,
          name: block.name,
          args: parseToolArgs(block.args),
        }));

      if (extracted.length === 0) continue;
      blocks.forEach((block: any) => {
        if (
          block?.type === 'text' &&
          typeof block.id === 'string' &&
          typeof block.name === 'string' &&
          block.args !== undefined
        ) {
          block.type = 'tool_call';
          block.args = parseToolArgs(block.args);
          delete block.text;
        }
      });
      const existing = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      const existingIds = new Set(existing.map((call: any) => call.id).filter(Boolean));
      message.tool_calls = [
        ...existing,
        ...extracted.filter((call: any) => !existingIds.has(call.id)),
      ];
    }
  }
}

export function extractReasoningDetails(reasoningDetails: unknown): string | undefined {
  if (Array.isArray(reasoningDetails) && reasoningDetails.length > 0) {
    const textParts = reasoningDetails
      .map((detail: any) => detail?.text)
      .filter((text: any) => typeof text === 'string' && text.length > 0);
    if (textParts.length > 0) {
      return textParts.join('');
    }
  }
  if (reasoningDetails && typeof reasoningDetails === 'object') {
    const text = (reasoningDetails as any).text;
    if (typeof text === 'string' && text.length > 0) {
      return text;
    }
  }
  return undefined;
}

function clearReasoningFields(chunk: any): void {
  if (!chunk) return;

  if (chunk.message) {
    if (chunk.message.additional_kwargs) {
      delete chunk.message.additional_kwargs.reasoning_content;
      delete chunk.message.additional_kwargs.reasoning_details;
    }
    delete chunk.message.reasoning_content;
  }

  delete chunk.reasoning_content;
  delete chunk.reasoning;

  if (chunk.delta) {
    delete chunk.delta.reasoning_content;
  }

  if (Array.isArray(chunk.choices)) {
    for (const choice of chunk.choices) {
      if (choice?.delta) {
        delete choice.delta.reasoning_content;
        delete choice.delta.reasoning_details;
      }
    }
  }

  if (chunk.generationInfo) {
    delete chunk.generationInfo.reasoning_content;
  }
}

function setChunkText(chunk: ChatGenerationChunk, text: string): ChatGenerationChunk {
  (chunk as any).text = text;
  if ((chunk as any).message && typeof (chunk as any).message.content === 'string') {
    (chunk as any).message.content = text;
  }
  return chunk;
}

function parseToolArgs(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
