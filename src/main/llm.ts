import { WebContents } from 'electron';
import { Command } from '@langchain/langgraph';
import db from './database';
import { getOllamaBaseUrl, takeModelReasoningCapture, takeModelTextCapture } from './deepagent/llm-adapter';
import { DELEGATED_TASK_RESULT_SCHEMA, DEEPAGENT_CHECKPOINT_NAMESPACE, createDeepAgentRuntime } from './deepagent/runtime';
import { createStreamAccumulator, LLMStreamAccumulator, runWithStreamAccumulator } from './deepagent/stream-accumulator';
import type {
  AgentApprovalResolution,
  AgentRunStatus,
  AgentToolCallStatus,
} from '../shared/types';

/**
 * Build task tool input package for subagent delegation.
 * D-03: Agent.slug is the task(name) unique stable key.
 *
 * @param agentSlug - Subagent's slug (stable key)
 * @param goal - Task description
 * @returns Task tool input object { name, task: jsonString }
 */
export function buildTaskPackage(agentSlug: string, goal: string): { name: string; task: string } {
  const taskPackage = {
    name: agentSlug,
    goal,
  };
  return {
    name: agentSlug,
    task: JSON.stringify(taskPackage),
  };
}

export interface ChatPayload {
  projectId: string;
  sessionId: string;
  agentId?: string | null;
  message: {
    id: string;
    content: string;
  };
  overrides?: {
    providerId?: string;
    model?: string;
  };
}

const activeRequests = new Map<string, AbortController>();
const pendingApprovals = new Map<string, (resolution: AgentApprovalResolution) => void>();

function safeStringify(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createRun(sessionId: string, agentId: string, requestId: string): string {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO agent_runs (id, session_id, agent_id, request_id, status, started_at, aborted)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(id, sessionId, agentId, requestId, 'running', Date.now());
  return id;
}

function updateRun(runId: string, status: AgentRunStatus, error?: string, aborted = false): void {
  const endedAt = ['completed', 'failed', 'aborted'].includes(status) ? Date.now() : null;
  db.prepare(`
    UPDATE agent_runs
    SET status = ?, error = ?, ended_at = COALESCE(?, ended_at), aborted = ?
    WHERE id = ?
  `).run(status, error || null, endedAt, aborted ? 1 : 0, runId);
}

function upsertToolCall(runId: string, toolCallId: string, name: string, input: unknown): void {
  const existing = db.prepare('SELECT id FROM agent_tool_calls WHERE id = ?').get(toolCallId);
  if (existing) {
    db.prepare(`
      UPDATE agent_tool_calls
      SET tool_name = ?, input = ?, status = 'running'
      WHERE id = ?
    `).run(name, safeStringify(input), toolCallId);
  } else {
    db.prepare(`
      INSERT INTO agent_tool_calls (id, run_id, tool_name, input, status, started_at)
      VALUES (?, ?, ?, ?, 'running', ?)
    `).run(toolCallId, runId, name, safeStringify(input), Date.now());
  }
}

function updateToolCall(id: string, status: AgentToolCallStatus, output?: unknown, error?: string): void {
  db.prepare(`
    UPDATE agent_tool_calls
    SET status = ?, output = ?, error = ?, ended_at = ?
    WHERE id = ?
  `).run(status, safeStringify(output), error || null, Date.now(), id);
}

function markApprovalStatus(runId: string, status: string): void {
  db.prepare(`
    UPDATE agent_tool_calls
    SET approval_status = ?
    WHERE run_id = ? AND status = 'running'
  `).run(status, runId);
}

function getLatestRunId(requestId: string): string | null {
  const row = db.prepare('SELECT id FROM agent_runs WHERE request_id = ? ORDER BY started_at DESC LIMIT 1').get(requestId) as { id: string } | undefined;
  return row?.id || null;
}

function getInterruptValue(output: any) {
  return output?.__interrupt__?.[0]?.value || output?.interrupts?.[0]?.value || null;
}

function getStreamInterruptValue(run: any) {
  const interrupts = run?.interrupts;
  if (!Array.isArray(interrupts) || interrupts.length === 0) {
    return null;
  }
  const interrupt = interrupts[0];
  return interrupt?.value || interrupt?.payload || null;
}

async function waitForRunTerminal(run: any, signal: AbortSignal): Promise<'completed' | 'interrupted' | 'failed' | null> {
  const lifecycle = run?.lifecycle;
  if (!lifecycle || typeof lifecycle[Symbol.asyncIterator] !== 'function') {
    return null;
  }
  for await (const entry of lifecycle) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (Array.isArray(entry?.namespace) && entry.namespace.length > 0) {
      continue;
    }
    if (entry?.event === 'completed' || entry?.event === 'interrupted' || entry?.event === 'failed') {
      return entry.event;
    }
  }
  return null;
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

async function waitForRunOutputOrTerminal(run: any, signal: AbortSignal): Promise<{ output?: any; terminal: 'completed' | 'interrupted' | 'failed' | null }> {
  const outputPromise = Promise.resolve(run.output).then((output) => ({ output, terminal: null }));
  const waits: Array<Promise<{ output?: any; terminal: 'completed' | 'interrupted' | 'failed' | null }>> = [
    outputPromise,
    waitForAbort(signal),
  ];
  if (run?.lifecycle && typeof run.lifecycle[Symbol.asyncIterator] === 'function') {
    waits.push(waitForRunTerminal(run, signal).then((terminal) => ({ output: undefined, terminal })));
  }
  return Promise.race(waits);
}

function getLatestAssistantContent(output: any): string | null {
  if (!output) return null;
  
  let messages: any[] = [];
  if (Array.isArray(output)) {
    messages = output;
  } else if (Array.isArray(output.messages)) {
    messages = output.messages;
  } else if (output.values && Array.isArray(output.values.messages)) {
    messages = output.values.messages;
  }
  
  if (messages.length === 0) return null;
  
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    
    const isAssistant = 
      msg.role === 'assistant' ||
      msg._getType?.() === 'ai' ||
      (msg.constructor && (msg.constructor.name === 'AIMessage' || msg.constructor.name === 'AIMessageChunk'));
      
    if (isAssistant) {
      let content = msg.content;
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        const textParts = content
          .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
          .map((part: any) => part.text);
        if (textParts.length > 0) {
          return textParts.join('');
        }
      }
    }
  }
  return null;
}

