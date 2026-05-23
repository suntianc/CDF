import { WebContents } from 'electron';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOllama } from '@langchain/ollama';
import Anthropic from '@anthropic-ai/sdk';
import {
  normalizeAnthropicApiUrl,
  normalizeProviderApiUrl,
  shouldUseAnthropicAuthToken,
} from '../shared/provider-url';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatPayload {
  messages: ChatMessage[];
  apiKey?: string;
  apiUrl?: string;
  model: string;
  providerType: 'openai' | 'anthropic' | 'ollama' | 'custom';
}

function cleanOllamaUrl(url: string): string {
  if (!url) return 'http://localhost:11434';
  return url.replace(/\/api\/chat\/?$/, '')
            .replace(/\/api\/tags\/?$/, '')
            .replace(/\/api\/generate\/?$/, '')
            .replace(/\/api\/?$/, '')
            .replace(/\/v1\/?$/, '')
            .replace(/\/?$/, '');
}

function createLangChainModel(payload: ChatPayload) {
  const { apiKey, apiUrl, model, providerType } = payload;
  const normalizedApiUrl = normalizeProviderApiUrl(apiUrl);

  switch (providerType) {
    case 'openai':
    case 'custom': {
      const config: Record<string, unknown> = {
        model,
        temperature: 0,
        streaming: true,
      };
      if (apiKey) config.apiKey = apiKey;
      if (normalizedApiUrl) {
        // Strip trailing /chat/completions if present (LangChain appends it)
        const baseUrl = normalizedApiUrl.replace(/\/chat\/completions\/?$/, '').replace(/\/?$/, '');
        config.configuration = { baseURL: baseUrl };
      }
      return new ChatOpenAI(config);
    }
    case 'anthropic': {
      const config: Record<string, unknown> = {
        model,
        temperature: 0,
        streaming: true,
        maxTokens: 4096,
      };
      const useAuthToken = shouldUseAnthropicAuthToken(normalizedApiUrl, apiKey);
      if (apiKey && !useAuthToken) config.apiKey = apiKey;
      if (normalizedApiUrl) {
        config.anthropicApiUrl = normalizeAnthropicApiUrl(normalizedApiUrl);
      }
      if (apiKey && useAuthToken) {
        config.createClient = (options: ConstructorParameters<typeof Anthropic>[0]) =>
          new Anthropic({
            ...options,
            apiKey: null,
            authToken: apiKey.trim(),
          });
      }
      return new ChatAnthropic(config);
    }
    case 'ollama': {
      const baseUrl = cleanOllamaUrl(normalizedApiUrl || 'http://localhost:11434');
      return new ChatOllama({
        model,
        baseUrl,
        temperature: 0,
      });
    }
    default:
      throw new Error(`Unsupported provider type: ${providerType}`);
  }
}

const activeRequests = new Map<string, AbortController>();

export function stopLLMChat(requestId: string): void {
  const controller = activeRequests.get(requestId);
  if (controller) {
    controller.abort();
    activeRequests.delete(requestId);
  }
}

async function streamModelResponse(
  model: Awaited<ReturnType<typeof createLangChainModel>>,
  sender: WebContents,
  channel: string,
  messages: ChatMessage[],
  signal: AbortSignal
) {
  const stream = await model.stream(
    messages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
    { signal }
  );

  for await (const chunk of stream) {
    if (signal.aborted) {
      break;
    }
    const content = chunk.content;
    if (content && typeof content === 'string') {
      sender.send(channel, { type: 'chunk', text: content });
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === 'object' && 'text' in block) {
          sender.send(channel, { type: 'chunk', text: (block as { text: string }).text });
        }
      }
    }
  }
}

export async function runLLMChat(
  sender: WebContents,
  requestId: string,
  payload: ChatPayload
): Promise<void> {
  const { messages } = payload;
  const channel = `llm:chunk-${requestId}`;
  const controller = new AbortController();
  activeRequests.set(requestId, controller);

  try {
    const model = createLangChainModel(payload);
    await streamModelResponse(model, sender, channel, messages, controller.signal);
    sender.send(channel, { type: 'done' });
  } catch (err: any) {
    if (err?.name === 'AbortError' || controller.signal.aborted) {
      sender.send(channel, { type: 'done' });
    } else {
      const errorMessage =
        err?.status === 401
          ? 'API Key 无效或未授权，请到模型配置中重新填写并保存。'
          : err.message;
      sender.send(channel, { type: 'error', error: errorMessage });
      throw err;
    }
  } finally {
    activeRequests.delete(requestId);
  }
}

export async function fetchOllamaModels(apiUrl: string): Promise<string[]> {
  const baseUrl = cleanOllamaUrl(apiUrl || 'http://localhost:11434');
  const response = await fetch(`${baseUrl}/api/tags`);
  if (!response.ok) {
    throw new Error(`Failed to fetch Ollama models: ${response.statusText}`);
  }
  const data = await response.json();
  return data.models?.map((m: any) => m.name) || [];
}
