import Anthropic from '@anthropic-ai/sdk';
import { ChatAnthropic } from '@langchain/anthropic';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
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
  providerType: 'openai' | 'anthropic' | 'ollama' | 'custom';
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

export function createLangChainModel(config: RuntimeProviderModelConfig): BaseChatModel {
  const modelName = config.model || config.defaultModel;
  const normalizedApiUrl = normalizeProviderApiUrl(config.apiUrl);

  switch (config.providerType) {
    case 'openai':
    case 'custom': {
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
      return new ChatOpenAI(modelConfig);
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
      return new ChatAnthropic(modelConfig);
    }
    case 'ollama':
      return new ChatOllama({
        model: modelName,
        baseUrl: cleanOllamaUrl(normalizedApiUrl || 'http://localhost:11434'),
        temperature: 0,
      });
    default:
      throw new Error(`Unsupported provider type: ${config.providerType}`);
  }
}

export function getOllamaBaseUrl(apiUrl: string): string {
  return cleanOllamaUrl(apiUrl);
}
