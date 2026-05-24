import { WebContents } from 'electron';
import { getOllamaBaseUrl } from './deepagent/llm-adapter';
import { createDeepAgentRuntime, extractSummaryFromState, persistSessionSummary } from './deepagent/runtime';

export interface ChatPayload {
  projectId: string;
  sessionId: string;
  overrides?: {
    providerId?: string;
    model?: string;
  };
}

const activeRequests = new Map<string, AbortController>();

export function stopLLMChat(requestId: string): void {
  const controller = activeRequests.get(requestId);
  if (controller) {
    controller.abort();
    activeRequests.delete(requestId);
  }
}

export async function runLLMChat(sender: WebContents, requestId: string, payload: ChatPayload): Promise<void> {
  const channel = `llm:chunk-${requestId}`;
  const controller = new AbortController();
  activeRequests.set(requestId, controller);

  let cleanup = async () => {};

  try {
    const runtime = await createDeepAgentRuntime(
      payload.projectId,
      payload.sessionId,
      payload.overrides
    );
    cleanup = runtime.cleanup;

    const run = await runtime.agent.streamEvents(
      { messages: runtime.inputMessages },
      {
        version: 'v3',
        signal: controller.signal,
        configurable: {
          thread_id: payload.sessionId,
        },
      }
    );

    const messageStreamPromise = (async () => {
      for await (const msg of run.messages) {
        if (controller.signal.aborted) break;

        for await (const token of msg.text) {
          if (controller.signal.aborted) break;
          sender.send(channel, { type: 'message_chunk', text: token });
        }
      }
    })();

    const toolStreamPromise = (async () => {
      for await (const call of run.toolCalls) {
        if (controller.signal.aborted) break;
        sender.send(channel, {
          type: 'tool_start',
          name: call.name,
          input: call.input,
        });

        try {
          const output = await call.output;
          sender.send(channel, {
            type: 'tool_end',
            name: call.name,
            output,
          });
        } catch (error: any) {
          sender.send(channel, {
            type: 'tool_error',
            name: call.name,
            error: error?.message || String(error),
          });
        }
      }
    })();

    // 三路并行：output + messages流 + toolCalls流，防止竞态丢事件
    const [finalState] = await Promise.all([run.output, messageStreamPromise, toolStreamPromise]);
    persistSessionSummary(payload.sessionId, extractSummaryFromState(finalState));

    sender.send(channel, { type: 'message_done' });
  } catch (error: any) {
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      sender.send(channel, { type: 'message_done' });
    } else {
      sender.send(channel, {
        type: 'runtime_error',
        error: error?.message || String(error),
      });
      throw error;
    }
  } finally {
    activeRequests.delete(requestId);
    await cleanup();
  }
}

export async function fetchOllamaModels(apiUrl: string): Promise<string[]> {
  const response = await fetch(`${getOllamaBaseUrl(apiUrl || 'http://localhost:11434')}/api/tags`);
  if (!response.ok) {
    throw new Error(`Failed to fetch Ollama models: ${response.statusText}`);
  }
  const data = await response.json();
  return data.models?.map((model: any) => model.name) || [];
}
