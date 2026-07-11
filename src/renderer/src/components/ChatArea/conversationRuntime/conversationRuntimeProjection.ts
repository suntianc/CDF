import type {
  AgentApprovalRequest,
  ConversationRunStreamSnapshot,
  AgentRun,
  AgentToolCall,
  ExecutionStep,
  LLMStreamEvent,
  Message,
  TodoItem,
} from '@shared/types';

export interface DelegatedTaskProjection {
  taskId: string;
  agentSlug: string;
  agentName: string;
  goal: string;
  status: 'running' | 'success' | 'failure';
  chunks: string[];
  steps: ExecutionStep[];
  startedAt?: number;
  completedAt?: number;
  result?: {
    status: 'success' | 'failure';
    artifacts: string[];
    summary: string;
    error?: { code: string; message: string };
  };
  errorCode?: string;
}

export interface ParallelWorkerProjection {
  workerId?: string;
  agentSlug: string;
  agentName?: string;
  goal?: string;
  summary?: string;
  status: 'running' | 'success' | 'failure';
  steps: ExecutionStep[];
  textBuffer: string;
  startedAt: number;
  completedAt?: number;
}

export interface ParallelBatchProjection {
  batchId: string;
  workers: ParallelWorkerProjection[];
  startedAt: number;
}

export interface ConversationRuntimeProjectionState {
  sessionId: string;
  requestId: string;
  messages: Message[];
  todos: TodoItem[];
  agentRuns: AgentRun[];
  agentToolCalls: AgentToolCall[];
  delegatedTasks: DelegatedTaskProjection[];
  parallelBatches: ParallelBatchProjection[];
  activeRunId: string | null;
  pendingApproval: AgentApprovalRequest | null;
  isStreaming: boolean;
  streamingMessageId: string | null;
  currentAssistantMsgId: string;
  accumulatedContent: string;
  pendingToolMessages: Record<string, string[]>;
  runtimeToolMessageIds: string[];
}

export interface ConversationRuntimeProjectionDeps {
  now: () => number;
  createId: () => string;
  estimateTokens: (text: string) => number;
}

export type ConversationRuntimeEvent =
  | { kind: 'llm'; event: LLMStreamEvent }
  | { kind: 'parallelTaskStep'; event: { batchId: string; agentSlug: string; workerId?: string; step: ExecutionStep } };

export type RuntimeMessageDraft = Omit<Message, 'created_at'> & { created_at?: number };

export type ConversationRuntimeProjectionEffect =
  | { type: 'saveMessage'; message: RuntimeMessageDraft }
  | { type: 'openActivityPanel' }
  | { type: 'cleanupStream' }
  | { type: 'resolveStream' }
  | { type: 'setRetryableError'; message: string; messageParams?: Record<string, string | number> }
  | { type: 'rejectStream'; error: string; messageParams?: Record<string, string | number> };

export interface ConversationRuntimeProjectionResult {
  state: ConversationRuntimeProjectionState;
  effects: ConversationRuntimeProjectionEffect[];
}

export interface RestoreConversationRuntimeInput {
  sessionId: string;
  isStreaming: boolean;
  agentRuns: AgentRun[];
  agentToolCalls: AgentToolCall[];
  latestTodos?: TodoItem[];
}

export type RestoredConversationRuntimeProjection = Pick<
  ConversationRuntimeProjectionState,
  'agentRuns' | 'agentToolCalls' | 'delegatedTasks' | 'parallelBatches' | 'todos' | 'activeRunId'
>;

export function createConversationRuntimeState(
  input: Pick<ConversationRuntimeProjectionState, 'sessionId' | 'streamingMessageId' | 'currentAssistantMsgId'> &
    Partial<Omit<ConversationRuntimeProjectionState, 'sessionId' | 'streamingMessageId' | 'currentAssistantMsgId'>>
): ConversationRuntimeProjectionState {
  return {
    messages: [],
    todos: [],
    agentRuns: [],
    agentToolCalls: [],
    delegatedTasks: [],
    parallelBatches: [],
    activeRunId: null,
    pendingApproval: null,
    isStreaming: true,
    accumulatedContent: '',
    pendingToolMessages: {},
    runtimeToolMessageIds: [],
    ...input,
    requestId: input.requestId ?? input.streamingMessageId ?? '',
  };
}

