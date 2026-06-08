import Anthropic from '@anthropic-ai/sdk';
import { ChatAnthropic } from '@langchain/anthropic';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ChatModelStreamEvent } from '@langchain/core/language_models/event';
import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';
import {
  normalizeAnthropicApiUrl,
  normalizeProviderApiUrl,
  shouldUseAnthropicAuthToken,
} from '../../shared/provider-url';
import {
  extractReasoningDetails,
  normalizeOpenAICompatibleChunk,
} from './provider-normalization';
import { appendCurrentReasoning, appendCurrentText, getCurrentStreamAccumulator } from './stream-accumulator';


const modelCapture = new WeakMap<object, { reasoningText: string; normalText: string }>();
const rawReasoningQueue = new WeakMap<object, string[]>();
let streamEventSequence = 0;

export function drainModelStreamCapture(model: unknown): { reasoningText: string; normalText: string } {
  if (!model || typeof model !== 'object') {
    return { reasoningText: '', normalText: '' };
  }
  const captured = modelCapture.get(model);
  if (!captured) {
    return { reasoningText: '', normalText: '' };
  }
  modelCapture.set(model, { reasoningText: '', normalText: '' });
  return captured;
}

export function takeModelReasoningCapture(model: unknown): string {
  if (!model || typeof model !== 'object') return '';
  const captured = modelCapture.get(model);
  if (!captured) return '';
  modelCapture.set(model, { ...captured, reasoningText: '' });
  return captured.reasoningText;
}

export function takeModelTextCapture(model: unknown): string {
  if (!model || typeof model !== 'object') return '';
  const captured = modelCapture.get(model);
  if (!captured) return '';
  modelCapture.set(model, { ...captured, normalText: '' });
  return captured.normalText;
}

export interface RuntimeProviderModelConfig {
  apiKey?: string;
  apiUrl?: string;
  defaultModel: string;
  providerType: 'openai' | 'anthropic' | 'ollama' | 'custom' | 'deepseek' | 'zhipu' | 'glm-overseas' | 'minimax' | 'minimax-overseas' | 'moonshot' | 'qwen' | 'xiaomimimo';
  model?: string;
  contextLimit?: number;
  /** 节点级 LLM temperature 覆盖,undefined 时维持 provider 默认 */
  temperature?: number;
}

const LARGE_CODE_OUTPUT_TOKEN_LIMIT = 65_536;

function getLargeOutputTokenLimit(contextLimit?: number): number {
  if (!contextLimit || contextLimit <= 0) {
    return LARGE_CODE_OUTPUT_TOKEN_LIMIT;
  }
  return Math.min(contextLimit, LARGE_CODE_OUTPUT_TOKEN_LIMIT);
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
    return result;
  };
}