function toApprovalRequest(runId: string, interruptValue: any) {
  const actions = Array.isArray(interruptValue?.actionRequests) ? interruptValue.actionRequests : [];
  const reviewConfigs = Array.isArray(interruptValue?.reviewConfigs) ? interruptValue.reviewConfigs : [];
  return {
    id: crypto.randomUUID(),
    runId,
    actions: actions.map((action: any, index: number) => ({
      name: action?.name || action?.action || action?.tool || `tool-${index + 1}`,
      args: action?.args,
      description: reviewConfigs[index]?.description || action?.description,
      allowedDecisions: reviewConfigs[index]?.allowedDecisions,
    })),
  };
}

function markTextSent(accumulator: LLMStreamAccumulator): void {
  accumulator.hasSentText = true;
}

function markReasoningSent(accumulator: LLMStreamAccumulator): void {
  accumulator.hasSentReasoning = true;
}

function takeReasoningText(accumulator: LLMStreamAccumulator, model: unknown): string {
  const accumulatorText = accumulator.takeReasoning();
  const modelText = takeModelReasoningCapture(model);
  return accumulatorText || modelText;
}

function getFallbackText(accumulator: LLMStreamAccumulator, model: unknown): string {
  const modelText = takeModelTextCapture(model);
  return accumulator.normalText.trim() ? accumulator.normalText : modelText;
}

