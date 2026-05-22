import { WebContents } from 'electron';

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

export async function runLLMChat(
  sender: WebContents,
  requestId: string,
  payload: ChatPayload
): Promise<void> {
  const { messages, apiKey, apiUrl, model, providerType } = payload;
  
  let url = '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  let body: any = {};

  if (providerType === 'openai' || providerType === 'custom') {
    url = apiUrl || 'https://api.openai.com/v1/chat/completions';
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    body = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
    };
  } else if (providerType === 'anthropic') {
    url = apiUrl || 'https://api.anthropic.com/v1/messages';
    headers['x-api-key'] = apiKey || '';
    headers['anthropic-version'] = '2023-06-01';
    
    const systemMessages = messages.filter(m => m.role === 'system');
    const systemPrompt = systemMessages.map(m => m.content).join('\n');
    const userMessages = messages.filter(m => m.role !== 'system');

    body = {
      model,
      messages: userMessages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: 4096,
      stream: true,
    };
    if (systemPrompt) {
      body.system = systemPrompt;
    }
  } else if (providerType === 'ollama') {
    const baseUrl = apiUrl || 'http://localhost:11434';
    url = `${baseUrl}/api/chat`;
    body = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM Error (${response.status}): ${errorText || response.statusText}`);
  }

  if (!response.body) {
    throw new Error('Response body is empty');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const channel = `llm:chunk-${requestId}`;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      if (providerType === 'ollama') {
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const data = JSON.parse(trimmed);
            if (data.message && data.message.content) {
              sender.send(channel, { type: 'chunk', text: data.message.content });
            }
          } catch (err) {
            console.error('Failed to parse Ollama JSON line:', trimmed, err);
          }
        }
      } else {
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]') continue;
            try {
              const data = JSON.parse(dataStr);
              if (providerType === 'anthropic') {
                if (data.type === 'content_block_delta' && data.delta && data.delta.text) {
                  sender.send(channel, { type: 'chunk', text: data.delta.text });
                }
              } else {
                const choice = data.choices?.[0];
                const content = choice?.delta?.content;
                if (content) {
                  sender.send(channel, { type: 'chunk', text: content });
                }
              }
            } catch (err) {
              // ignore partial lines or other event formats
            }
          }
        }
      }
    }

    if (buffer.trim() && providerType === 'ollama') {
      try {
        const data = JSON.parse(buffer.trim());
        if (data.message && data.message.content) {
          sender.send(channel, { type: 'chunk', text: data.message.content });
        }
      } catch (e) {}
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
