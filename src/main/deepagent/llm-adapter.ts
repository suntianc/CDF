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

  const originalGenerate = anyModel.completions?._generate?.bind(anyModel.completions);
  if (typeof originalGenerate !== 'function') return;

  anyModel.completions._generate = async function (...args: unknown[]) {
    const result = await originalGenerate(...args);
    normalizeMiniMaxToolCalls(result);
    return result;
  };
}

function extractReasoning(chunk: any): string | undefined {
  if (!chunk) return undefined;

  // 1. 从 message 属性提取 (LangChain 标准 chunk 包装)
  const message = chunk.message;
  if (message) {
    const standardReasoning = message.additional_kwargs?.reasoning_content || message.reasoning_content;
    if (typeof standardReasoning === 'string' && standardReasoning.length > 0) {
      return standardReasoning;
    }

    // MiniMax 特有的 reasoning_details 提取
    const reasoningDetails = message.additional_kwargs?.reasoning_details;
    if (Array.isArray(reasoningDetails) && reasoningDetails.length > 0) {
      const textParts = reasoningDetails
        .map((detail: any) => detail?.text)
        .filter((text: any) => typeof text === 'string' && text.length > 0);
      if (textParts.length > 0) {
        return textParts.join('');
      }
    }
    if (reasoningDetails && typeof reasoningDetails === 'object') {
      if (typeof reasoningDetails.text === 'string' && reasoningDetails.text.length > 0) {
        return reasoningDetails.text;
      }
    }
  }

  // 2. 从 chunk 的根属性或者 choices 属性中直接提取 (针对某些原始 chunk 或者没有被正确 map 的情况)
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
      if (Array.isArray(deltaReasoning) && deltaReasoning.length > 0) {
        const textParts = deltaReasoning
          .map((detail: any) => detail?.text)
          .filter((text: any) => typeof text === 'string' && text.length > 0);
        if (textParts.length > 0) {
          return textParts.join('');
        }
      }
      if (deltaReasoning && typeof deltaReasoning === 'object') {
        if (typeof deltaReasoning.text === 'string' && deltaReasoning.text.length > 0) {
          return deltaReasoning.text;
        }
      }
    }
  }

  // 3. 从 generationInfo 提取
  const genInfo = chunk.generationInfo;
  if (genInfo) {
    const infoReasoning = genInfo.reasoning_content;
    if (typeof infoReasoning === 'string' && infoReasoning.length > 0) {
      return infoReasoning;
    }
  }

  return undefined;
}