function patchOpenAIReasoning(model: BaseChatModel): void {
  const anyModel = model as any;
  console.log(`[ADAPTER] 成功在模型上准备应用 OpenAI-compatible stream normalization`);

  const appendModelReasoning = (text: string) => {
    const captured = modelCapture.get(anyModel) || { reasoningText: '', normalText: '' };
    captured.reasoningText += text;
    modelCapture.set(anyModel, captured);
  };

  const appendModelText = (text: string) => {
    const captured = modelCapture.get(anyModel) || { reasoningText: '', normalText: '' };
    captured.normalText += text;
    modelCapture.set(anyModel, captured);
  };

  const appendRawReasoning = (text: string) => {
    const queue = rawReasoningQueue.get(anyModel) || [];
    queue.push(text);
    rawReasoningQueue.set(anyModel, queue);
    appendCurrentReasoning(text);
    appendModelReasoning(text);
  };

  const wasCapturedFromRawStream = (text: string): boolean => {
    const queue = rawReasoningQueue.get(anyModel);
    if (!queue?.length) return false;
    if (queue[0] !== text) return false;
    queue.shift();
    if (queue.length === 0) {
      rawReasoningQueue.delete(anyModel);
    } else {
      rawReasoningQueue.set(anyModel, queue);
    }
    return true;
  };

  const extractRawReasoning = (data: any): string | undefined => {
    const delta = data?.choices?.[0]?.delta || data?.delta;
    if (!delta) return undefined;
    const reasoning = delta.reasoning_content || delta.reasoning || delta.thinking;
    if (typeof reasoning === 'string' && reasoning.length > 0) {
      return reasoning;
    }
    return extractReasoningDetails(delta.reasoning_details);
  };

  const wrapCompletionWithRetry = (originalCompletionWithRetry: any) => {
    const fn = async function (this: any, ...args: unknown[]) {
      const result = await originalCompletionWithRetry.call(this, ...args);
      const request = args[0] as { stream?: unknown } | undefined;
      if (!request?.stream || !result || typeof (result as any)[Symbol.asyncIterator] !== 'function') {
        return result;
      }

      async function* normalizedRawStream() {
        for await (const data of result as AsyncIterable<any>) {
          const reasoning = extractRawReasoning(data);
          if (reasoning) {
            console.log(`[ADAPTER] 原始 OpenAI-compatible stream 捕获 reasoning chunk! length:`, reasoning.length);
            appendRawReasoning(reasoning);
          }
          yield data;
        }
      }

      return normalizedRawStream();
    };
    (fn as any).__patched = true;
    return fn;
  };

  const patchCompletionWithRetry = (target: any, label: string) => {
    if (typeof target?.completionWithRetry !== 'function' || target.completionWithRetry.__patched) {
      return;
    }
    const original = target.completionWithRetry.bind(target);
    target.completionWithRetry = wrapCompletionWithRetry(original);
    console.log(`[ADAPTER] 已成功 patch ${label} completionWithRetry`);
  };

  const wrapInvoke = (originalInvoke: any) => {
    const fn = async function (this: any, input: any, options: any) {
      if (typeof this._streamResponseChunks !== 'function') {
        return originalInvoke.call(this, input, options);
      }
      console.log(`[ADAPTER] 实例 invoke 被拦截并转换为流式执行`);
      const messages = (BaseChatModel as any)._convertInputToPromptValue(input).toChatMessages();
      const [, callOptions] = typeof this._separateRunnableConfigFromCallOptionsCompat === 'function'
        ? this._separateRunnableConfigFromCallOptionsCompat(options)
        : [{}, options];

      const accumulator = getCurrentStreamAccumulator();
      if (accumulator) {
        accumulator.isInPatchedInvoke = true;
      }

      try {
        const stream = this._streamResponseChunks(messages, callOptions, options?.runManager);

        let finalChunk: any = null;
        for await (const chunk of stream) {
          finalChunk = finalChunk === null ? chunk : finalChunk.concat(chunk);
        }

        if (!finalChunk) {
          return originalInvoke.call(this, input, options);
        }

        return finalChunk.message;
      } finally {
        if (accumulator) {
          accumulator.isInPatchedInvoke = false;
        }
      }
    };
    (fn as any).__patched = true;
    return fn;
  };

  const wrapStream = (originalStream: any, contextName: string) => {
    const fn = async function* (this: any, ...args: unknown[]) {
      console.log(`[ADAPTER] ${contextName} _streamResponseChunks 被调用，开始消费大模型流...`);

      for await (const chunk of originalStream.call(this, ...args)) {
        const normalized = normalizeOpenAICompatibleChunk(chunk);
        if (normalized.reasoningDelta) {
          if (wasCapturedFromRawStream(normalized.reasoningDelta)) {
            console.log(`[ADAPTER] ${contextName} reasoning chunk 已由原始流捕获，跳过重复缓存`);
          } else {
            console.log(`[ADAPTER] ${contextName} 收到大模型 reasoning chunk! length:`, normalized.reasoningDelta.length);
            appendCurrentReasoning(normalized.reasoningDelta);
            appendModelReasoning(normalized.reasoningDelta);
          }
        }
        if (normalized.textDelta) {
          appendCurrentText(normalized.textDelta);
          appendModelText(normalized.textDelta);
        }

        for (const normalizedChunk of normalized.chunks) {
          yield normalizedChunk;
        }
      }
    };
    (fn as any).__patched = true;
    return fn;
  };

  const wrapGenerate = (originalGenerate: any, contextName: string) => {
    const fn = async function (this: any, ...args: unknown[]) {
      console.log(`[ADAPTER] ${contextName} _generate 被调用`);
      const result = await originalGenerate.call(this, ...args);
      // 保持原本 message 纯净，不污染 content
      if (result && Array.isArray(result.generations)) {
        for (const group of result.generations) {
          if (Array.isArray(group)) {
            for (const gen of group) {
              const normalized = normalizeOpenAICompatibleChunk(gen);
              console.log(`[ADAPTER] ${contextName} _generate 收到结果，提取出的 reasoning length:`, normalized.reasoningDelta?.length);
              if (normalized.reasoningDelta) {
                appendCurrentReasoning(normalized.reasoningDelta);
                appendModelReasoning(normalized.reasoningDelta);
                if (gen.message) {
                  // 确保 reasoning_content 字段存在
                  gen.message.additional_kwargs = gen.message.additional_kwargs || {};
                  gen.message.additional_kwargs.reasoning_content = normalized.reasoningDelta;
                }
              }
              if (normalized.textDelta) {
                appendCurrentText(normalized.textDelta);
                appendModelText(normalized.textDelta);
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

  const wrapStreamChatModelEvents = () => {
    const fn = async function* (this: any, messages: any[], options: any, runManager?: any): AsyncGenerator<ChatModelStreamEvent> {
      console.log(`[ADAPTER] 实例 _streamChatModelEvents 被调用，输出标准 reasoning/text/tool 事件`);

      const streamRunId = `openai-compatible-${Date.now()}-${++streamEventSequence}`;
      const withStreamRunId = (event: Record<string, unknown>): ChatModelStreamEvent => ({
        ...event,
        run_id: streamRunId,
      } as unknown as ChatModelStreamEvent);

      let started = false;
      let nextIndex = 0;
      let reasoningIndex: number | undefined;
      let reasoningText = '';
      let reasoningFinished = false;
      let textIndex: number | undefined;
      let text = '';
      const toolBlocks = new Map<string, { index: number; id?: string; name?: string; args: string }>();

      const ensureStarted = function* () {
        if (!started) {
          started = true;
          yield withStreamRunId({ event: 'message-start' });
        }
      };

      const finishReasoning = function* () {
        if (reasoningIndex !== undefined && !reasoningFinished) {
          reasoningFinished = true;
          yield withStreamRunId({
            event: 'content-block-finish',
            index: reasoningIndex,
            content: { type: 'reasoning', reasoning: reasoningText },
          });
        }
      };

      const finishText = function* () {
        if (textIndex !== undefined) {
          yield withStreamRunId({
            event: 'content-block-finish',
            index: textIndex,
            content: { type: 'text', text },
          });
          textIndex = undefined;
          text = '';
        }
      };

      const finishTool = function* (tool: { index: number; id?: string; name?: string; args: string }) {
        let parsedArgs: unknown = {};
        try {
          parsedArgs = tool.args ? JSON.parse(tool.args) : {};
        } catch {
          yield withStreamRunId({
            event: 'content-block-finish',
            index: tool.index,
            content: {
              type: 'invalid_tool_call',
              id: tool.id,
              name: tool.name,
              args: tool.args,
              error: 'Failed to parse tool call arguments as JSON',
            },
          });
          return;
        }
        yield withStreamRunId({
          event: 'content-block-finish',
          index: tool.index,
          content: {
            type: 'tool_call',
            id: tool.id,
            name: tool.name || '',
            args: parsedArgs,
          },
        });
      };

      try {
        for await (const chunk of this._streamResponseChunks(messages, options, runManager)) {
          for (const event of ensureStarted()) yield event;

          const normalized = normalizeOpenAICompatibleChunk(chunk);
          const chunks = normalized.chunks.length > 0 ? normalized.chunks : [chunk];

          if (normalized.reasoningDelta) {
            if (textIndex !== undefined) {
              for (const event of finishText()) yield event;
            }
            if (reasoningIndex === undefined || reasoningFinished) {
              reasoningIndex = nextIndex++;
              reasoningFinished = false;
              yield withStreamRunId({
                event: 'content-block-start',
                index: reasoningIndex,
                content: { type: 'reasoning', reasoning: '' },
              });
            }
            reasoningText += normalized.reasoningDelta;
            yield withStreamRunId({
              event: 'content-block-delta',
              index: reasoningIndex,
              delta: { type: 'reasoning-delta', reasoning: normalized.reasoningDelta },
            });
          }

          if (normalized.textDelta) {
            for (const event of finishReasoning()) yield event;
            if (textIndex === undefined) {
              textIndex = nextIndex++;
              yield withStreamRunId({
                event: 'content-block-start',
                index: textIndex,
                content: { type: 'text', text: '' },
              });
            }
            text += normalized.textDelta;
            yield withStreamRunId({
              event: 'content-block-delta',
              index: textIndex,
              delta: { type: 'text-delta', text: normalized.textDelta },
            });
          }

          for (const normalizedChunk of chunks) {
            const toolChunks = (normalizedChunk as any).message?.tool_call_chunks;
            if (!Array.isArray(toolChunks) || toolChunks.length === 0) continue;

            for (const event of finishReasoning()) yield event;
            for (const event of finishText()) yield event;

            for (const toolChunk of toolChunks) {
              const key = String(toolChunk.index ?? toolChunk.id ?? toolBlocks.size);
              let tool = toolBlocks.get(key);
              if (!tool) {
                tool = {
                  index: nextIndex++,
                  id: toolChunk.id,
                  name: toolChunk.name,
                  args: '',
                };
                toolBlocks.set(key, tool);
                yield withStreamRunId({
                  event: 'content-block-start',
                  index: tool.index,
                  content: {
                    type: 'tool_call_chunk',
                    id: tool.id,
                    name: tool.name,
                    args: '',
                    index: tool.index,
                  },
                });
              }
              if (toolChunk.id) tool.id = toolChunk.id;
              if (toolChunk.name) tool.name = toolChunk.name;
              tool.args += toolChunk.args || '';
              yield withStreamRunId({
                event: 'content-block-delta',
                index: tool.index,
                delta: {
                  type: 'block-delta',
                  fields: {
                    type: 'tool_call_chunk',
                    id: tool.id,
                    name: tool.name,
                    args: tool.args,
                  },
                },
              });
            }
          }
        }

        if (!started) {
          for (const event of ensureStarted()) yield event;
        }
        for (const event of finishReasoning()) yield event;
        for (const event of finishText()) yield event;
        for (const tool of toolBlocks.values()) {
          for (const event of finishTool(tool)) yield event;
        }
        yield withStreamRunId({ event: 'message-finish', reason: 'stop' });
      } catch (error: any) {
        yield withStreamRunId({
          event: 'error',
          message: error?.message || String(error),
        });
        throw error;
      }
    };
    (fn as any).__patched = true;
    return fn;
  };

  // 只包装当前模型实例，避免修改 ChatOpenAI/ChatOllama 原型导致其它 provider 串联受影响。
  if (typeof anyModel.invoke === 'function' && !anyModel.invoke.__patched) {
    const original = anyModel.invoke.bind(anyModel);
    anyModel.invoke = wrapInvoke(original);
    console.log(`[ADAPTER] 已成功 patch 实例 invoke`);
  }
  if (typeof anyModel._streamResponseChunks === 'function' && !anyModel._streamResponseChunks.__patched) {
    const original = anyModel._streamResponseChunks.bind(anyModel);
    anyModel._streamResponseChunks = wrapStream(original, '实例');
    console.log(`[ADAPTER] 已成功 patch 实例 _streamResponseChunks`);
  }
  if (typeof anyModel._generate === 'function' && !anyModel._generate.__patched) {
    const original = anyModel._generate.bind(anyModel);
    anyModel._generate = wrapGenerate(original, '实例');
    console.log(`[ADAPTER] 已成功 patch 实例 _generate`);
  }
  if (typeof anyModel._streamChatModelEvents === 'function' && !anyModel._streamChatModelEvents.__patched) {
    anyModel._streamChatModelEvents = wrapStreamChatModelEvents();
    console.log(`[ADAPTER] 已成功 patch 实例 _streamChatModelEvents`);
  }
  patchCompletionWithRetry(anyModel, '实例');
  patchCompletionWithRetry(anyModel.completions, '实例 completions');
}

export function createLangChainModel(config: RuntimeProviderModelConfig): BaseChatModel {
  const modelName = config.model || config.defaultModel;
  const normalizedApiUrl = normalizeProviderApiUrl(config.apiUrl);
  let model: BaseChatModel;

  switch (config.providerType) {
    case 'openai':
    case 'custom':
    case 'moonshot':
    case 'qwen':
    case 'xiaomimimo': {
      const modelConfig: Record<string, unknown> = {
        model: modelName,
        temperature: 0,
        streaming: true,
      };
      if (config.temperature !== undefined) modelConfig.temperature = config.temperature;
      if (config.apiKey) modelConfig.apiKey = config.apiKey;
      if (normalizedApiUrl) {
        modelConfig.configuration = {
          baseURL: normalizedApiUrl.replace(/\/chat\/completions\/?$/, '').replace(/\/?$/, ''),
        };
      }
      model = new ChatOpenAI(modelConfig);
      patchOpenAIReasoning(model);
      break;
    }
    case 'deepseek':
    case 'minimax':
    case 'minimax-overseas':
    case 'zhipu':
    case 'glm-overseas': {
      const modelConfig: Record<string, unknown> = {
        model: modelName,
        temperature: 0,
        streaming: true,
      };
      if (config.temperature !== undefined) modelConfig.temperature = config.temperature;
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
      if (config.providerType === 'minimax' || config.providerType === 'minimax-overseas') {
        modelConfig.thinking = { type: 'adaptive' };
        modelConfig.maxTokens = getLargeOutputTokenLimit(config.contextLimit);
        delete modelConfig.temperature;
      }
      model = new ChatAnthropic(modelConfig);
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
      };
      if (config.temperature !== undefined) modelConfig.temperature = config.temperature;
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
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
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
