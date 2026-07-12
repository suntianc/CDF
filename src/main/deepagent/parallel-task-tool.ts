import crypto from 'crypto';
import { BrowserWindow } from 'electron';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createDeepAgent, CompositeBackend, FilesystemBackend, StateBackend } from 'deepagents';
import db from '../database';
import { resolveAgentSlug } from './agent-slug';
import {
  extractPathMentionContext,
  assembleDeepAgentRuntime,
} from './runtime-assembly';
import {
  getAgentMcpServers,
  getConnectedMcpServers,
  getAgentSkillNames,
  createBuiltInTools,
  loadRegistryTools,
  loadMcpTools,
  getRuntimeToolNames,
  createSpanId,
  createChildSpan,
  type AgentRow,
} from './shared-infra';
import type { ExecutionStep, ParallelTaskStepEvent } from '../../shared/types';
import {
  getRunBySessionId,
  getCurrentStage,
  createTask,
  setTaskDelegation,
  updateTaskStatus,
  getTask,
} from '../workflow-run/db';
import { parallelTaskStepChannel } from '../../shared/ipc-contract';
import { pushProjectionEvent } from '../workflow-run/notify';
const WORKER_TIMEOUT_MS = 5 * 60 * 1000;

// ParallelTaskStepEvent 已迁移至 src/shared/types.ts（IPC 契约共享）。
export type { ParallelTaskStepEvent } from '../../shared/types';

export function pushParallelTaskStep(sessionId: string, event: ParallelTaskStepEvent) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(parallelTaskStepChannel(sessionId), event);
    }
  }
}

// ---- Small helpers inlined from node-executor.ts (design 2.5: expected duplication) ----

function tryParseJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}

function getLastMessageText(result: any): string {
  const messages = result?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return '';
  const last = messages[messages.length - 1];
  const content = last?.content ?? '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p?.type === 'text' && typeof p?.text === 'string')
      .map((p: any) => p.text)
      .join('');
  }
  return JSON.stringify(content);
}

function extractThinkingText(output: any): string {
  try {
    if (typeof output === 'string') return output;
    const gen = output?.generations?.[0]?.[0];
    const content = gen?.message?.content ?? output?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((p: any) => p?.type === 'text' && typeof p?.text === 'string')
        .map((p: any) => p.text)
        .join('');
    }
    if (typeof gen?.text === 'string') return gen.text;
  } catch { /* ignore */ }
  return '';
}

function unwrapToolOutput(output: unknown): unknown {
  if (output === null || output === undefined) return output;
  const obj = output as any;
  const isLcToolMessage = obj?.lc === 1 && obj?.type === 'constructor'
    && Array.isArray(obj?.id) && obj.id[obj.id.length - 1] === 'ToolMessage'
    && obj.kwargs !== undefined;
  const content = isLcToolMessage ? obj.kwargs.content : obj.content !== undefined ? obj.content : undefined;
  if (content === undefined) return output;
  if (Array.isArray(content)) {
    const parts = content.filter((p: any) => p?.type === 'text' && typeof p?.text === 'string').map((p: any) => p.text);
    if (parts.length === 1) return tryParseJson(parts[0]);
    if (parts.length > 1) return parts.join('\n');
    return content;
  }
  if (typeof content === 'string') return tryParseJson(content);
  return content;
}

function normalizeToolArgs(input: unknown): unknown {
  if (typeof input === 'string') return tryParseJson(input);
  return input;
}


// ---- Worker invocation ----

