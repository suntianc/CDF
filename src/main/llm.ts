import { WebContents } from 'electron';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOllama } from '@langchain/ollama';

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

function createLangChainModel(payload: ChatPayload) {
  const { apiKey, apiUrl, model, providerType } = payload;

  switch (providerType) {
    case 'openai':
    case 'custom': {
      const config: Record<string, unknown> = {
        model,
        temperature: 0,
        streaming: true,
      };
      if (apiKey) config.apiKey = apiKey;
      if (apiUrl) config.configuration = { baseURL: apiUrl };
      return new ChatOpenAI(config);
    }
    case 'anthropic': {
      const config: Record<string, unknown> = {
        model,
        temperature: 0,
        streaming: true,
        maxTokens: 4096,
      };
      if (apiKey) config.apiKey = apiKey;
      if (apiUrl) config.clientOptions = { baseURL: apiUrl };
      return new ChatAnthropic(config);
    }
    case 'ollama': {
      const baseUrl = apiUrl || 'http://localhost:11434';
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

export async function runLLMChat(
  sender: WebContents,
  requestId: string,
  payload: ChatPayload
): Promise<void> {
  const { messages } = payload;
  const model = createLangChainModel(payload);
  const channel = `llm:chunk-${requestId}`;

  try {
    const stream = await model.stream(
      messages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }))
    );

    for await (const chunk of stream) {
      const content = chunk.content;
      if (content && typeof content === 'string') {
        sender.send(channel, { type: 'chunk', text: content });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === 'object') {
            if ('text' in block && block.text) {
              sender.send(channel, { type: 'chunk', text: block.text as string });
            } else if ('thinking' in block && block.thinking) {
              // Anthropic extended thinking — wrap in think tags for frontend rendering
              sender.send(channel, { type: 'chunk', text: ` thinking${block.thinking} response` });
            }
          }
        }
      }
    }

    sender.send(channel, { type: 'done' });
  } catch (err: any) {
    sender.send(channel, { type: 'error', error: err.message });
    throw err;
  }
}

export async function fetchOllamaModels(apiUrl: string): Promise<string[]> {
  const baseUrl = apiUrl || 'http://localhost:11434';
  const response = await fetch(`${baseUrl}/api/tags`);
  if (!response.ok) {
    throw new Error(`Failed to fetch Ollama models: ${response.statusText}`);
  }
  const data = await response.json();
  return data.models?.map((m: any) => m.name) || [];
}