export function hydrateConversationRuntimeStream(
  state: ConversationRuntimeProjectionState,
  snapshot: ConversationRunStreamSnapshot,
  deps: ConversationRuntimeProjectionDeps,
): ConversationRuntimeProjectionState {
  const tokens = deps.estimateTokens(snapshot.content);
  const hasMessage = state.messages.some((message) => message.id === snapshot.messageId);
  const messages = snapshot.content
    ? (hasMessage
        ? state.messages.map((message) => (
            message.id === snapshot.messageId
              ? { ...message, content: snapshot.content, tokens }
              : message
          ))
        : [
            ...state.messages,
            {
              id: snapshot.messageId,
              session_id: snapshot.sessionId,
              role: 'assistant' as const,
              content: snapshot.content,
              tokens,
              created_at: deps.now(),
            },
          ])
    : state.messages;
  const agentRuns = snapshot.runId
    && snapshot.agentId
    && !state.agentRuns.some((run) => run.id === snapshot.runId)
    ? [
        {
          id: snapshot.runId,
          session_id: snapshot.sessionId,
          agent_id: snapshot.agentId,
          request_id: snapshot.requestId,
          status: 'running' as const,
          started_at: deps.now(),
          ended_at: null,
          aborted: 0,
        },
        ...state.agentRuns,
      ]
    : state.agentRuns;

  return {
    ...state,
    sessionId: snapshot.sessionId,
    requestId: snapshot.requestId,
    streamingMessageId: snapshot.messageId,
    currentAssistantMsgId: snapshot.messageId,
    messages,
    agentRuns,
    activeRunId: snapshot.runId,
    pendingApproval: null,
    isStreaming: true,
    accumulatedContent: snapshot.content,
  };
}

function parseTodosFromToolOutput(output: unknown): TodoItem[] | null {
  const outputObj = typeof output === 'string' ? JSON.parse(output) : output;
  if (!outputObj || typeof outputObj !== 'object') return null;
  if (Array.isArray(outputObj)) return outputObj as TodoItem[];

  const record = outputObj as Record<string, unknown>;
  const update = record.update;
  if (update && typeof update === 'object' && Array.isArray((update as Record<string, unknown>).todos)) {
    return (update as Record<string, unknown>).todos as TodoItem[];
  }

  const value = record.value;
  if (value && typeof value === 'object') {
    const valueUpdate = (value as Record<string, unknown>).update;
    if (valueUpdate && typeof valueUpdate === 'object' && Array.isArray((valueUpdate as Record<string, unknown>).todos)) {
      return (valueUpdate as Record<string, unknown>).todos as TodoItem[];
    }
  }

  return null;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value === 'string') return JSON.parse(value);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseDelegatedTaskInput(inputValue: unknown): { agentSlug: string; goal: string } {
  let agentSlug = 'unknown';
  let goal = '';
  try {
    const input = parseJsonValue(inputValue);
    if (!isRecord(input)) return { agentSlug, goal };
    agentSlug = String(input.subagent_type || input.name || 'unknown');
    if (input.task) {
      try {
        const taskPackage = parseJsonValue(input.task);
        goal = isRecord(taskPackage) && typeof taskPackage.goal === 'string'
          ? taskPackage.goal
          : '';
      } catch {
        goal = typeof input.name === 'string' ? input.name : '任务执行';
      }
    } else if (typeof input.description === 'string') {
      goal = input.description;
    }
  } catch {
    agentSlug = 'unknown';
  }
  return { agentSlug, goal };
}