async function invokeWorker(
  agentRow: AgentRow,
  taskDescription: string,
  projectPath: string,
  projectName: string,
  sourceSessionId: string,
  onStep: (step: ExecutionStep) => void,
): Promise<string> {
  const skillNames = getAgentSkillNames(agentRow.id);
  const pathContext = extractPathMentionContext(taskDescription);

  const builtInTools = createBuiltInTools(projectPath, sourceSessionId);
  try {
    builtInTools.push(...loadRegistryTools());
  } catch (err) {
    console.warn('[parallel-task] Failed to load registry tools:', err);
  }
  const capabilityToolNames = getRuntimeToolNames(builtInTools);

  const assembly = await assembleDeepAgentRuntime(
    agentRow,
    undefined,
    { name: projectName, path: projectPath },
    skillNames,
    pathContext,
    capabilityToolNames,
  );
  for (const warning of assembly.assemblyWarnings) {
    console.warn('[parallel-task] Ignored invalid Skill runtime input:', warning);
  }

  const allMcpServers = getConnectedMcpServers();
  const mcpServers = getAgentMcpServers(agentRow.id);
  const mcpRuntime = await loadMcpTools(agentRow.id, mcpServers, allMcpServers);

  const backend = new CompositeBackend(new StateBackend(), {
    '/': new FilesystemBackend({ rootDir: '/', virtualMode: false }),
  });

  const agent = createDeepAgent({
    model: assembly.model,
    backend,
    systemPrompt: assembly.systemPrompt || undefined,
    permissions: assembly.permissions,
    // Skills stay in systemPrompt (via assembleDeepAgentRuntime). Skill
    // descriptors are not LangChain tools — spreading them into `tools`
    // makes ChatAnthropic throw "Unknown tool type passed to ChatAnthropic".
    tools: [...mcpRuntime.tools, ...builtInTools],
    // worker 不挂 interruptOn：worker 图没有 checkpointer，LangGraph 的
    // interrupt() 会直接抛 "No checkpointer set" 打死任务。与单委派 task
    // subagent 的免审批语义一致；Claude Code 式审批路由另行立项。
    // worker 不挂载 subagents / parallel_tasks（防递归）
  });

  const nodeSpanId = createSpanId();
  const toolRunNames = new Map<string, string>();
  const toolRunStartedAt = new Map<string, number>();
  const toolRunSpans = new Map<string, { spanId: string; parentSpanId: string }>();

  const push = (step: Omit<ExecutionStep, 'ts'> & { ts?: number }) => {
    onStep({ ts: Date.now(), ...step });
  };

  // task_start 已由 createParallelTaskTool 在 invokeWorker 调用前 emit

  // Per-LLM-call token buffer: flush only if the call produced text, discard if it
  // produced tool calls. LangChain streams tool-call arguments via handleLLMNewToken
  // the same way it streams text tokens, so we must defer the push until handleLLMEnd
  // tells us whether this call was a tool-call or a text response.
  let callTokenBuffer: string[] = [];
  let callTokenCount = 0;

  const agentPromise = agent.invoke(
    { messages: [{ role: 'user', content: taskDescription }] },
    {
      callbacks: [{
        handleLLMStart() {
          callTokenBuffer = [];
          callTokenCount = 0;
        },
        handleLLMNewToken(token: string) {
          callTokenCount++;
          callTokenBuffer.push(token);
        },
        handleLLMEnd(output: any) {
          const gen = output?.generations?.[0]?.[0];
          // Detect tool-calling responses across providers:
          //   OpenAI-style: additional_kwargs.tool_calls array
          //   Anthropic-style: content array with tool_use blocks
          const toolCalls = gen?.message?.additional_kwargs?.tool_calls
            ?? gen?.message?.tool_calls
            ?? [];
          const isToolCallResponse =
            (Array.isArray(toolCalls) && toolCalls.length > 0) ||
            (Array.isArray(gen?.message?.content) &&
              gen.message.content.some((p: any) => p?.type === 'tool_use'));

          if (isToolCallResponse) {
            // Tool-call LLM step: arg tokens must not appear in textBuffer
            callTokenBuffer = [];
            callTokenCount = 0;
            return;
          }

          if (callTokenCount > 0) {
            // Streaming text response: flush buffered tokens
            for (const token of callTokenBuffer) {
              push({ type: 'text_chunk', content: token, spanId: nodeSpanId });
            }
            callTokenBuffer = [];
            callTokenCount = 0;
            return;
          }

          // Non-streaming fallback (model didn't emit tokens)
          callTokenBuffer = [];
          const text = extractThinkingText(output);
          if (!text || !text.trim()) return;
          const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
          let match: RegExpExecArray | null;
          while ((match = thinkRegex.exec(text)) !== null) {
            const inner = match[1].trim();
            if (inner) push({ type: 'text_chunk', content: `<think>${inner}</think>\n\n`, spanId: nodeSpanId });
          }
          const mainText = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
          if (mainText) push({ type: 'text_chunk', content: mainText, spanId: nodeSpanId });
        },
        handleToolStart(toolDef: any, toolInput: any, runId: string, _p: any, _t: any, _m: any, name?: string) {
          const rawId = toolDef?.id;
          const toolId: string = Array.isArray(rawId) ? rawId[rawId.length - 1] : (rawId as string);
          const toolName = name || toolDef?.name || toolId || 'unknown';
          toolRunNames.set(runId, toolName);
          toolRunStartedAt.set(runId, Date.now());
          const toolSpan = createChildSpan(nodeSpanId);
          toolRunSpans.set(runId, toolSpan);
          push({ type: 'tool_call', tool: toolName, args: normalizeToolArgs(toolInput), spanId: toolSpan.spanId, parentSpanId: toolSpan.parentSpanId });
        },
        handleToolEnd(output: any, runId: string) {
          const toolName = toolRunNames.get(runId) || 'unknown';
          toolRunNames.delete(runId);
          const startedAt = toolRunStartedAt.get(runId) || Date.now();
          toolRunStartedAt.delete(runId);
          const toolSpan = toolRunSpans.get(runId);
          toolRunSpans.delete(runId);
          push({ type: 'tool_result', tool: toolName, success: true, output: unwrapToolOutput(output), duration_ms: Date.now() - startedAt, spanId: toolSpan?.spanId, parentSpanId: toolSpan?.parentSpanId });
        },
        handleToolError(err: any, runId: string) {
          const toolName = toolRunNames.get(runId) || 'unknown';
          toolRunNames.delete(runId);
          const startedAt = toolRunStartedAt.get(runId) || Date.now();
          toolRunStartedAt.delete(runId);
          const toolSpan = toolRunSpans.get(runId);
          toolRunSpans.delete(runId);
          const errMsg = err instanceof Error ? err.message : String(err);
          push({ type: 'tool_result', tool: toolName, success: false, error: errMsg, duration_ms: Date.now() - startedAt, spanId: toolSpan?.spanId, parentSpanId: toolSpan?.parentSpanId });
        },
      }],
    },
  );

  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Agent execution timed out after ${WORKER_TIMEOUT_MS}ms: ${agentRow.name}`)),
      WORKER_TIMEOUT_MS,
    );
  });

  try {
    const result = await Promise.race([agentPromise, timeoutPromise]);
    return getLastMessageText(result);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

// ---- Tool factory ----

export function createParallelTaskTool(projectId: string, sessionId: string) {
  return tool(
    async (input) => {
      const batchId = crypto.randomUUID();
      const { tasks } = input;

      if (tasks.length === 0) {
        return JSON.stringify({ batchId, results: [] });
      }

      const projectRow = db
        .prepare('SELECT name, path FROM projects WHERE id = ?')
        .get(projectId) as { name: string; path: string } | undefined;
      const projectPath = projectRow?.path ?? '';
      const projectName = projectRow?.name ?? 'Project';
      const allAgents = db
        .prepare('SELECT * FROM agents WHERE project_id = ?')
        .all(projectId) as AgentRow[];

      // Phase 16+: Task Graph 关联验证 — 防跨 Run/Stage 污染
      const workflowRun = getRunBySessionId(sessionId);
      let currentStageIdForFallback: string | undefined;
      if (workflowRun) {
        const stage = getCurrentStage(workflowRun);
        if (stage) currentStageIdForFallback = stage.id;
      }

      // 批内已使用的 runTaskId 集合 — 防同批重复绑定
      const usedRunTaskIds = new Set<string>();

      const workerPromises = tasks.map(async (task) => {
        const startTime = Date.now();
        const workerId = crypto.randomUUID();
        const agentRow = allAgents.find((row) => resolveAgentSlug(row) === task.name);

        // Phase 16+: 验证 runTaskId 归属边界
        let runTaskId: string | undefined = task.runTaskId ?? undefined;
        const fallbackTitle = task.name || task.description?.slice(0, 60) || 'parallel-task';

        if (runTaskId) {
          // 无 Workflow Run 上下文 → 普通聊天不得触碰 Workflow Run task
          if (!workflowRun) {
            runTaskId = undefined;
          } else {
            const existingTask = getTask(runTaskId);
            if (!existingTask) {
              // task 不存在 → 忽略 runTaskId
              runTaskId = undefined;
            } else if (existingTask.run_id !== workflowRun.id) {
              // 跨 Run 污染 → 忽略
              runTaskId = undefined;
            } else if (!currentStageIdForFallback || existingTask.stage_id !== currentStageIdForFallback) {
              // 跨 Stage 污染 → 忽略
              runTaskId = undefined;
            } else if (usedRunTaskIds.has(runTaskId)) {
              // 批内重复绑定 → 忽略重复项
              runTaskId = undefined;
            } else {
              usedRunTaskIds.add(runTaskId);
            }
          }
        }

        if (!runTaskId && workflowRun && currentStageIdForFallback) {
          // 无 runTaskId 但处于 Workflow 上下文 → 创建 persisted fallback task
          const fb = createTask(
            workflowRun.id,
            currentStageIdForFallback,
            fallbackTitle,
            task.description || '',
          );
          runTaskId = fb.id;
          pushProjectionEvent({ type: 'task', task: fb });
        }

        if (!agentRow) {
          if (runTaskId) {
            const updated = updateTaskStatus(runTaskId, 'failed');
            if (updated) pushProjectionEvent({ type: 'task', task: updated });
          }
          return {
            name: task.name,
            status: 'failure' as const,
            error: `Agent not found: ${task.name}`,
            duration_ms: Date.now() - startTime,
          };
        }

        // Phase 16: 开始执行 → in_progress + 记录 delegation
        if (runTaskId) {
          setTaskDelegation(runTaskId, batchId, workerId, resolveAgentSlug(agentRow));
          pushProjectionEvent({ type: 'delegation', taskId: runTaskId, batchId, workerId, agentSlug: resolveAgentSlug(agentRow) });
        }

        try {
          const taskContext = task.input
            ? `${task.description}\n\n## 附加上下文\n${JSON.stringify(task.input, null, 2)}`
            : task.description;

          pushParallelTaskStep(sessionId, {
            batchId,
            agentSlug: task.name,
            workerId,
            runTaskId,
            step: { type: 'task_start', ts: Date.now(), label: agentRow.name, goal: task.description },
          });
          const output = await invokeWorker(
            agentRow,
            taskContext,
            projectPath,
            projectName,
            sessionId,
            (step) => pushParallelTaskStep(sessionId, { batchId, agentSlug: task.name, workerId, runTaskId, step }),
          );

          const summary = output.slice(0, 300);
          pushParallelTaskStep(sessionId, {
            batchId,
            agentSlug: task.name,
            workerId,
            runTaskId,
            step: { type: 'task_end', ts: Date.now(), success: true, summary },
          });
          if (runTaskId) {
            const updated = updateTaskStatus(runTaskId, 'completed');
            if (updated) pushProjectionEvent({ type: 'task', task: updated });
          }

          return {
            name: task.name,
            agentName: agentRow.name,
            status: 'success' as const,
            output,
            duration_ms: Date.now() - startTime,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          pushParallelTaskStep(sessionId, {
            batchId,
            agentSlug: task.name,
            workerId,
            runTaskId,
            step: { type: 'task_end', ts: Date.now(), success: false, error: errMsg },
          });

          // Phase 16: 失败 → failed
          if (runTaskId) {
            const updated = updateTaskStatus(runTaskId, 'failed');
            if (updated) pushProjectionEvent({ type: 'task', task: updated });
          }

          return {
            name: task.name,
            agentName: agentRow.name,
            status: 'failure' as const,
            error: errMsg,
            duration_ms: Date.now() - startTime,
          };
        }
      });

      const settled = await Promise.allSettled(workerPromises);
      const results = settled.map((s) =>
        s.status === 'fulfilled'
          ? s.value
          : { name: '?', status: 'failure' as const, error: String((s as PromiseRejectedResult).reason), duration_ms: 0 }
      );

      return JSON.stringify({ batchId, results });
    },
    {
      name: 'parallel_tasks',
      description:
        '并发调用多个子 Agent 执行独立任务。执行期间每个 worker 的步骤实时推送到 UI；' +
        '所有 worker 完成后返回聚合结果。name 使用 agent 的 effective_slug（用 list_agents 查询）。' +
        '若当前处于 Workflow Run，每个任务会绑定到当前 Stage 的 Task Graph 以追踪状态。' +
        'runTaskId 可选：若传入则绑定该现有 Task 的 ID 更新状态；否则自动创建。',
      schema: z.object({
        tasks: z.array(
          z.object({
            name: z.string().describe('agent effective_slug'),
            description: z.string().describe('给该 agent 的任务描述'),
            input: z.record(z.string(), z.unknown()).optional().describe('附加上下文（可选）'),
            runTaskId: z.string().optional().describe('绑定到此现有 Task ID（可选）'),
          }),
        ).describe('要并发执行的任务列表'),
      }),
    },
  );
}
