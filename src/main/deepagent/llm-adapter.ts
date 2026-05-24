import Anthropic from '@anthropic-ai/sdk';
import { ChatAnthropic } from '@langchain/anthropic';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseMessage, HumanMessage } from '@langchain/core/messages';
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

function filterMessages(messages: BaseMessage[]): BaseMessage[] {
  if (!Array.isArray(messages)) return messages;

  const filtered: BaseMessage[] = [];
  let firstSystemMessage: BaseMessage | null = null;

  messages.forEach((msg: any, idx) => {
    const isSystem =
      msg?._getType?.() === 'system' ||
      msg?.constructor?.name === 'SystemMessage' ||
      msg?.role === 'system' ||
      msg?.type === 'system';

    if (isSystem) {
      if (idx === 0) {
        firstSystemMessage = msg;
      } else {
        // 转换中间的系统消息为 HumanMessage，防止 API 验证报错
        let contentStr = '';
        if (typeof msg.content === 'string') {
          contentStr = msg.content;
        } else if (Array.isArray(msg.content)) {
          contentStr = JSON.stringify(msg.content);
        } else {
          contentStr = String(msg.content || '');
        }

        filtered.push(new HumanMessage({
          content: `[系统提示] ${contentStr}`,
          additional_kwargs: msg.additional_kwargs,
        }));
      }
    } else {
      filtered.push(msg);
    }
  });

  if (firstSystemMessage) {
    filtered.unshift(firstSystemMessage);
  }

  return filtered;
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
      if (config.apiKey) modelConfig.apiKey = config.apiKey;
      if (normalizedApiUrl) {
        modelConfig.configuration = {
          baseURL: normalizedApiUrl.replace(/\/chat\/completions\/?$/, '').replace(/\/?$/, ''),
        };
      }
      model = new ChatOpenAI(modelConfig);
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

  // 动态代理低级调用方法 _generate 和 _stream，确保消息清理 100% 覆盖所有执行路径
  const anyModel = model as any;
  const originalGenerate = anyModel._generate.bind(anyModel);
  anyModel._generate = function (messages: any[], options: any, runManager: any) {
    const cleaned = filterMessages(messages);
    return originalGenerate(cleaned, options, runManager);
  };

  const originalStream = anyModel._stream?.bind(anyModel);
  if (originalStream) {
    anyModel._stream = function (messages: any[], options: any, runManager: any) {
      const cleaned = filterMessages(messages);
      return originalStream(cleaned, options, runManager);
    };
  }

  const originalStreamResponseChunks = anyModel._streamResponseChunks?.bind(anyModel);
  if (originalStreamResponseChunks) {
    anyModel._streamResponseChunks = function (messages: any[], options: any, runManager: any) {
      const cleaned = filterMessages(messages);
      return originalStreamResponseChunks(cleaned, options, runManager);
    };
  }

  return model;
}

export function getOllamaBaseUrl(apiUrl: string): string {
  return cleanOllamaUrl(apiUrl);
}
