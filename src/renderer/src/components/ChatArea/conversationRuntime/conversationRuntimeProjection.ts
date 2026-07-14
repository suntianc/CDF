import type {
  AgentApprovalRequest,
  AgentApprovalHistoryEntry,
  ConversationRunStreamSnapshot,
  AgentRun,
  AgentToolCall,
  DelegatedAgentRun,
  DelegatedToolActionRecord,
  ExecutionStep,
  LLMStreamEvent,
  Message,
  TodoItem,
} from '@shared/types';

export interface DelegatedTaskProjection {
  delegatedRunId: string;
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
  delegatedRunId: string;
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
  pendingApprovals: AgentApprovalRequest[];
  approvalHistory: AgentApprovalHistoryEntry[];
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
  | { kind: 'parallelTaskStep'; event: { batchId: string; delegatedRunId: string; agentSlug: string; step: ExecutionStep } };

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
  delegatedAgentRuns?: DelegatedAgentRun[];
  delegatedToolActions?: DelegatedToolActionRecord[];
  latestTodos?: TodoItem[];
}

export type RestoredConversationRuntimeProjection = Pick<
  ConversationRuntimeProjectionState,
  'agentRuns' | 'agentToolCalls' | 'delegatedTasks' | 'parallelBatches' | 'todos' | 'activeRunId' | 'approvalHistory'
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
    pendingApprovals: [],
    approvalHistory: [],
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
  const base: ConversationRuntimeProjectionState = {
    ...state,
    sessionId: snapshot.sessionId,
    requestId: snapshot.requestId,
    streamingMessageId: snapshot.messageId,
    currentAssistantMsgId: snapshot.messageId,
    activeRunId: null,
    pendingApproval: null,
    pendingApprovals: [],
    approvalHistory: [],
    isStreaming: true,
    accumulatedContent: '',
  };

  if (snapshot.events.length > 0) {
    return snapshot.events.reduce<ConversationRuntimeProjectionState>(
      (projection, event) => projectConversationRuntime(
        projection,
        { kind: 'llm', event },
        deps,
      ).state,
      base,
    );
  }

  // Compatibility fallback for snapshots created before complete event replay.
  const tokens = deps.estimateTokens(snapshot.content);
  const hasMessage = base.messages.some((message) => message.id === snapshot.messageId);
  const messages = snapshot.content
    ? (hasMessage
        ? base.messages.map((message) => (
            message.id === snapshot.messageId
              ? { ...message, content: snapshot.content, tokens }
              : message
          ))
        : [
            ...base.messages,
            {
              id: snapshot.messageId,
              session_id: snapshot.sessionId,
              role: 'assistant' as const,
              content: snapshot.content,
              tokens,
              created_at: deps.now(),
            },
          ])
    : base.messages;
  const agentRuns = snapshot.runId
    && snapshot.agentId
    && !base.agentRuns.some((run) => run.id === snapshot.runId)
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
        ...base.agentRuns,
      ]
    : base.agentRuns;

  return {
    ...base,
    messages,
    agentRuns,
    activeRunId: snapshot.runId,
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
      ...(streamEvent.delegatedRunId ? { delegatedRunId: streamEvent.delegatedRunId } : {}),
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
            ...(streamEvent.delegatedRunId ? { delegated_run_id: streamEvent.delegatedRunId } : {}),
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
            ? {
                ...toolCall,
                ...(streamEvent.delegatedRunId ? { delegated_run_id: streamEvent.delegatedRunId } : {}),
                status: 'running' as const,
                input: JSON.stringify(streamEvent.input ?? null),
              }
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
    const existingIndex = state.pendingApprovals.findIndex((item) => item.id === streamEvent.approval.id);
    const pendingApprovals = existingIndex >= 0
      ? state.pendingApprovals.map((item, index) => index === existingIndex ? streamEvent.approval : item)
      : [...state.pendingApprovals, streamEvent.approval];
    return {
      state: { ...state, pendingApprovals, pendingApproval: pendingApprovals[0] ?? null },
      effects: [],
    };
  }

  if (streamEvent.type === 'approval_resolved') {
    const approval = state.pendingApprovals.find((item) => item.id === streamEvent.approvalId);
    if (!approval) return { state, effects: [] };
    const pendingApprovals = state.pendingApprovals.filter((item) => item.id !== streamEvent.approvalId);
    const historyEntry = approval
      ? {
          approval,
          status: streamEvent.status,
          resolvedAt: streamEvent.resolvedAt ?? deps.now(),
          executionStatus: streamEvent.executionStatus,
          output: streamEvent.output,
          error: streamEvent.error,
        }
      : null;
    const approvalHistory = historyEntry && !state.approvalHistory.some((item) => item.approval.id === streamEvent.approvalId)
      ? [...state.approvalHistory, historyEntry]
      : state.approvalHistory;
    return {
      state: {
        ...state,
        pendingApprovals,
        pendingApproval: pendingApprovals[0] ?? null,
        approvalHistory,
      },
      effects: [],
    };
  }

  if (streamEvent.type === 'approval_outcome') {
    return {
      state: {
        ...state,
        approvalHistory: state.approvalHistory.map((item) => (
          item.approval.id === streamEvent.approvalId
            ? {
                ...item,
                executionStatus: streamEvent.executionStatus,
                output: streamEvent.output,
                error: streamEvent.error,
              }
            : item
        )),
      },
      effects: [],
    };
  }

  if (streamEvent.type === 'delegated_task_start') {
    const existingTask = state.delegatedTasks.find(
      (task) => task.delegatedRunId === streamEvent.delegatedRunId,
    );
    const nextTask: DelegatedTaskProjection = {
      delegatedRunId: streamEvent.delegatedRunId,
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
              task.delegatedRunId === existingTask.delegatedRunId
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
          task.delegatedRunId === streamEvent.delegatedRunId
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
          task.delegatedRunId === streamEvent.delegatedRunId
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
          task.delegatedRunId === streamEvent.delegatedRunId
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
        const parsed = JSON.parse(raw) as { batchId?: string; results?: Array<{ delegatedRunId: string; name: string; status: 'success' | 'failure' }> };
        if (parsed.batchId && Array.isArray(parsed.results)) {
          parallelBatches = state.parallelBatches.map((batch) => (
            batch.batchId !== parsed.batchId
              ? batch
              : {
                  ...batch,
                  workers: batch.workers.map((worker) => {
                    const result = parsed.results?.find((item) => item.delegatedRunId === worker.delegatedRunId);
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

    const unresolved = state.pendingApprovals.length > 0
      ? state.pendingApprovals
      : state.pendingApproval ? [state.pendingApproval] : [];
    const knownHistoryIds = new Set(state.approvalHistory.map((entry) => entry.approval.id));
    const approvalHistory = [
      ...state.approvalHistory,
      ...unresolved
        .filter((approval) => !knownHistoryIds.has(approval.id))
        .map((approval) => ({
          approval,
          status: 'invalidated' as const,
          resolvedAt: deps.now(),
          executionStatus: 'rejected' as const,
          error: 'Conversation run ended before approval was resolved',
        })),
    ];
    return {
      state: {
        ...state,
        messages,
        isStreaming: false,
        streamingMessageId: null,
        pendingApproval: null,
        pendingApprovals: [],
        approvalHistory,
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

    const unresolved = state.pendingApprovals.length > 0
      ? state.pendingApprovals
      : state.pendingApproval ? [state.pendingApproval] : [];
    const knownHistoryIds = new Set(state.approvalHistory.map((entry) => entry.approval.id));
    const approvalHistory = [
      ...state.approvalHistory,
      ...unresolved
        .filter((approval) => !knownHistoryIds.has(approval.id))
        .map((approval) => ({
          approval,
          status: 'invalidated' as const,
          resolvedAt: deps.now(),
          executionStatus: 'rejected' as const,
          error: streamEvent.error,
        })),
    ];
    return {
      state: {
        ...state,
        messages,
        isStreaming: false,
        streamingMessageId: null,
        pendingApproval: null,
        pendingApprovals: [],
        approvalHistory,
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
  const delegatedRunsById = new Map((input.delegatedAgentRuns ?? []).map((run) => [run.id, run]));
  const approvalHistory: AgentApprovalHistoryEntry[] = (input.delegatedToolActions ?? [])
    .filter((action) => action.approval_status !== 'pending' && action.approval_status !== 'not_required')
    .map((action) => {
      const delegatedRun = delegatedRunsById.get(action.delegated_run_id);
      return {
        approval: {
          id: action.id,
          runId: action.parent_run_id,
          delegatedRunId: action.delegated_run_id,
          targetAgentId: delegatedRun?.target_agent_id,
          targetAgentSlug: delegatedRun?.target_agent_slug,
          targetAgentName: delegatedRun?.target_agent_name,
          delegatedTask: delegatedRun?.goal,
          actionId: action.action_id,
          actions: [{
            name: action.tool_name,
            args: action.arguments,
            description: action.description ?? undefined,
            allowedDecisions: ['approve', 'reject'],
          }],
        },
        status: action.approval_status === 'approved'
          ? 'approved'
          : action.approval_status === 'rejected' ? 'rejected' : 'invalidated',
        resolvedAt: action.decided_at ?? action.ended_at ?? action.updated_at,
        executionStatus: action.execution_status,
        output: action.output,
        error: action.error,
      };
    });

  for (const run of input.delegatedAgentRuns ?? []) {
    const isActive = run.status === 'queued' || run.status === 'running';
    const status: 'running' | 'success' | 'failure' = isActive
      ? input.isStreaming ? 'running' : 'failure'
      : run.status === 'completed' ? 'success' : 'failure';
    const result = run.outcome;
    if (run.launch_form === 'parallel' && run.batch_id) {
      let batch = parallelBatches.find((candidate) => candidate.batchId === run.batch_id);
      if (!batch) {
        batch = { batchId: run.batch_id, workers: [], startedAt: run.created_at };
        parallelBatches.push(batch);
      }
      batch.startedAt = Math.min(batch.startedAt, run.created_at);
      batch.workers.push({
        delegatedRunId: run.id,
        agentSlug: run.target_agent_slug,
        agentName: run.target_agent_name,
        goal: run.goal,
        summary: result?.summary,
        status,
        steps: [],
        textBuffer: result?.status === 'success' ? result.summary : '',
        startedAt: run.started_at ?? run.created_at,
        completedAt: run.ended_at ?? undefined,
      });
      continue;
    }
    delegatedTasks.push({
      delegatedRunId: run.id,
      taskId: run.task_tool_call_id ?? run.id,
      agentSlug: run.target_agent_slug,
      agentName: run.target_agent_name,
      goal: run.goal,
      status,
      chunks: [],
      steps: [],
      result: result ?? undefined,
      errorCode: result?.status === 'failure'
        ? result.error?.code
        : isActive && !input.isStreaming ? 'DISCONNECTED' : undefined,
      startedAt: run.started_at ?? run.created_at,
      completedAt: run.ended_at ?? undefined,
    });
  }

  return {
    agentRuns: input.agentRuns,
    agentToolCalls: input.agentToolCalls,
    delegatedTasks,
    parallelBatches,
    todos: input.latestTodos ?? [],
    activeRunId: activeRun?.id || null,
    approvalHistory,
  };
}

function projectParallelTaskStep(
  state: ConversationRuntimeProjectionState,
  event: { batchId: string; delegatedRunId: string; agentSlug: string; step: ExecutionStep },
  deps: ConversationRuntimeProjectionDeps,
): ConversationRuntimeProjectionResult {
  const findWorker = (workers: ParallelWorkerProjection[]) =>
    workers.findIndex((worker) => worker.delegatedRunId === event.delegatedRunId);
  const batchIndex = state.parallelBatches.findIndex((batch) => batch.batchId === event.batchId);

  if (event.step.type === 'task_start') {
    const newWorker: ParallelWorkerProjection = {
      delegatedRunId: event.delegatedRunId,
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
    delegatedRunId: event.delegatedRunId,
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