function patchOpenAIReasoning(model: BaseChatModel): void {
  const anyModel = model as any;
  console.log(`[ADAPTER] 成功在模型上准备应用 patchOpenAIReasoning`);

  const wrapStream = (originalStream: any, contextName: string) => {
    const fn = async function* (this: any, ...args: unknown[]) {
      let reasoningOpen = false;
      let lastGenerationInfo: Record<string, unknown> | undefined;
      console.log(`[ADAPTER] ${contextName} _streamResponseChunks 被调用，开始消费大模型流...`);

      for await (const chunk of originalStream.call(this, ...args)) {
        lastGenerationInfo = chunk.generationInfo;
        const reasoning = extractReasoning(chunk);
        console.log(`[ADAPTER] ${contextName} 收到大模型 chunk! text:`, JSON.stringify(chunk.text), `提取出的 reasoning:`, JSON.stringify(reasoning), `additional_kwargs:`, JSON.stringify(chunk.message?.additional_kwargs));
        if (typeof reasoning === 'string' && reasoning.length > 0) {
          yield createTextChunk(`${reasoningOpen ? '' : '<think>'}${reasoning}`, chunk.generationInfo);
          reasoningOpen = true;
          continue;
        }

        if (reasoningOpen) {
          yield createTextChunk('</think>\n\n', chunk.generationInfo);
          reasoningOpen = false;
        }

        yield normalizeThinkingTagChunk(chunk);
      }

      if (reasoningOpen) {
        yield createTextChunk('</think>\n\n', lastGenerationInfo);
      }
    };
    (fn as any).__patched = true;
    return fn;
  };

  const wrapGenerate = (originalGenerate: any, contextName: string) => {
    const fn = async function (this: any, ...args: unknown[]) {
      console.log(`[ADAPTER] ${contextName} _generate 被调用`);
      const result = await originalGenerate.call(this, ...args);
      if (result && Array.isArray(result.generations)) {
        for (const group of result.generations) {
          if (Array.isArray(group)) {
            for (const gen of group) {
              const reasoning = extractReasoning(gen);
              console.log(`[ADAPTER] ${contextName} _generate 收到结果，提取出的 reasoning:`, JSON.stringify(reasoning));
              if (typeof reasoning === 'string' && reasoning.length > 0) {
                const prefix = `<think>${reasoning}</think>\n\n`;
                gen.text = prefix + (gen.text || '');
                if (gen.message) {
                  if (typeof gen.message.content === 'string') {
                    gen.message.content = prefix + gen.message.content;
                  } else if (Array.isArray(gen.message.content)) {
                    gen.message.content = [
                      { type: 'text', text: prefix },
                      ...gen.message.content
                    ];
                  }
                }
              }
            }
          }
        }
      }
      return result;
    };
    (fn as any).__patched = true;
    return fn;
  };

  // 1. patch 实例直接属性 (安全网)
  if (typeof anyModel._streamResponseChunks === 'function' && !anyModel._streamResponseChunks.__patched) {
    const original = anyModel._streamResponseChunks.bind(anyModel);
    anyModel._streamResponseChunks = wrapStream(original, '顶层实例');
    console.log(`[ADAPTER] 已成功 patch 顶层实例 _streamResponseChunks`);
  }
  if (typeof anyModel._generate === 'function' && !anyModel._generate.__patched) {
    const original = anyModel._generate.bind(anyModel);
    anyModel._generate = wrapGenerate(original, '顶层实例');
    console.log(`[ADAPTER] 已成功 patch 顶层实例 _generate`);
  }

  // 2. patch 原型链 (这是针对 Object.create() 克隆实例等绕过情况的降维打击)
  const proto = Object.getPrototypeOf(model);
  if (proto) {
    if (typeof proto._streamResponseChunks === 'function' && !proto._streamResponseChunks.__patched) {
      const original = proto._streamResponseChunks;
      proto._streamResponseChunks = wrapStream(original, '原型链');
      console.log(`[ADAPTER] 已成功 patch 原型链 _streamResponseChunks`);
    }
    if (typeof proto._generate === 'function' && !proto._generate.__patched) {
      const original = proto._generate;
      proto._generate = wrapGenerate(original, '原型链');
      console.log(`[ADAPTER] 已成功 patch 原型链 _generate`);
    }
  }

  // 3. patch completions 与 responses 属性上的方法 (双重保险)
  if (anyModel.completions) {
    if (typeof anyModel.completions._streamResponseChunks === 'function' && !anyModel.completions._streamResponseChunks.__patched) {
      const original = anyModel.completions._streamResponseChunks.bind(anyModel.completions);
      anyModel.completions._streamResponseChunks = wrapStream(original, 'completions');
      console.log(`[ADAPTER] 已成功 patch completions._streamResponseChunks`);
    }
    if (typeof anyModel.completions._generate === 'function' && !anyModel.completions._generate.__patched) {
      const original = anyModel.completions._generate.bind(anyModel.completions);
      anyModel.completions._generate = wrapGenerate(original, 'completions');
      console.log(`[ADAPTER] 已成功 patch completions._generate`);
    }
  }

  if (anyModel.responses) {
    if (typeof anyModel.responses._streamResponseChunks === 'function' && !anyModel.responses._streamResponseChunks.__patched) {
      const original = anyModel.responses._streamResponseChunks.bind(anyModel.responses);
      anyModel.responses._streamResponseChunks = wrapStream(original, 'responses');
      console.log(`[ADAPTER] 已成功 patch responses._streamResponseChunks`);
    }
    if (typeof anyModel.responses._generate === 'function' && !anyModel.responses._generate.__patched) {
      const original = anyModel.responses._generate.bind(anyModel.responses);
      anyModel.responses._generate = wrapGenerate(original, 'responses');
      console.log(`[ADAPTER] 已成功 patch responses._generate`);
    }
  }
}

function normalizeThinkingTagChunk(chunk: ChatGenerationChunk): ChatGenerationChunk {
  if (typeof chunk.text !== 'string' || !chunk.text.includes('<thinking')) return chunk;
  return createTextChunk(normalizeThinkingTags(chunk.text), chunk.generationInfo);
}

function normalizeThinkingTags(text: string): string {
  return text
    .replace(/<thinking>/g, '<think>')
    .replace(/<\/thinking>/g, '</think>');
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
      patchOpenAIReasoning(model);
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
      patchOpenAIReasoning(model);
      break;
    default:
      throw new Error(`Unsupported provider type: ${config.providerType}`);
  }

  return model;
}

export function getOllamaBaseUrl(apiUrl: string): string {
  return cleanOllamaUrl(apiUrl);
}