export function resolveLLMApproval(requestId: string, resolution: AgentApprovalResolution): void {
  const key = `${requestId}:${resolution.approvalId}`;
  const resolver = pendingApprovals.get(key);
  if (resolver) {
    pendingApprovals.delete(key);
    resolver(resolution);
  }
}

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
  const accumulator = createStreamAccumulator();
  accumulator.sender = sender;
  accumulator.channel = channel;

  return runWithStreamAccumulator(accumulator, async () => {
    let cleanup = async () => {};
    try {
      const runtime = await createDeepAgentRuntime(
        payload.projectId,
        payload.sessionId,
        payload.message,
        payload.agentId,
        payload.overrides
      );
      cleanup = runtime.cleanup;

    const runId = createRun(payload.sessionId, runtime.agentId, requestId);
    sender.send(channel, { type: 'run_started', runId, agentId: runtime.agentId, status: 'running' });

    let nextInput: any = { messages: runtime.inputMessages };

    while (!controller.signal.aborted) {
      accumulator.hasSentText = false;
      accumulator.hasSentReasoning = false;
      const run = await runtime.agent.streamEvents(
        nextInput,
        {
          version: 'v3',
          signal: controller.signal,
          configurable: {
            thread_id: payload.sessionId,
            checkpoint_ns: DEEPAGENT_CHECKPOINT_NAMESPACE,
          },
        }
      );
      const messageStreamPromise = (async () => {
        for await (const msg of run.messages) {
          if (controller.signal.aborted) break;

          let isReasoningDone = false;
          let hasSentReasoning = false;
          const textBuffer: string[] = [];

          console.log(`[LLM STREAM] === 新消息 Chunk ===`);
          console.log(`[LLM STREAM] 是否存在 msg.reasoning:`, msg.reasoning !== undefined && msg.reasoning !== null);
          try {
            console.log(`[LLM STREAM] msg 所有的键:`, Object.keys(msg || {}));
            console.log(`[LLM STREAM] msg.reasoning 的类型:`, typeof msg?.reasoning);
            if (msg && typeof msg === 'object') {
              for (const key of Object.getOwnPropertyNames(msg)) {
                const val = (msg as any)[key];
                console.log(`[LLM STREAM] 探测 msg.${key} =`, typeof val === 'object' ? safeStringify(val) : typeof val);
              }
            }
          } catch (e: any) {
            console.log(`[LLM STREAM] 深度探测失败:`, e?.message);
          }

          const checkAndFlushCache = () => {
            const reasoningText = takeReasoningText(accumulator, runtime.model);
            if (!hasSentReasoning && reasoningText) {
              hasSentReasoning = true;
              markReasoningSent(accumulator);
              console.log(`[LLM STREAM] 双重保险：从 request accumulator 冲刷发送思考内容`);
              sender.send(channel, { type: 'message_chunk', text: '<think>' });
              sender.send(channel, { type: 'message_chunk', text: reasoningText });
              sender.send(channel, { type: 'message_chunk', text: '</think>\n\n' });
            }
          };

          const consumeReasoning = async () => {
            let hasReasoning = false;
            for await (const token of msg.reasoning ?? []) {
              if (controller.signal.aborted) break;
              if (!hasReasoning) {
                hasReasoning = true;
                hasSentReasoning = true;
                markReasoningSent(accumulator);
                console.log(`[LLM STREAM] 监听到 Native Reasoning 字段流开启，向前端发送 <think>`);
                sender.send(channel, { type: 'message_chunk', text: '<think>' });
              }
              console.log(`[LLM STREAM] Native Reasoning Token:`, JSON.stringify(token));
              sender.send(channel, { type: 'message_chunk', text: token });
            }
            if (hasReasoning && !controller.signal.aborted) {
              console.log(`[LLM STREAM] Native Reasoning 字段流结束，向前端发送 </think>`);
              sender.send(channel, { type: 'message_chunk', text: '</think>\n\n' });
            }
            isReasoningDone = true;
            checkAndFlushCache();
            if (textBuffer.length > 0 && !controller.signal.aborted) {
              console.log(`[LLM STREAM] Reasoning 流结束，正在冲刷缓存的 Text Tokens:`, JSON.stringify(textBuffer.join('')));
              for (const t of textBuffer) {
                markTextSent(accumulator);
                sender.send(channel, { type: 'message_chunk', text: t });
              }
              textBuffer.length = 0;
            }
          };

          const consumeText = async () => {
            for await (const token of msg.text) {
              if (controller.signal.aborted) break;
              console.log(`[LLM STREAM] Text Token:`, JSON.stringify(token));
              // reasoning 存在（不是 null/undefined/空数组）且未完成时才积压文本
              const hasReasoningSource = msg.reasoning != null && !Array.isArray(msg.reasoning);
              if (hasReasoningSource && !isReasoningDone) {
                textBuffer.push(token);
              } else {
                checkAndFlushCache();
                markTextSent(accumulator);
                sender.send(channel, { type: 'message_chunk', text: token });
              }
            }
          };

          await Promise.all([consumeReasoning(), consumeText()]);
        }
      })();

      const toolStreamPromise = (async () => {
        for await (const call of run.toolCalls) {
          if (controller.signal.aborted) break;

          const reasoningText = takeReasoningText(accumulator, runtime.model);
          if (reasoningText) {
            console.log(`[LLM STREAM] 在工具调用前冲刷发送 request accumulator 思考`);
            markReasoningSent(accumulator);
            sender.send(channel, { type: 'message_chunk', text: '<think>' });
            sender.send(channel, { type: 'message_chunk', text: reasoningText });
            sender.send(channel, { type: 'message_chunk', text: '</think>\n\n' });
          }

          const toolCallId = call.callId || crypto.randomUUID();
          upsertToolCall(runId, toolCallId, call.name, call.input);
          sender.send(channel, {
            type: 'tool_start',
            id: toolCallId,
            name: call.name,
            input: call.input,
          });

          // D-12: Detect task tool calls and emit delegated_task_start
          if (call.name === 'task') {
            const taskId = toolCallId;
            const input = call.input as { name?: string; task?: string };
            const agentSlug = input?.name || 'unknown';
            let goal = '';

            // D-03: task input's task field is a JSON string containing goal
            if (input?.task) {
              try {
                const taskPackage = JSON.parse(input.task);
                goal = taskPackage.goal || '';
              } catch {
                console.warn('[LLM] Failed to parse task input JSON:', input.task);
                goal = input?.name || '任务执行';
              }
            }

            const agentName = agentSlug; // fallback to slug

            sender.send(channel, {
              type: 'delegated_task_start',
              taskId,
              agentSlug,
              agentName,
              goal,
            });
          }

          try {
            const output = await call.output;
            updateToolCall(toolCallId, 'success', output);
            sender.send(channel, {
              type: 'tool_end',
              id: toolCallId,
              name: call.name,
              output,
            });

            // D-11/D-14: Parse task tool output and emit delegated_task_end
            if (call.name === 'task') {
              let parsedResult;
              let errorCode: string | undefined;
              let status: 'success' | 'failure' = 'success';

              try {
                const rawOutput = typeof output === 'string' ? output : JSON.stringify(output);
                const parsed = DELEGATED_TASK_RESULT_SCHEMA.safeParse(JSON.parse(rawOutput));
                if (parsed.success) {
                  parsedResult = parsed.data;
                  if (parsedResult.status === 'failure') {
                    status = 'failure';
                    errorCode = parsedResult.error?.code;
                  }
                } else {
                  status = 'failure';
                  errorCode = 'PARSE_FAILED';
                  parsedResult = {
                    status: 'failure',
                    artifacts: [],
                    summary: '',
                    error: { code: 'PARSE_FAILED', message: `无法解析子Agent返回: ${rawOutput.slice(0, 200)}` },
                  };
                }
              } catch (err: any) {
                status = 'failure';
                errorCode = 'PARSE_FAILED';
                parsedResult = {
                  status: 'failure',
                  artifacts: [],
                  summary: '',
                  error: { code: 'PARSE_FAILED', message: err?.message || 'unknown parse error' },
                };
              }

              sender.send(channel, {
                type: 'delegated_task_end',
                taskId: toolCallId,
                status,
                result: parsedResult,
                errorCode,
              });
            }
          } catch (error: any) {
            updateToolCall(toolCallId, 'error', undefined, error?.message || String(error));
            sender.send(channel, {
              type: 'tool_error',
              id: toolCallId,
              name: call.name,
              error: error?.message || String(error),
            });

            if (call.name === 'task') {
              // D-11: Classify error type and wrap
              let errorCode = 'UNKNOWN';
              const msg = error?.message || '';
              if (msg.toLowerCase().includes('timeout')) {
                errorCode = 'TIMEOUT';
              } else if (msg.toLowerCase().includes('interrupt') || msg.toLowerCase().includes('cancel')) {
                errorCode = 'INTERRUPTED';
              }

              sender.send(channel, {
                type: 'delegated_task_end',
                taskId: toolCallId,
                status: 'failure',
                result: {
                  status: 'failure',
                  artifacts: [],
                  summary: '',
                  error: { code: errorCode, message: msg },
                },
                errorCode,
              });
            }
          }
        }
      })();

      await Promise.all([messageStreamPromise, toolStreamPromise]);

      let interruptValue = getStreamInterruptValue(run);
      let output: any;
      let terminal: 'completed' | 'interrupted' | 'failed' | null = null;
      if (!interruptValue) {
        try {
          const result = await waitForRunOutputOrTerminal(run, controller.signal);
          output = result.output;
          terminal = result.terminal;
          console.log(`[LLM STREAM] run.output 已返回，是否有 value = ${!!output}`);
          if (output) {
            const assistantContent = getLatestAssistantContent(output);
            console.log(`[LLM STREAM] 从 output 提取出的 latest assistantContent 长度 =`, assistantContent?.length ?? 0);
          }
        } catch (err: any) {
          if (err?.name === 'AbortError' || controller.signal.aborted) {
            throw err;
          }
          console.log(`[LLM STREAM] run.output 发生错误:`, err?.message);
          output = undefined;
        }
      }

      if (accumulator.hasSentReasoning && !accumulator.hasSentReasoningClosed) {
        console.log(`[LLM STREAM] 闭合未结束的实时思考流`);
        sender.send(channel, { type: 'message_chunk', text: '</think>\n\n' });
        accumulator.hasSentReasoningClosed = true;
      }

      if (!accumulator.hasSentReasoning) {
        const reasoningText = takeReasoningText(accumulator, runtime.model);
        if (reasoningText) {
          console.log(`[LLM STREAM] 轮次结束前冲刷发送残留的思考`);
          markReasoningSent(accumulator);
          sender.send(channel, { type: 'message_chunk', text: '<think>' });
          sender.send(channel, { type: 'message_chunk', text: reasoningText });
          sender.send(channel, { type: 'message_chunk', text: '</think>\n\n' });
        }
      }

      if (!accumulator.hasSentText) {
        const assistantContent = getLatestAssistantContent(output);
        if (assistantContent && assistantContent.trim()) {
          console.log(`[LLM STREAM] 非流式输出检测，向前端补发正文 content length:`, assistantContent.length);
          sender.send(channel, { type: 'message_chunk', text: assistantContent });
          markTextSent(accumulator);
        } else {
          const fallbackText = getFallbackText(accumulator, runtime.model);
          if (fallbackText.trim()) {
            console.log(`[LLM STREAM] 从 request accumulator 补发正文 content length:`, fallbackText.length);
            sender.send(channel, { type: 'message_chunk', text: fallbackText });
            markTextSent(accumulator);
          }
        }
      }
      accumulator.clearText();

      interruptValue ||= getInterruptValue(output);
      if (!interruptValue) {
        try {
          interruptValue = getStreamInterruptValue(run);
        } catch {
          // ignore optional interrupt fallback
        }
      }

      if (!interruptValue) {
        if (terminal === 'failed') {
          throw new Error('Agent run failed.');
        }
        updateRun(runId, 'completed');
        sender.send(channel, { type: 'run_updated', runId, status: 'completed' });
        break;
      }

      const approval = toApprovalRequest(runId, interruptValue);
      updateRun(runId, 'waiting_approval');
      markApprovalStatus(runId, 'pending');
      sender.send(channel, { type: 'run_updated', runId, status: 'waiting_approval' });
      sender.send(channel, { type: 'approval_required', approval });

      const resolution = await new Promise<AgentApprovalResolution>((resolve, reject) => {
        const key = `${requestId}:${approval.id}`;
        pendingApprovals.set(key, resolve);
        controller.signal.addEventListener('abort', () => {
          pendingApprovals.delete(key);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });

      const approvalStatus = resolution.decisions.some((decision) => decision.type === 'edit')
        ? 'edited'
        : resolution.decisions.every((decision) => decision.type === 'approve')
          ? 'approved'
          : 'rejected';
      markApprovalStatus(runId, approvalStatus);
      sender.send(channel, { type: 'approval_resolved', approvalId: approval.id, status: approvalStatus });

      if (approvalStatus === 'rejected') {
        const runningTools = db.prepare(`
          SELECT id, tool_name FROM agent_tool_calls
          WHERE run_id = ? AND status = 'running'
        `).all(runId) as Array<{ id: string; tool_name: string }>;

        for (const tool of runningTools) {
          updateToolCall(tool.id, 'skipped');
          sender.send(channel, {
            type: 'tool_error',
            id: tool.id,
            name: tool.tool_name,
            error: '用户拒绝执行该操作',
          });
        }
      }

      updateRun(runId, 'running');
      sender.send(channel, { type: 'run_updated', runId, status: 'running' });
      nextInput = new Command({ resume: { decisions: resolution.decisions } });
    }

    if (controller.signal.aborted) {
      updateRun(runId, 'aborted', undefined, true);
      sender.send(channel, { type: 'run_updated', runId, status: 'aborted' });
    }

    sender.send(channel, { type: 'message_done' });
  } catch (error: any) {
    const runId = getLatestRunId(requestId);
    if (runId) {
      const status = error?.name === 'AbortError' || controller.signal.aborted ? 'aborted' : 'failed';
      updateRun(runId, status, error?.message || String(error), status === 'aborted');
      sender.send(channel, {
        type: 'run_updated',
        runId,
        status,
        error: error?.message || String(error),
      });
    }
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
  });
}

export async function fetchOllamaModels(apiUrl: string): Promise<string[]> {
  const response = await fetch(`${getOllamaBaseUrl(apiUrl || 'http://localhost:11434')}/api/tags`);
  if (!response.ok) {
    throw new Error(`Failed to fetch Ollama models: ${response.statusText}`);
  }
  const data = await response.json();
  return data.models?.map((model: any) => model.name) || [];
}
