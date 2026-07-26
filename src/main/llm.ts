import { Command } from '@langchain/langgraph';
import db from './database';
import log from './logger';
import { getOllamaBaseUrl, takeModelReasoningCapture, takeModelTextCapture } from './deepagent/llm-adapter';
import { createDeepAgentRuntime, createRuntimeModel } from './deepagent/runtime';
import { DELEGATED_TASK_RESULT_SCHEMA } from '../shared/types';
import { subagentStepStorage } from './deepagent/subagent-step-storage';
import { isTransientRuntimeError } from './deepagent/runtime-errors';
import { CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED, DEEPAGENT_CHECKPOINT_NAMESPACE } from './deepagent/conversation-working-state';
import { createStreamAccumulator, LLMStreamAccumulator, runWithStreamAccumulator } from './deepagent/stream-accumulator';
import type {
  AgentApprovalResolution,
  AgentRunStatus,
  AgentToolCallStatus,
  ChatPayload,
  ExecutionStep,
  JudgePayload,
  SkillAttribution,
  WorkflowRunStatus,
} from '../shared/types';
import { llmChunkChannel } from '../shared/ipc-contract';
import { getRunBySessionId, isAdvanceStageInterrupt, handleAdvanceStageInterrupt, registerResumeAgentCallback, resumeWorkflowRunFromInput } from './workflow-run';
import { updateRunStatus } from './workflow-run/db';
import { conversationRunStreams } from './conversation-run-stream-runtime';
import type { ActiveConversationRunStream } from './conversation-run-streams';

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

// ChatPayload / JudgePayload 已迁移至 src/shared/types.ts（IPC 契约共享）。
export type { ChatPayload, JudgePayload } from '../shared/types';
export interface LLMChatEventSender {
  send(channel: string, payload: unknown): void;
}

let conversationIdleListener: ((sessionId: string) => void) | null = null;

export function setConversationIdleListener(listener: (sessionId: string) => void): void {
  conversationIdleListener = listener;
}

const activeRequests = new Map<string, AbortController>();
const activeRuntimes = new Map<string, { cancelDelegatedRuns?: (parentRunId: string) => void }>();
const pendingApprovals = new Map<string, (resolution: AgentApprovalResolution) => void>();

// think-tag 常量与可见文本过滤器已迁入 Runtime Stream Projection 纯核心。
import {
  createRuntimeStreamState,
  projectRuntimeStream,
  type RuntimeStreamEvent,
  type RuntimeStreamProjectionDeps,
} from './runtime-stream-projection';

function isInterruptError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { name?: string; message?: string };
  const name = err.name?.toLowerCase() ?? '';
  const message = err.message?.toLowerCase() ?? '';
  if (name.includes('interrupt') || message.includes('interrupt') || message.includes('nodeinterrupt') || message.includes('graphinterrupt')) {
    return true;
  }
  return message.includes('actionrequests') && message.includes('reviewconfigs');
}

function findStructuredRuntimeError(error: unknown): {
  code?: unknown;
  messageKey?: unknown;
  messageParams?: unknown;
} | undefined {
  const visited = new Set<object>();
  let codeOnlyFallback: {
    code?: unknown;
    messageKey?: unknown;
    messageParams?: unknown;
  } | undefined;
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth += 1) {
    if (visited.has(current)) break;
    visited.add(current);
    const candidate = current as {
      code?: unknown;
      messageKey?: unknown;
      messageParams?: unknown;
      cause?: unknown;
    };
    if (typeof candidate.messageKey === 'string') {
      return candidate;
    }
    if (!codeOnlyFallback && typeof candidate.code === 'string') {
      codeOnlyFallback = candidate;
    }
    current = candidate.cause;
  }
  return codeOnlyFallback;
}

