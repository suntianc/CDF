import Anthropic from '@anthropic-ai/sdk';
import { ChatAnthropic } from '@langchain/anthropic';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessageChunk } from '@langchain/core/messages';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';
import {
  normalizeAnthropicApiUrl,
  normalizeProviderApiUrl,
  shouldUseAnthropicAuthToken,
} from '../../shared/provider-url';

export interface RuntimeProviderModelConfig {
  apiKey?: string;
  apiUrl?: string;
  defaultModel: string;
  providerType: 'openai' | 'anthropic' | 'ollama' | 'custom' | 'deepseek' | 'glm' | 'glm-overseas' | 'minimax' | 'minimax-overseas' | 'kimi' | 'qwen' | 'mimo';
  model?: string;
}

function cleanOllamaUrl(url: string): string {
  if (!url) return 'http://localhost:11434';
  return url
    .replace(/\/api\/chat\/?$/, '')
    .replace(/\/api\/tags\/?$/, '')
    .replace(/\/api\/generate\/?$/, '')
    .replace(/\/api\/?$/, '')
    .replace(/\/v1\/?$/, '')
    .replace(/\/?$/, '');
}

function patchMiniMaxAssistantRole(model: BaseChatModel): void {
  const anyModel = model as any;
  const originalConvert = anyModel.completions?._convertCompletionsDeltaToBaseMessageChunk;
  if (typeof originalConvert === 'function') {
    anyModel.completions._convertCompletionsDeltaToBaseMessageChunk = function (
      delta: Record<string, unknown>,
      rawResponse: unknown,
      defaultRole?: string
    ) {
      const inferredRole = defaultRole || delta.role || 'assistant';
      return originalConvert.call(this, delta, rawResponse, inferredRole);
    };
  }

  const originalStream = anyModel.completions?._streamResponseChunks?.bind(anyModel.completions);
  if (typeof originalStream === 'function') {
    anyModel.completions._streamResponseChunks = async function* (...args: unknown[]) {
      let reasoningOpen = false;
      let lastGenerationInfo: Record<string, unknown> | undefined;

      for await (const chunk of originalStream(...args)) {
        lastGenerationInfo = chunk.generationInfo;
        const reasoning = chunk.message?.additional_kwargs?.reasoning_content;
        if (typeof reasoning === 'string' && reasoning.length > 0) {
          yield createTextChunk(`${reasoningOpen ? '' : '<think>'}${reasoning}`, chunk.generationInfo);
          reasoningOpen = true;
          continue;
        }

        if (reasoningOpen) {
          yield createTextChunk('</think>\n\n', chunk.generationInfo);
          reasoningOpen = false;
        }

        yield chunk;
      }

      if (reasoningOpen) {
        yield createTextChunk('</think>\n\n', lastGenerationInfo);
      }
    };
  }

  const originalGenerate = anyModel.completions?._generate?.bind(anyModel.completions);
  if (typeof originalGenerate !== 'function') return;

  anyModel.completions._generate = async function (...args: unknown[]) {
    const result = await originalGenerate(...args);
    normalizeMiniMaxToolCalls(result);
    return result;
  };
}

function createTextChunk(text: string, generationInfo?: Record<string, unknown>): ChatGenerationChunk {
  return new ChatGenerationChunk({
    text,
    generationInfo,
    message: new AIMessageChunk({
      content: text,
      response_metadata: {
        model_provider: 'openai',
        usage: {},
      },
    }),
  });
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

export function createLangChainModel(config: RuntimeProviderModelConfig): BaseChatModel {
  const modelName = config.model || config.defaultModel;
  const normalizedApiUrl = normalizeProviderApiUrl(config.apiUrl);
  let model: BaseChatModel;

  switch (config.providerType) {
    case 'openai':
    case 'custom':
    case 'deepseek':
    case 'glm':
    case 'glm-overseas':
    case 'minimax':
    case 'minimax-overseas':
    case 'kimi':
    case 'qwen':
    case 'mimo': {
      const modelConfig: Record<string, unknown> = {
        model: modelName,
        temperature: 0,
        streaming: true,
      };
      if (config.providerType === 'minimax' || config.providerType === 'minimax-overseas') {
        modelConfig.modelKwargs = {
          reasoning_split: true,
        };
      }
      if (config.apiKey) modelConfig.apiKey = config.apiKey;
      if (normalizedApiUrl) {
        modelConfig.configuration = {
          baseURL: normalizedApiUrl.replace(/\/chat\/completions\/?$/, '').replace(/\/?$/, ''),
        };
      }
      model = new ChatOpenAI(modelConfig);
      if (config.providerType === 'minimax' || config.providerType === 'minimax-overseas') {
        patchMiniMaxAssistantRole(model);
      }
      break;
    }
    case 'anthropic': {
      const modelConfig: Record<string, unknown> = {
        model: modelName,
        temperature: 0,
        streaming: true,
        maxTokens: 4096,
      };
      const useAuthToken = shouldUseAnthropicAuthToken(normalizedApiUrl, config.apiKey);
      if (config.apiKey && !useAuthToken) modelConfig.apiKey = config.apiKey;
      if (normalizedApiUrl) {
        modelConfig.anthropicApiUrl = normalizeAnthropicApiUrl(normalizedApiUrl);
      }
      if (config.apiKey && useAuthToken) {
        modelConfig.createClient = (options: ConstructorParameters<typeof Anthropic>[0]) =>
          new Anthropic({
            ...options,
            apiKey: null,
            authToken: config.apiKey!.trim(),
          });
      }
      model = new ChatAnthropic(modelConfig);
      break;
    }
    case 'ollama':
      model = new ChatOllama({
        model: modelName,
        baseUrl: cleanOllamaUrl(normalizedApiUrl || 'http://localhost:11434'),
        temperature: 0,
      });
      break;
    default:
      throw new Error(`Unsupported provider type: ${config.providerType}`);
  }

  return model;
}

export function getOllamaBaseUrl(apiUrl: string): string {
  return cleanOllamaUrl(apiUrl);
}
