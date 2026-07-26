// Pure helpers behind sessionStore.fetchAgentActivity (#235). No window/store access:
// everything here takes plain data and returns new objects, so behavior is unit-testable
// and the store never mutates task objects in place.
import type { AgentToolCall, ExecutionStep, Message, TodoItem } from '@shared/types';

/**
 * Reconstruct the latest todos list from a persisted todos tool call output.
 * The output may be a JSON string or an already-deserialized value; the list can
 * sit at the top level or under `update.todos`. Throws on malformed JSON (the
 * caller decides how to log/degrade), returns [] when there is no list.
 */
export function parseLatestTodosOutput(output: unknown): TodoItem[] {
  if (!output) return [];
  const outputObj = typeof output === 'string' ? JSON.parse(output) : output;
  if (Array.isArray(outputObj)) return outputObj;
  if (outputObj.update && Array.isArray(outputObj.update.todos)) {
    return outputObj.update.todos;
  }
  return [];
}

interface DelegatedTaskRuntimeFields {
  delegatedRunId: string;
  agentSlug: string;
  agentName?: string;
  chunks: string[];
  steps: ExecutionStep[];
  startedAt?: number;
}

/**
 * Overlay transient runtime data (chunks/steps/startedAt, human-readable agentName)
 * onto DB-reconstructed delegated tasks. DB reconstruction always yields
 * `chunks: []` / `steps: []` because streaming chunks are not persisted to SQLite;
 * merging from the streaming cache first, then the current store state, prevents a
 * "0 chunks / 0 tokens" flash on every reopen / session switch.
 */
export function mergeDelegatedTaskRuntime<T extends DelegatedTaskRuntimeFields>(
  dbTasks: T[],
  streamTasks: DelegatedTaskRuntimeFields[] | undefined,
  storeTasks: DelegatedTaskRuntimeFields[],
): T[] {
  return dbTasks.map((task) => {
    const streamCached = streamTasks?.find(
      (candidate) => candidate.delegatedRunId === task.delegatedRunId,
    );
    const storeTask = storeTasks.find(
      (candidate) => candidate.delegatedRunId === task.delegatedRunId,
    );
    const next = { ...task };

    // Prefer streaming cache chunks (most recent), fall back to current store
    // chunks (may survive a brief cache deletion window), then keep the
    // DB-derived empty array as last resort.
    if (streamCached && streamCached.chunks.length > 0) {
      next.chunks = streamCached.chunks;
      // Streaming cache may carry a human-readable agentName; DB reconstruction
      // uses the slug as fallback.
      if (streamCached.agentName && streamCached.agentName !== streamCached.agentSlug) {
        next.agentName = streamCached.agentName;
      }
    } else if (storeTask && storeTask.chunks.length > 0) {
      next.chunks = storeTask.chunks;
    }

    // Preserve runtime-injected steps (not persisted to DB).
    if (streamCached && streamCached.steps.length > 0) {
      next.steps = streamCached.steps;
    } else if (storeTask && storeTask.steps.length > 0) {
      next.steps = storeTask.steps;
    }

    // Also preserve startedAt from streaming cache / store if the DB tool call
    // didn't record one (e.g. task tool call created before run_started event
    // was received).
    if (!next.startedAt) {
      next.startedAt = streamCached?.startedAt ?? storeTask?.startedAt;
    }

    return next;
  });
}

function parsePersistedToolValue(value: string | null | undefined): unknown {
  if (value === null || value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Fill completed/failed status and output back into persisted tool-card system
 * messages whose tool call has since finished. Returns the original array when
 * nothing changed so callers can keep referential equality.
 */
export function reconcilePersistedToolMessages(messages: Message[], toolCalls: AgentToolCall[]): Message[] {
  if (messages.length === 0 || toolCalls.length === 0) return messages;

  const toolCallsById = new Map(toolCalls.map((call) => [call.id, call]));
  let changed = false;

  const nextMessages = messages.map((message) => {
    if (message.role !== 'system') return message;

    let content: Record<string, unknown>;
    try {
      const parsed = JSON.parse(message.content);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return message;
      content = parsed as Record<string, unknown>;
    } catch {
      return message;
    }

    if (content.type !== 'tool') return message;
    const call = toolCallsById.get(message.id);
    if (!call || call.status === 'running') return message;

    const nextContent = {
      ...content,
      name: typeof content.name === 'string' ? content.name : call.tool_name,
      status: call.status === 'success' ? 'success' : 'error',
      output: call.status === 'success'
        ? (content.output ?? parsePersistedToolValue(call.output))
        : content.output,
      error: call.status === 'success'
        ? undefined
        : (content.error ?? call.error ?? 'Tool call did not complete successfully'),
    };
    const serialized = JSON.stringify(nextContent);
    if (serialized === message.content) return message;
    changed = true;
    return { ...message, content: serialized };
  });

  return changed ? nextMessages : messages;
}