function safeStringify(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseDelegatedTaskCallInput(input: unknown): { targetAgentSlug: string; goal: string } | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as {
    subagent_type?: unknown;
    name?: unknown;
    description?: unknown;
    task?: unknown;
  };
  const targetAgentSlug = typeof value.subagent_type === 'string'
    ? value.subagent_type
    : typeof value.name === 'string'
      ? value.name
      : '';
  if (!targetAgentSlug) return null;

  if (typeof value.description === 'string') {
    return { targetAgentSlug, goal: value.description };
  }
  if (typeof value.task === 'string') {
    try {
      const task = JSON.parse(value.task) as { goal?: unknown };
      if (typeof task.goal === 'string') return { targetAgentSlug, goal: task.goal };
    } catch {
      // Compatibility with the old task(name, task) input shape.
    }
  }
  return { targetAgentSlug, goal: '' };
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
  const endedAt = ['completed', 'failed', 'aborted', 'cancelled', 'interrupted'].includes(status) ? Date.now() : null;
  db.prepare(`
    UPDATE agent_runs
    SET status = ?, error = ?, ended_at = COALESCE(?, ended_at), aborted = ?
    WHERE id = ?
  `).run(status, error || null, endedAt, aborted ? 1 : 0, runId);
}

export function delegatedParentRunStatus(runId: string): Extract<AgentRunStatus, 'running' | 'waiting_approval'> {
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS unfinished,
      SUM(CASE WHEN status = 'waiting_approval' THEN 1 ELSE 0 END) AS waiting
    FROM delegated_agent_runs
    WHERE parent_run_id = ? AND status IN ('queued', 'running', 'waiting_approval')
  `).get(runId) as { unfinished?: number; waiting?: number | null } | undefined;
  const unfinished = Number(counts?.unfinished ?? 0);
  const waiting = Number(counts?.waiting ?? 0);
  return unfinished > 0 && unfinished === waiting ? 'waiting_approval' : 'running';
}

export const lastRunApprovals = new Map<string, string>();

function upsertToolCall(
  runId: string,
  toolCallId: string,
  name: string,
  input: unknown,
  delegatedRunId?: string,
): void {
  const existing = db.prepare('SELECT id FROM agent_tool_calls WHERE id = ?').get(toolCallId);
  const approvalStatus = lastRunApprovals.get(runId) || null;
  if (existing) {
    db.prepare(`
      UPDATE agent_tool_calls
      SET tool_name = ?, input = ?, delegated_run_id = COALESCE(?, delegated_run_id),
          status = 'running', approval_status = COALESCE(approval_status, ?)
      WHERE id = ?
    `).run(name, safeStringify(input), delegatedRunId ?? null, approvalStatus, toolCallId);
  } else {
    db.prepare(`
      INSERT INTO agent_tool_calls
        (id, run_id, delegated_run_id, tool_name, input, status, approval_status, started_at)
      VALUES (?, ?, ?, ?, ?, 'running', ?, ?)
    `).run(
      toolCallId,
      runId,
      delegatedRunId ?? null,
      name,
      safeStringify(input),
      approvalStatus,
      Date.now(),
    );
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
  lastRunApprovals.set(runId, status);
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

async function waitForRunOutputOrTerminal(
  run: any,
  signal: AbortSignal
): Promise<{ output?: any; terminal: 'completed' | 'interrupted' | 'failed' | null }> {
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
    const runId = getLatestRunId(requestId);
    if (runId) activeRuntimes.get(requestId)?.cancelDelegatedRuns?.(runId);
    controller.abort();
    activeRequests.delete(requestId);
    activeRuntimes.delete(requestId);
  }
}

function extractModelText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';

  const content = (value as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        const typed = part as { type?: string; text?: unknown; content?: unknown };
        if (typeof typed.text === 'string') return typed.text;
        if (typeof typed.content === 'string') return typed.content;
        return '';
      })
      .join('');
  }
  return '';
}

export async function runLLMJudge(payload: JudgePayload): Promise<{ text: string }> {
  const model = await createRuntimeModel(payload.projectId, payload.overrides);
  const response = await model.invoke(payload.prompt);
  return { text: extractModelText(response) };
}

async function checkAndSendTodos(
  runtime: any,
  sessionId: string,
  sender: LLMChatEventSender,
  channel: string,
  lastTodosJsonRef: { current: string }
) {
  try {
    if (typeof runtime?.agent?.getState !== 'function') {
      return;
    }
    const state = await runtime.agent.getState({
      configurable: {
        thread_id: sessionId,
        checkpoint_ns: DEEPAGENT_CHECKPOINT_NAMESPACE,
      },
    });
    const todos = state?.values?.todos;
    if (Array.isArray(todos)) {
      const todosJson = JSON.stringify(todos);
      if (todosJson !== lastTodosJsonRef.current) {
        lastTodosJsonRef.current = todosJson;
        sender.send(channel, {
          type: 'todos_update',
          todos,
        });
      }
    }
  } catch (err) {
    log.warn('[LLM] Failed to check and send todos:', err);
  }
}

function getToolInputPath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  const rawPath = record.path ?? record.file_path ?? record.filePath ?? record.AbsolutePath ?? record.TargetFile;
  return typeof rawPath === 'string' && rawPath.trim() ? rawPath.trim() : null;
}

function findModelTriggeredSkillAttribution(
  toolName: string,
  input: unknown,
  attributions: SkillAttribution[] | undefined,
  emittedSkillPaths: Set<string>
): SkillAttribution | null {
  if (toolName !== 'read_file') return null;
  const requestedPath = getToolInputPath(input);
  if (!requestedPath || !attributions?.length) return null;
  const attribution = attributions.find((item) => (
    item.phase === 'model-discovery' &&
    item.skillPath === requestedPath
  ));
  if (!attribution || emittedSkillPaths.has(attribution.skillPath)) return null;
  emittedSkillPaths.add(attribution.skillPath);
  return {
    ...attribution,
    phase: 'model-triggered',
  };
}


export async function runLLMChat(sender: LLMChatEventSender, requestId: string, payload: ChatPayload): Promise<void> {
  const channel = llmChunkChannel(requestId);
  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  const accumulator = createStreamAccumulator();
  accumulator.sender = sender;
  accumulator.channel = channel;

  return runWithStreamAccumulator(accumulator, async () => {
    let cleanup = async () => {};
    let unsubscribeDelegatedApprovals = () => {};
    let unsubscribeDelegatedRunChanges = () => {};
    const delegatedApprovalKeys = new Set<string>();
    let runtime: any = null;
    const lastTodosJsonRef = { current: '' };
    try {
      runtime = await createDeepAgentRuntime(
        payload.projectId,
        payload.sessionId,
        payload.message,
        payload.overrides
      );
      cleanup = runtime.cleanup;
      if (!payload.resume) resumeWorkflowRunFromInput(payload.sessionId);
      activeRuntimes.set(requestId, runtime);

    const runId = createRun(payload.sessionId, runtime.agentId, requestId);
    sender.send(channel, { type: 'run_started', runId, agentId: runtime.agentId, status: 'running' });
    if (typeof runtime.subscribeDelegatedToolApprovals === 'function') {
      const publishParentStatus = () => {
        const status = delegatedParentRunStatus(runId);
        updateRun(runId, status);
        sender.send(channel, { type: 'run_updated', runId, status });
      };
      if (typeof runtime.subscribeDelegatedRunChanges === 'function') {
        unsubscribeDelegatedRunChanges = runtime.subscribeDelegatedRunChanges((parentRunId: string) => {
          if (parentRunId === runId) publishParentStatus();
        });
      }
      unsubscribeDelegatedApprovals = runtime.subscribeDelegatedToolApprovals((request: any) => {
        const approval = {
          id: request.id,
          runId,
          delegatedRunId: request.delegatedRunId,
          targetAgentId: request.targetAgentId,
          targetAgentSlug: request.targetAgentSlug,
          targetAgentName: request.targetAgentName,
          delegatedTask: request.delegatedTask,
          actionId: request.action.id,
          actions: [{
            name: request.action.name,
            args: request.action.args,
            description: request.action.description,
            allowedDecisions: ['approve', 'reject'],
          }],
        };

        markApprovalStatus(runId, 'pending');
        publishParentStatus();
        sender.send(channel, { type: 'approval_required', approval });

        const key = `${requestId}:${approval.id}`;
        delegatedApprovalKeys.add(key);
        pendingApprovals.set(key, (resolution) => {
          delegatedApprovalKeys.delete(key);
          const decision = resolution.decisions.every((item) => item.type === 'approve')
            ? 'approve'
            : 'reject';
          const outcome = runtime.resolveDelegatedToolApproval(approval.id, decision);
          const approvalStatus = decision === 'approve' ? 'approved' : 'rejected';
          markApprovalStatus(runId, approvalStatus);
          sender.send(channel, {
            type: 'approval_resolved',
            approvalId: approval.id,
            status: approvalStatus,
            resolvedAt: Date.now(),
            executionStatus: decision === 'approve' ? 'running' : 'rejected',
          });
          publishParentStatus();
          Promise.resolve(outcome).then((record: any) => {
            if (!record) return;
            sender.send(channel, {
              type: 'approval_outcome',
              approvalId: approval.id,
              executionStatus: record.execution_status,
              output: record.output,
              error: record.error,
            });
          }).catch(() => undefined);
        });
      });
    }
    const preloadedSkillAttributions = (runtime.skillAttributions as SkillAttribution[] | undefined)
      ?.filter((item) => item.phase === 'preload') ?? [];
    if (preloadedSkillAttributions.length > 0) {
      sender.send(channel, {
        type: 'skill_attribution',
        attributions: preloadedSkillAttributions,
      });
    }

    await checkAndSendTodos(runtime, payload.sessionId, sender, channel, lastTodosJsonRef);

    let nextInput: unknown;
    if (payload.resume) {
      nextInput = new Command({ resume: payload.resume });
    } else {
      nextInput = { messages: runtime.inputMessages };
    }

    // ── Runtime Stream Projection 壳层（ADR-0053）──
    // 4 路并发 iterator 只做「收到即转发」：串行化为 RuntimeStreamEvent 喂纯核心；
    // 核心产出 renderer 事件与 effect，壳层同步发送/执行。
    // 并发交织由 JS 单线程天然全序化——原 taskId waiter/死锁隐患结构性消失。
    let projectionState = createRuntimeStreamState();
    const projectionDeps: RuntimeStreamProjectionDeps = {
      takeBufferedReasoning: () => takeReasoningText(accumulator, runtime.model),
      takeFallbackText: () => getFallbackText(accumulator, runtime.model),
      generateToolCallId: () => crypto.randomUUID(),
    };
    type ControlEffect = 'await-approval' | 'stop-turn-loop' | 'continue-turn-loop';
    const dispatch = (streamEvent: RuntimeStreamEvent): ControlEffect[] => {
      const result = projectRuntimeStream(projectionState, streamEvent, projectionDeps);
      projectionState = result.state;
      for (const rendererEvent of result.events) {
        sender.send(channel, rendererEvent);
      }
      const control: ControlEffect[] = [];
      for (const effect of result.effects) {
        switch (effect.type) {
          case 'upsert-tool-call':
            upsertToolCall(
              runId,
              effect.toolCallId,
              effect.toolName,
              effect.input,
              effect.delegatedRunId,
            );
            break;
          case 'update-tool-call':
            updateToolCall(effect.toolCallId, effect.status, effect.output, effect.errorMessage);
            break;
          case 'update-run':
            if (effect.status === 'aborted') {
              updateRun(runId, 'aborted', undefined, true);
            } else {
              updateRun(runId, effect.status);
            }
            break;
          case 'clear-accumulator-text':
            accumulator.clearText();
            break;
          default:
            control.push(effect.type);
        }
      }
      return control;
    };

    dispatch({
      kind: 'run-started',
      runId,
      skillAttributions: (runtime.skillAttributions as SkillAttribution[] | undefined) ?? [],
    });

    while (!controller.signal.aborted) {
      dispatch({ kind: 'turn-started' });
      const run = await runtime.agent.streamEvents(
        nextInput,
        {
          version: 'v3',
          signal: controller.signal,
          configurable: {
            thread_id: payload.sessionId,
            checkpoint_ns: DEEPAGENT_CHECKPOINT_NAMESPACE,
            parentAgentRunId: runId,
          },
        }
      );

      // Graph failures reject run.output even when stream iterators fail first.
      // Attach a no-op catch so a later reject cannot become UnhandledPromiseRejection
      // before waitForRunOutputOrTerminal races it (same settled promise can still be awaited).
      if (run?.output != null) {
        Promise.resolve(run.output).catch(() => {});
      }

      const messageStreamPromise = (async () => {
        for await (const msg of run.messages) {
          if (controller.signal.aborted) break;
          // reasoning 存在（不是 null/undefined/空数组）时 text 才积压。
          const hasReasoningSource = msg.reasoning != null && !Array.isArray(msg.reasoning);
          dispatch({ kind: 'message-started', hasReasoningSource });

          const consumeReasoning = async () => {
            for await (const token of msg.reasoning ?? []) {
              if (controller.signal.aborted) break;
              dispatch({ kind: 'reasoning-token', token });
            }
            if (!controller.signal.aborted) {
              dispatch({ kind: 'reasoning-ended' });
            }
          };
          const consumeText = async () => {
            for await (const token of msg.text) {
              if (controller.signal.aborted) break;
              dispatch({ kind: 'text-token', token });
            }
          };

          await Promise.all([consumeReasoning(), consumeText()]);
          if (!controller.signal.aborted) {
            dispatch({ kind: 'message-ended' });
          }
        }
      })();

      const toolStreamPromise = (async () => {
        for await (const call of run.toolCalls) {
          if (controller.signal.aborted) break;
          const toolCallId = call.callId || crypto.randomUUID();
          const delegatedInput = call.name === 'task'
            ? parseDelegatedTaskCallInput(call.input)
            : null;
          const delegatedRun = delegatedInput
            ? runtime.queueDelegatedRun(
                runId,
                toolCallId,
                delegatedInput.targetAgentSlug,
                delegatedInput.goal,
              )
            : null;
          dispatch({
            kind: 'tool-call-started',
            callId: toolCallId,
            toolName: call.name,
            input: call.input,
            delegatedRun: delegatedRun
              ? {
                  id: delegatedRun.id,
                  targetAgentSlug: delegatedRun.target_agent_slug,
                  targetAgentName: delegatedRun.target_agent_name,
                  goal: delegatedRun.goal,
                }
              : undefined,
          });

          const delegatedRunId = delegatedRun?.id;
          if (delegatedRunId) {
            accumulator.onText = (text: string) => {
              dispatch({ kind: 'accumulator-text', delegatedRunId, text });
            };
            accumulator.onSubagentStep = (step: ExecutionStep) => {
              dispatch({ kind: 'accumulator-step', delegatedRunId, step });
            };
          }

          try {
            const output = delegatedRunId
              ? await subagentStepStorage.run(
                  {
                    onStep: (step: ExecutionStep) => {
                      dispatch({ kind: 'accumulator-step', delegatedRunId, step });
                    },
                  },
                  () => call.output,
                )
              : await call.output;
            dispatch({ kind: 'tool-output', output });
          } catch (error: any) {
            dispatch({
              kind: 'tool-failed',
              message: error?.message || String(error),
              isInterrupt: isInterruptError(error),
            });
          } finally {
            if (delegatedRunId) {
              accumulator.onText = undefined;
              accumulator.onSubagentStep = undefined;
            }
          }
        }
      })();

      const valuesStreamPromise = (async () => {
        if (!run.values || typeof run.values[Symbol.asyncIterator] !== 'function') return;
        const valuesIter = run.values[Symbol.asyncIterator]();
        const abortPromise = waitForAbort(controller.signal).catch(() => {});
        try {
          while (true) {
            const next = await Promise.race([
              valuesIter.next(),
              abortPromise.then(() => ({ done: true as const, value: undefined })),
            ]);
            if (next.done) break;
            const todos = next.value?.todos;
            if (Array.isArray(todos)) {
              const todosJson = JSON.stringify(todos);
              if (todosJson !== lastTodosJsonRef.current) {
                lastTodosJsonRef.current = todosJson;
                sender.send(channel, {
                  type: 'todos_update',
                  todos,
                });
              }
            }
          }
        } catch {
          // iterator error or abort — silently stop
        }
      })();

      // 多路 iterator 在图失败时会同时 reject。Promise.all 在第一个 reject 后
      // 不再 await 其余 promise，sibling 的后续 reject 会变成 UnhandledPromiseRejection。
      // 用 allSettled 等全部结束后再抛出第一个 error。
      const streamSettled = await Promise.allSettled([
        messageStreamPromise,
        toolStreamPromise,
        valuesStreamPromise,
      ]);
      const firstStreamError = streamSettled.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (firstStreamError) {
        throw firstStreamError.reason;
      }

      let interruptValue = getStreamInterruptValue(run);
      let output: any;
      let terminal: 'completed' | 'interrupted' | 'failed' | null = null;
      if (!interruptValue) {
        try {
          const result = await waitForRunOutputOrTerminal(run, controller.signal);
          output = result.output;
          terminal = result.terminal;
        } catch (err: any) {
          if (err?.name === 'AbortError' || controller.signal.aborted) {
            throw err;
          }
          output = undefined;
        }
      }
      // 备用：output 中可能含中断值（interrupts 已在 streamEvents 外层检查过）
      interruptValue ||= getInterruptValue(output);
      if (!interruptValue) {
        try {
          interruptValue = getStreamInterruptValue(run);
        } catch {
          // ignore optional interrupt fallback
        }
      }

      const controlEffects = dispatch({
        kind: 'turn-stream-ended',
        interrupted: !!interruptValue,
        terminal,
        latestAssistantContent: getLatestAssistantContent(output),
      });

      if (controlEffects.includes('stop-turn-loop')) {
        break;
      }
      if (controlEffects.includes('await-approval')) {
        // Phase 15: 检查是否 Workflow Stage Gate 中断（deepagents 标准 actionRequests 格式）
        const stageInfo = isAdvanceStageInterrupt(interruptValue);
        if (stageInfo) {
          if ('error' in stageInfo) {
            // 多 actionRequests 混合 advance_stage — 不能绕过门禁，终止该 turn
            const run = getRunBySessionId(payload.sessionId);
            if (run) {
              updateRunStatus(run.id, 'aborted');
              db.prepare('UPDATE sessions SET workflow_run_status = ? WHERE id = ?').run('aborted', run.session_id);
            }
            sender.send(channel, {
              type: 'runtime_error',
              error: stageInfo.error,
            });
            controller.abort();
            break;
          }
          // 通过 session 查 run（runId/stageIndex 不在 actionRequests 中）
          const run = getRunBySessionId(payload.sessionId);
          if (!run) throw new Error('Workflow run not found for advance_stage interrupt');
          const result = await handleAdvanceStageInterrupt(
            run.id,
            stageInfo.report,
            sender,
            channel,
            controller.signal,
            { routeId: stageInfo.routeId, rationale: stageInfo.rationale },
          );
          if (result.terminate) {
            controller.abort();
            break;
          }
          nextInput = new Command({ resume: result.resume });
          sender.send('conversation:messages-changed', { sessionId: run.session_id });
          // 继续循环（不入标准审批流程）
          continue;
        }


        const approval = toApprovalRequest(runId, interruptValue);
        db.transaction(() => {
          updateRun(runId, 'waiting_approval');
          markApprovalStatus(runId, 'pending');
        })();
        sender.send(channel, { type: 'run_updated', runId, status: 'waiting_approval' });
        sender.send(channel, { type: 'approval_required', approval });

        let approvalResolve!: (resolution: AgentApprovalResolution) => void;
        let approvalReject!: (reason?: unknown) => void;
        const approvalPromise = new Promise<AgentApprovalResolution>((resolve, reject) => {
          approvalResolve = resolve;
          approvalReject = reject;
        });
        const key = `${requestId}:${approval.id}`;
        pendingApprovals.set(key, approvalResolve);
        controller.signal.addEventListener('abort', () => {
          pendingApprovals.delete(key);
          approvalReject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });

        const resolution = await approvalPromise;

        const approvalStatus = resolution.decisions.some((decision) => decision.type === 'edit')
          ? 'edited'
          : resolution.decisions.every((decision) => decision.type === 'approve')
            ? 'approved'
            : 'rejected';
        const rejectedTools = approvalStatus === 'rejected'
          ? db.prepare(`
              SELECT id, tool_name FROM agent_tool_calls
              WHERE run_id = ? AND status = 'running'
            `).all(runId) as Array<{ id: string; tool_name: string }>
          : [];

        // All DB writes in one transaction so a mid-way throw rolls back atomically
        // rather than leaving a dangling BEGIN that poisons every later transaction.
        db.transaction(() => {
          markApprovalStatus(runId, approvalStatus);
          for (const tool of rejectedTools) {
            updateToolCall(tool.id, 'skipped');
          }
          updateRun(runId, 'running');
        })();

        // IPC only after the state is committed.
        sender.send(channel, { type: 'approval_resolved', approvalId: approval.id, status: approvalStatus });
        for (const tool of rejectedTools) {
          sender.send(channel, {
            type: 'tool_error',
            id: tool.id,
            name: tool.tool_name,
            error: '用户拒绝执行该操作',
          });
        }
        sender.send(channel, { type: 'run_updated', runId, status: 'running' });
        nextInput = new Command({ resume: { decisions: resolution.decisions } });
      }
      // continue-turn-loop：终态 failed 场景，不动 nextInput，让 LLM 看到失败输出继续处理。
    }

    if (controller.signal.aborted) {
      updateRun(runId, 'aborted', undefined, true);
      sender.send(channel, { type: 'run_updated', runId, status: 'aborted' });
    }

    await checkAndSendTodos(runtime, payload.sessionId, sender, channel, lastTodosJsonRef);
    sender.send(channel, { type: 'message_done' });
  } catch (error: any) {
    const structuredError = findStructuredRuntimeError(error);
    const isWorkingStateMaintenance = structuredError?.code
      === CONVERSATION_WORKING_STATE_MAINTENANCE_LOCKED;
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
    // Propagate terminal errors to workflow_runs / sessions if this is a workflow session.
    // Transient network stream failures (e.g. TypeError: terminated) only fail the Agent Run;
    // the Workflow Run stays open so the user can continue.
    try {
      const sessionRow = db.prepare('SELECT workflow_run_id FROM sessions WHERE id = ?').get(payload.sessionId) as { workflow_run_id: string | null } | undefined;
      if (sessionRow?.workflow_run_id && !isWorkingStateMaintenance) {
        const isAbort = error?.name === 'AbortError' || controller.signal.aborted;
        const errorForClassify = error instanceof Error ? error : new Error(String(error));
        const isTransient = !isAbort && isTransientRuntimeError(errorForClassify);
        if (!isTransient) {
          const wfStatus: WorkflowRunStatus = isAbort ? 'aborted' : 'failed';
          updateRunStatus(sessionRow.workflow_run_id, wfStatus, error?.message || String(error));
          sender.send('conversation:messages-changed', { sessionId: payload.sessionId });
          const workflowRun = getRunBySessionId(payload.sessionId);
          if (workflowRun) {
            sender.send('workflow-run:projection-event', {
              type: 'run',
              runId: workflowRun.id,
              status: wfStatus,
              currentStageId: workflowRun.current_stage_id,
              currentStageIndex: workflowRun.current_stage_index,
              error: error?.message || String(error),
            });
          }
        }
      }
    } catch (wfErr) {
      log.warn('[LLM] Failed to propagate error to workflow run:', wfErr);
    }
    if (runtime) {
      await checkAndSendTodos(runtime, payload.sessionId, sender, channel, lastTodosJsonRef);
    }
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      sender.send(channel, { type: 'message_done' });
    } else {
      sender.send(channel, {
        type: 'runtime_error',
        error: error?.message || String(error),
        errorCode: typeof structuredError?.code === 'string' ? structuredError.code : undefined,
        errorMessageKey: typeof structuredError?.messageKey === 'string'
          ? structuredError.messageKey
          : undefined,
        errorMessageParams: structuredError?.messageParams
          && typeof structuredError.messageParams === 'object'
          ? structuredError.messageParams
          : undefined,
      });
      throw error;
    }
  } finally {
    activeRequests.delete(requestId);
    activeRuntimes.delete(requestId);
    unsubscribeDelegatedApprovals();
    unsubscribeDelegatedRunChanges();
    for (const key of delegatedApprovalKeys) {
      pendingApprovals.delete(key);
    }
    const runId = getLatestRunId(requestId);
    if (runId) {
      lastRunApprovals.delete(runId);
    }
    await cleanup();
    conversationIdleListener?.(payload.sessionId);
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

registerResumeAgentCallback((sessionId, projectId, decisions) => {
  const requestId = crypto.randomUUID();
  const messageId = crypto.randomUUID();

  let stream: ActiveConversationRunStream | undefined;
  try {
    stream = conversationRunStreams.begin({
      sessionId,
      requestId,
      messageId,
      origin: 'workflow-resume',
    });
  } catch {
    log.warn('[LLM] Cannot start Conversation run stream for resume (already active)');
  }

  const sender = stream?.sender;
  if (!sender) {
    log.warn('[LLM] No sender available to resume agent');
    stream?.fail();
    return;
  }

  void runLLMChat(sender, requestId, {
    projectId,
    sessionId,
    message: { id: messageId, content: 'resume' },
    resume: { decisions },
  }).then(() => {
    stream!.commit();
  }).catch(() => {
    stream!.fail();
  });
});