function parseDelegatedTaskOutput(call: AgentToolCall): {
  status: 'running' | 'success' | 'failure';
  errorCode?: string;
  result?: DelegatedTaskProjection['result'];
} {
  if (call.status === 'error') {
    const message = call.error || '';
    let errorCode = 'UNKNOWN';
    if (message.toLowerCase().includes('timeout')) errorCode = 'TIMEOUT';
    else if (message.toLowerCase().includes('interrupt') || message.toLowerCase().includes('cancel')) errorCode = 'INTERRUPTED';
    return {
      status: 'failure',
      errorCode,
      result: {
        status: 'failure',
        artifacts: [],
        summary: '',
        error: { code: errorCode, message },
      },
    };
  }

  if (call.status === 'running') {
    return { status: 'running' };
  }

  try {
    const parsedOutput = parseJsonValue(call.output);
    if (!isRecord(parsedOutput)) {
      return { status: 'success', result: { status: 'success', artifacts: [], summary: '任务执行完成' } };
    }

    if (parsedOutput.status === 'failure') {
      const parsedError = isRecord(parsedOutput.error) ? parsedOutput.error : {};
      const errorCode = typeof parsedError.code === 'string' ? parsedError.code : 'PARSE_FAILED';
      return {
        status: 'failure',
        errorCode,
        result: parsedOutput as DelegatedTaskProjection['result'],
      };
    }

    if (parsedOutput.summary !== undefined) {
      return {
        status: 'success',
        result: parsedOutput as DelegatedTaskProjection['result'],
      };
    }

    const update = isRecord(parsedOutput.update) ? parsedOutput.update : null;
    const messages = Array.isArray(update?.messages) ? update.messages : null;
    if (parsedOutput.lg_name === 'Command' && messages && messages.length > 0) {
      const toolMessage = messages[messages.length - 1];
      const content = isRecord(toolMessage) && isRecord(toolMessage.kwargs)
        ? toolMessage.kwargs.content
        : toolMessage;
      if (typeof content === 'string') {
        try {
          const nestedResult = parseJsonValue(content);
          if (isRecord(nestedResult) && nestedResult.status === 'failure') {
            const nestedError = isRecord(nestedResult.error) ? nestedResult.error : {};
            return {
              status: 'failure',
              errorCode: typeof nestedError.code === 'string' ? nestedError.code : 'PARSE_FAILED',
              result: nestedResult as DelegatedTaskProjection['result'],
            };
          }
          return {
            status: 'success',
            result: nestedResult as DelegatedTaskProjection['result'],
          };
        } catch {
          return {
            status: 'success',
            result: { status: 'success', artifacts: [], summary: content.slice(0, 500) },
          };
        }
      }
    }

    return { status: 'success', result: { status: 'success', artifacts: [], summary: '任务执行完成' } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown parse error';
    return {
      status: 'failure',
      errorCode: 'PARSE_FAILED',
      result: {
        status: 'failure',
        artifacts: [],
        summary: '',
        error: { code: 'PARSE_FAILED', message },
      },
    };
  }
}

export function projectConversationRuntime(
  state: ConversationRuntimeProjectionState,
  event: ConversationRuntimeEvent,
  deps: ConversationRuntimeProjectionDeps,
): ConversationRuntimeProjectionResult {
  if (event.kind !== 'llm') {
    return projectParallelTaskStep(state, event.event, deps);
  }

  // const 别名使判别收窄能穿透闭包与别名条件（event.event 属性路径做不到）
  const streamEvent = event.event;

  if (streamEvent.type === 'todos_update') {
    return {
      state: { ...state, todos: streamEvent.todos },
      effects: [],
    };
  }

  if (streamEvent.type === 'run_started') {
    return {
      state: {
        ...state,
        activeRunId: streamEvent.runId,
        agentRuns: [
          {
            id: streamEvent.runId,
            session_id: state.sessionId,
            agent_id: streamEvent.agentId,
            request_id: state.requestId,
            status: streamEvent.status,
            started_at: deps.now(),
            ended_at: null,
            aborted: 0,
          },
          ...state.agentRuns.filter((run) => run.id !== streamEvent.runId),
        ],
        agentToolCalls: [],
      },
      effects: [],
    };
  }

  if (streamEvent.type === 'run_updated') {
    const terminal = ['completed', 'failed', 'aborted'].includes(streamEvent.status);
    return {
      state: {
        ...state,
        agentRuns: state.agentRuns.map((run) => (
          run.id === streamEvent.runId
            ? {
                ...run,
                status: streamEvent.status,
                error: streamEvent.error || run.error || null,
                ended_at: terminal ? deps.now() : run.ended_at,
              }
            : run
        )),
      },
      effects: [],
    };
  }

  if (streamEvent.type === 'skill_attribution') {
    const message: Message = {
      id: deps.createId(),
      session_id: state.sessionId,
      role: 'system',
      content: JSON.stringify({
        type: 'skill_attribution',
        attributions: streamEvent.attributions,
      }),
      created_at: deps.now(),
      tokens: 0,
    };
    return {
      state: {
        ...state,
        messages: [...state.messages, message],
      },
      effects: [{ type: 'saveMessage', message }],
    };
  }

  if (streamEvent.type === 'message_chunk' && streamEvent.text) {
    const accumulatedContent = state.accumulatedContent + streamEvent.text;
    const hasCurrentAssistant = state.messages.some((message) => message.id === state.currentAssistantMsgId);
    const currentAssistantMessage: Message = {
      id: state.currentAssistantMsgId,
      session_id: state.sessionId,
      role: 'assistant',
      content: '',
      tokens: 0,
      created_at: deps.now(),
    };
    const messages = (hasCurrentAssistant ? state.messages : [...state.messages, currentAssistantMessage])
      .map((message) => (
        message.id === state.currentAssistantMsgId
          ? { ...message, content: accumulatedContent }
          : message
      ));

    return {
      state: { ...state, messages, accumulatedContent },
      effects: [],
    };
  }

  if (streamEvent.type === 'tool_start') {
    const effects: ConversationRuntimeProjectionEffect[] = [{ type: 'openActivityPanel' }];
    const messages = [...state.messages];

    if (state.accumulatedContent.trim()) {
      effects.push({
        type: 'saveMessage',
        message: {
          id: state.currentAssistantMsgId,
          session_id: state.sessionId,
          role: 'assistant',
          content: state.accumulatedContent,
          tokens: deps.estimateTokens(state.accumulatedContent),
        },
      });
    }

    const toolMessageId = streamEvent.id || deps.createId();
    const pendingToolMessages = { ...state.pendingToolMessages };
    if (!streamEvent.id) {
      pendingToolMessages[streamEvent.name] = [
        ...(pendingToolMessages[streamEvent.name] ?? []),
        toolMessageId,
      ];
    }

    const toolContent = JSON.stringify({
      type: 'tool',
      name: streamEvent.name,
      status: 'running',
      input: streamEvent.input,
    });
    const toolMessage: Message = {
      id: toolMessageId,
      session_id: state.sessionId,
      role: 'system',
      content: toolContent,
      created_at: deps.now(),
      tokens: 0,
    };

    const existingToolMessage = messages.some((message) => message.id === toolMessageId);
    const nextMessages = existingToolMessage
      ? messages.map((message) => message.id === toolMessageId ? { ...message, content: toolContent } : message)
      : [...messages, toolMessage];

    const agentToolCalls = streamEvent.id && !state.agentToolCalls.some((toolCall) => toolCall.id === streamEvent.id)
      ? [
          ...state.agentToolCalls,
          {
            id: streamEvent.id,
            run_id: state.activeRunId || '',
            tool_name: streamEvent.name,
            input: JSON.stringify(streamEvent.input ?? null),
            output: null,
            status: 'running' as const,
            error: null,
            started_at: deps.now(),
            ended_at: null,
            approval_status: null,
          },
        ]
      : state.agentToolCalls.map((toolCall) => (
          toolCall.id === toolMessageId
            ? { ...toolCall, status: 'running' as const, input: JSON.stringify(streamEvent.input ?? null) }
            : toolCall
        ));

    if (!existingToolMessage) {
      effects.push({ type: 'saveMessage', message: toolMessage });
    }

    return {
      state: {
        ...state,
        messages: nextMessages,
        agentToolCalls,
        pendingToolMessages,
        runtimeToolMessageIds: state.runtimeToolMessageIds.includes(toolMessageId)
          ? state.runtimeToolMessageIds
          : [...state.runtimeToolMessageIds, toolMessageId],
        currentAssistantMsgId: deps.createId(),
        accumulatedContent: '',
      },
      effects,
    };
  }

  if (streamEvent.type === 'approval_required') {
    return {
      state: { ...state, pendingApproval: streamEvent.approval },
      effects: [],
    };
  }

  if (streamEvent.type === 'approval_resolved') {
    return {
      state: { ...state, pendingApproval: null },
      effects: [],
    };
  }

  if (streamEvent.type === 'delegated_task_start') {
    const existingTask = state.delegatedTasks.find((task) => (
      task.taskId === streamEvent.taskId ||
      (task.status === 'running' && task.agentSlug === streamEvent.agentSlug)
    ));
    const nextTask: DelegatedTaskProjection = {
      taskId: streamEvent.taskId,
      agentSlug: streamEvent.agentSlug,
      agentName: streamEvent.agentName,
      goal: streamEvent.goal,
      status: 'running',
      chunks: [],
      steps: [],
      startedAt: deps.now(),
    };
    return {
      state: {
        ...state,
        delegatedTasks: existingTask
          ? state.delegatedTasks.map((task) => (
              task.taskId === existingTask.taskId
                ? { ...task, ...nextTask, chunks: task.chunks, steps: task.steps, startedAt: task.startedAt ?? nextTask.startedAt }
                : task
            ))
          : [...state.delegatedTasks, nextTask],
      },
      effects: [{ type: 'openActivityPanel' }],
    };
  }

  if (streamEvent.type === 'delegated_task_chunk') {
    return {
      state: {
        ...state,
        delegatedTasks: state.delegatedTasks.map((task) => (
          task.taskId === streamEvent.taskId
            ? { ...task, chunks: [...task.chunks, streamEvent.text] }
            : task
        )),
      },
      effects: [],
    };
  }

  if (streamEvent.type === 'delegated_task_step') {
    return {
      state: {
        ...state,
        delegatedTasks: state.delegatedTasks.map((task) => (
          task.taskId === streamEvent.taskId
            ? { ...task, steps: [...task.steps, streamEvent.step] }
            : task
        )),
      },
      effects: [],
    };
  }

  if (streamEvent.type === 'delegated_task_end') {
    return {
      state: {
        ...state,
        delegatedTasks: state.delegatedTasks.map((task) => (
          task.taskId === streamEvent.taskId
            ? {
                ...task,
                status: streamEvent.status,
                result: streamEvent.result,
                errorCode: streamEvent.errorCode,
                completedAt: deps.now(),
              }
            : task
        )),
      },
      effects: [],
    };
  }

  if (streamEvent.type === 'tool_end' || streamEvent.type === 'tool_error') {
    const pendingToolMessages = { ...state.pendingToolMessages };
    let toolMessageId = streamEvent.id;
    if (!toolMessageId) {
      const queue = [...(pendingToolMessages[streamEvent.name] ?? [])];
      toolMessageId = queue.shift();
      pendingToolMessages[streamEvent.name] = queue;
    }
    if (!toolMessageId) {
      return { state: { ...state, pendingToolMessages }, effects: [] };
    }

    const isEnd = streamEvent.type === 'tool_end';
    let parallelBatches = state.parallelBatches;
    let todos = state.todos;
    if (isEnd && streamEvent.name === 'parallel_tasks') {
      try {
        const raw = typeof streamEvent.output === 'string'
          ? streamEvent.output
          : JSON.stringify(streamEvent.output ?? '{}');
        const parsed = JSON.parse(raw) as { batchId?: string; results?: Array<{ name: string; status: 'success' | 'failure' }> };
        if (parsed.batchId && Array.isArray(parsed.results)) {
          parallelBatches = state.parallelBatches.map((batch) => (
            batch.batchId !== parsed.batchId
              ? batch
              : {
                  ...batch,
                  workers: batch.workers.map((worker) => {
                    const result = parsed.results?.find((item) => item.name === worker.agentSlug);
                    return result ? { ...worker, status: result.status, completedAt: deps.now() } : worker;
                  }),
                }
          ));
        }
      } catch {
        parallelBatches = state.parallelBatches;
      }
    }
    if (isEnd && streamEvent.name === 'write_todos') {
      try {
        const parsedTodos = parseTodosFromToolOutput(streamEvent.output);
        if (parsedTodos) {
          todos = parsedTodos;
        }
      } catch {
        todos = state.todos;
      }
    }
    const currentMessage = state.messages.find((message) => message.id === toolMessageId);
    let parsedContent: Record<string, unknown> = { type: 'tool', name: streamEvent.name };
    if (currentMessage) {
      try {
        parsedContent = JSON.parse(currentMessage.content);
      } catch {
        parsedContent = { type: 'tool', name: streamEvent.name };
      }
    }
    const nextContent = JSON.stringify({
      ...parsedContent,
      status: isEnd ? 'success' : 'error',
      output: isEnd ? streamEvent.output : undefined,
      error: !isEnd ? streamEvent.error : undefined,
    });
    const messages = state.messages.map((message) => (
      message.id === toolMessageId ? { ...message, content: nextContent } : message
    ));
    const agentToolCalls = state.agentToolCalls.map((toolCall) => (
      toolCall.id === toolMessageId
        ? {
            ...toolCall,
            status: isEnd ? 'success' as const : 'error' as const,
            output: isEnd ? JSON.stringify(streamEvent.output ?? null) : toolCall.output,
            error: !isEnd ? streamEvent.error : null,
            ended_at: deps.now(),
          }
        : toolCall
    ));

    const effects: ConversationRuntimeProjectionEffect[] = currentMessage
      ? [
          {
            type: 'saveMessage',
            message: {
              id: toolMessageId,
              session_id: state.sessionId,
              role: 'system',
              content: nextContent,
              created_at: currentMessage.created_at,
              tokens: 0,
            },
          },
        ]
      : [];

    return {
      state: {
        ...state,
        messages,
        agentToolCalls,
        pendingToolMessages,
        parallelBatches,
        todos,
      },
      effects,
    };
  }

  if (streamEvent.type === 'message_done') {
    const effects: ConversationRuntimeProjectionEffect[] = [];
    let messages = state.messages;

    if (state.accumulatedContent.trim()) {
      const tokens = deps.estimateTokens(state.accumulatedContent);
      effects.push({
        type: 'saveMessage',
        message: {
          id: state.currentAssistantMsgId,
          session_id: state.sessionId,
          role: 'assistant',
          content: state.accumulatedContent,
          tokens,
        },
      });
      messages = messages.map((message) => (
        message.id === state.currentAssistantMsgId ? { ...message, tokens } : message
      ));
    }

    messages = messages.filter((message) => !(message.role === 'assistant' && message.content === ''));
    effects.push({ type: 'cleanupStream' }, { type: 'resolveStream' });

    return {
      state: {
        ...state,
        messages,
        isStreaming: false,
        streamingMessageId: null,
        pendingApproval: null,
        accumulatedContent: '',
      },
      effects,
    };
  }

  if (streamEvent.type === 'runtime_error') {
    const transientMessageIds = new Set([
      state.streamingMessageId,
      state.currentAssistantMsgId,
      ...Object.values(state.pendingToolMessages).flat(),
      ...state.runtimeToolMessageIds,
    ].filter(Boolean));
    const messages = state.messages.filter((message) => (
      !transientMessageIds.has(message.id) &&
      !(message.role === 'assistant' && message.content === '')
    ));

    return {
      state: {
        ...state,
        messages,
        isStreaming: false,
        streamingMessageId: null,
        pendingApproval: null,
        accumulatedContent: '',
      },
      effects: [
        { type: 'cleanupStream' },
        {
          type: 'setRetryableError',
          message: streamEvent.errorMessageKey || streamEvent.error,
          messageParams: streamEvent.errorMessageParams,
        },
        {
          type: 'rejectStream',
          error: streamEvent.errorMessageKey || streamEvent.error,
          messageParams: streamEvent.errorMessageParams,
        },
      ],
    };
  }

  return { state, effects: [] };
}

export function restoreConversationRuntime(input: RestoreConversationRuntimeInput): RestoredConversationRuntimeProjection {
  const activeRun = input.agentRuns[0] || null;
  const delegatedTasks: DelegatedTaskProjection[] = [];
  const parallelBatches: ParallelBatchProjection[] = [];

  for (const call of input.agentToolCalls) {
    if (call.tool_name === 'task') {
      const { agentSlug, goal } = parseDelegatedTaskInput(call.input);

      let { status, errorCode, result } = parseDelegatedTaskOutput(call);
      if (status === 'running') {
        if (input.isStreaming) {
          status = 'running';
        } else {
          status = 'failure';
          errorCode = 'DISCONNECTED';
          result = {
            status: 'failure',
            artifacts: [],
            summary: '',
            error: { code: 'DISCONNECTED', message: '会话流已结束，任务未正常完成' },
          };
        }
      }

      delegatedTasks.push({
        taskId: call.id,
        agentSlug,
        agentName: agentSlug,
        goal,
        status,
        chunks: [],
        steps: [],
        result,
        errorCode,
        startedAt: call.started_at,
        completedAt: call.ended_at || undefined,
      });
    }
  }

  for (const call of input.agentToolCalls) {
    if (call.tool_name !== 'parallel_tasks') continue;
    try {
      const parsedInput = parseJsonValue(call.input);
      const inputRecord = isRecord(parsedInput) ? parsedInput : {};
      const tasks = Array.isArray(inputRecord.tasks)
        ? inputRecord.tasks.filter(isRecord)
        : [];
      const parsedOutput = call.output ? parseJsonValue(call.output) : {};
      const outputRecord = isRecord(parsedOutput) ? parsedOutput : {};
      const batchId = typeof outputRecord.batchId === 'string' ? outputRecord.batchId : call.id;
      const results = Array.isArray(outputRecord.results)
        ? outputRecord.results.filter(isRecord)
        : [];
      const workers = tasks.map((task) => {
        let status: 'running' | 'success' | 'failure' = 'success';
        const taskName = typeof task.name === 'string' ? task.name : 'unknown';
        const result = results.find((item) => item.name === taskName);
        if (call.status === 'running') {
          status = input.isStreaming ? 'running' : 'failure';
        } else if (call.status === 'error' || result?.status === 'failure') {
          status = 'failure';
        }
        return {
          agentSlug: taskName,
          agentName: typeof result?.agentName === 'string' ? result.agentName : undefined,
          goal: typeof task.description === 'string' ? task.description : undefined,
          status,
          steps: [],
          textBuffer: typeof result?.output === 'string' ? result.output : '',
          startedAt: call.started_at ?? Date.now(),
          completedAt: call.ended_at || undefined,
        };
      });
      parallelBatches.push({
        batchId,
        workers,
        startedAt: call.started_at ?? Date.now(),
      });
    } catch {
      // Ignore malformed persisted parallel task calls; the activity adapter can still show other calls.
    }
  }

  return {
    agentRuns: input.agentRuns,
    agentToolCalls: input.agentToolCalls,
    delegatedTasks,
    parallelBatches,
    todos: input.latestTodos ?? [],
    activeRunId: activeRun?.id || null,
  };
}

function projectParallelTaskStep(
  state: ConversationRuntimeProjectionState,
  event: { batchId: string; agentSlug: string; workerId?: string; step: ExecutionStep },
  deps: ConversationRuntimeProjectionDeps,
): ConversationRuntimeProjectionResult {
  const findWorker = (workers: ParallelWorkerProjection[]) =>
    workers.findIndex((worker) => (
      event.workerId ? worker.workerId === event.workerId : worker.agentSlug === event.agentSlug
    ));
  const batchIndex = state.parallelBatches.findIndex((batch) => batch.batchId === event.batchId);

  if (event.step.type === 'task_start') {
    const newWorker: ParallelWorkerProjection = {
      workerId: event.workerId,
      agentSlug: event.agentSlug,
      agentName: event.step.label,
      goal: event.step.goal,
      status: 'running',
      steps: [],
      textBuffer: '',
      startedAt: deps.now(),
    };
    if (batchIndex === -1) {
      return {
        state: {
          ...state,
          parallelBatches: [
            ...state.parallelBatches,
            { batchId: event.batchId, startedAt: deps.now(), workers: [newWorker] },
          ],
        },
        effects: [],
      };
    }
    const batch = { ...state.parallelBatches[batchIndex] };
    if (findWorker(batch.workers) !== -1) {
      return { state, effects: [] };
    }
    batch.workers = [...batch.workers, newWorker];
    const parallelBatches = [...state.parallelBatches];
    parallelBatches[batchIndex] = batch;
    return { state: { ...state, parallelBatches }, effects: [] };
  }

  if (event.step.type === 'task_end') {
    if (batchIndex === -1) return { state, effects: [] };
    const batch = { ...state.parallelBatches[batchIndex] };
    const workerIndex = findWorker(batch.workers);
    if (workerIndex === -1) return { state, effects: [] };
    const workers = [...batch.workers];
    workers[workerIndex] = {
      ...workers[workerIndex],
      status: event.step.success !== false ? 'success' : 'failure',
      completedAt: deps.now(),
      summary: event.step.summary,
    };
    batch.workers = workers;
    const parallelBatches = [...state.parallelBatches];
    parallelBatches[batchIndex] = batch;
    return { state: { ...state, parallelBatches }, effects: [] };
  }

  const isTextChunk = event.step.type === 'text_chunk';
  const chunk = isTextChunk ? (event.step.content ?? '') : '';
  const newWorker: ParallelWorkerProjection = {
    workerId: event.workerId,
    agentSlug: event.agentSlug,
    status: 'running',
    steps: isTextChunk ? [] : [event.step],
    textBuffer: chunk,
    startedAt: deps.now(),
  };

  if (batchIndex === -1) {
    return {
      state: {
        ...state,
        parallelBatches: [
          ...state.parallelBatches,
          { batchId: event.batchId, startedAt: deps.now(), workers: [newWorker] },
        ],
      },
      effects: [],
    };
  }

  const batch = { ...state.parallelBatches[batchIndex] };
  const workerIndex = findWorker(batch.workers);
  if (workerIndex === -1) {
    batch.workers = [...batch.workers, newWorker];
  } else {
    const workers = [...batch.workers];
    const worker = workers[workerIndex];
    workers[workerIndex] = isTextChunk
      ? { ...worker, textBuffer: (worker.textBuffer ?? '') + chunk }
      : { ...worker, steps: [...worker.steps, event.step] };
    batch.workers = workers;
  }
  const parallelBatches = [...state.parallelBatches];
  parallelBatches[batchIndex] = batch;
  return { state: { ...state, parallelBatches }, effects: [] };
}
