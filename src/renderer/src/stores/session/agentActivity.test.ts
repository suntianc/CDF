import { describe, expect, it } from 'vitest';
import {
  mergeDelegatedTaskRuntime,
  parseLatestTodosOutput,
  reconcilePersistedToolMessages,
} from './agentActivity';

describe('parseLatestTodosOutput', () => {
  const todos = [
    { id: 'todo-1', content: 'Write tests', status: 'completed' },
    { id: 'todo-2', content: 'Refactor store', status: 'in_progress' },
  ];

  it('parses a JSON string containing {update: {todos}}', () => {
    expect(parseLatestTodosOutput(JSON.stringify({ update: { todos } }))).toEqual(todos);
  });

  it('parses a JSON string containing a plain array', () => {
    expect(parseLatestTodosOutput(JSON.stringify(todos))).toEqual(todos);
  });

  it('accepts an already-deserialized output object', () => {
    expect(parseLatestTodosOutput({ update: { todos } })).toEqual(todos);
  });

  it('returns [] for empty/absent output', () => {
    expect(parseLatestTodosOutput(undefined)).toEqual([]);
    expect(parseLatestTodosOutput(null)).toEqual([]);
    expect(parseLatestTodosOutput('')).toEqual([]);
  });

  it('returns [] when the object carries no todos list', () => {
    expect(parseLatestTodosOutput({ update: { note: 'nothing' } })).toEqual([]);
    expect(parseLatestTodosOutput({ result: 'ok' })).toEqual([]);
    expect(parseLatestTodosOutput(JSON.stringify('plain string'))).toEqual([]);
  });

  it('throws on malformed JSON so the caller can log and degrade', () => {
    expect(() => parseLatestTodosOutput('not-json{')).toThrow();
  });
});

describe('mergeDelegatedTaskRuntime', () => {
  const dbTask = (overrides: Record<string, unknown> = {}) => ({
    delegatedRunId: 'delegated-1',
    taskId: 'task-1',
    agentSlug: 'code',
    agentName: 'code',
    goal: 'Implement feature',
    status: 'success' as const,
    chunks: [] as string[],
    steps: [] as any[],
    startedAt: 110,
    ...overrides,
  });

  it('prefers stream-cache chunks and human-readable agentName over store chunks', () => {
    const merged = mergeDelegatedTaskRuntime(
      [dbTask()],
      [{ delegatedRunId: 'delegated-1', agentSlug: 'code', agentName: 'Code Agent', chunks: ['stream'], steps: [] }],
      [{ delegatedRunId: 'delegated-1', agentSlug: 'code', chunks: ['store'], steps: [] }],
    );

    expect(merged[0].chunks).toEqual(['stream']);
    expect(merged[0].agentName).toBe('Code Agent');
  });

  it('falls back to store chunks when the stream cache has none, without renaming the agent', () => {
    const merged = mergeDelegatedTaskRuntime(
      [dbTask()],
      [{ delegatedRunId: 'delegated-1', agentSlug: 'code', agentName: 'Code Agent', chunks: [], steps: [] }],
      [{ delegatedRunId: 'delegated-1', agentSlug: 'code', chunks: ['store'], steps: [] }],
    );

    expect(merged[0].chunks).toEqual(['store']);
    // agentName override only applies together with stream chunks.
    expect(merged[0].agentName).toBe('code');
  });

  it('does not rename the agent when the stream agentName equals the slug', () => {
    const merged = mergeDelegatedTaskRuntime(
      [dbTask({ agentName: 'DB Name' })],
      [{ delegatedRunId: 'delegated-1', agentSlug: 'code', agentName: 'code', chunks: ['stream'], steps: [] }],
      [],
    );

    expect(merged[0].agentName).toBe('DB Name');
  });

  it('prefers stream steps, then store steps, independent of chunk sources', () => {
    const streamStep = { type: 'tool_call', name: 'write_file' } as any;
    const storeStep = { type: 'tool_call', name: 'read_file' } as any;

    const streamWins = mergeDelegatedTaskRuntime(
      [dbTask()],
      [{ delegatedRunId: 'delegated-1', agentSlug: 'code', chunks: [], steps: [streamStep] }],
      [{ delegatedRunId: 'delegated-1', agentSlug: 'code', chunks: [], steps: [storeStep] }],
    );
    expect(streamWins[0].steps).toEqual([streamStep]);

    const storeWins = mergeDelegatedTaskRuntime(
      [dbTask()],
      [{ delegatedRunId: 'delegated-1', agentSlug: 'code', chunks: [], steps: [] }],
      [{ delegatedRunId: 'delegated-1', agentSlug: 'code', chunks: [], steps: [storeStep] }],
    );
    expect(storeWins[0].steps).toEqual([storeStep]);
  });

  it('fills startedAt from stream then store only when the DB task has none', () => {
    const fromStream = mergeDelegatedTaskRuntime(
      [dbTask({ startedAt: undefined })],
      [{ delegatedRunId: 'delegated-1', agentSlug: 'code', chunks: [], steps: [], startedAt: 50 }],
      [{ delegatedRunId: 'delegated-1', agentSlug: 'code', chunks: [], steps: [], startedAt: 99 }],
    );
    expect(fromStream[0].startedAt).toBe(50);

    const fromStore = mergeDelegatedTaskRuntime(
      [dbTask({ startedAt: undefined })],
      undefined,
      [{ delegatedRunId: 'delegated-1', agentSlug: 'code', chunks: [], steps: [], startedAt: 99 }],
    );
    expect(fromStore[0].startedAt).toBe(99);

    const dbKept = mergeDelegatedTaskRuntime(
      [dbTask({ startedAt: 110 })],
      [{ delegatedRunId: 'delegated-1', agentSlug: 'code', chunks: [], steps: [], startedAt: 50 }],
      [],
    );
    expect(dbKept[0].startedAt).toBe(110);
  });

  it('returns new task objects and leaves the DB-derived inputs untouched', () => {
    const original = dbTask();
    const merged = mergeDelegatedTaskRuntime(
      [original],
      [{ delegatedRunId: 'delegated-1', agentSlug: 'code', agentName: 'Code Agent', chunks: ['stream'], steps: [] }],
      [],
    );

    expect(merged[0]).not.toBe(original);
    expect(original.chunks).toEqual([]);
    expect(original.agentName).toBe('code');
  });

  it('keeps unmatched tasks with their DB-derived fields', () => {
    const merged = mergeDelegatedTaskRuntime([dbTask()], undefined, []);
    expect(merged[0]).toEqual(dbTask());
  });
});

describe('reconcilePersistedToolMessages', () => {
  const toolMessage = (id: string, content: Record<string, unknown>) => ({
    id,
    session_id: 'session-1',
    role: 'system' as const,
    content: JSON.stringify(content),
    tokens: 0,
    created_at: 120,
  });

  const successCall = (id: string) => ({
    id,
    run_id: 'run-1',
    tool_name: 'read_file',
    input: '{}',
    output: JSON.stringify('file contents'),
    status: 'success',
    error: null,
    started_at: 120,
    ended_at: 180,
  }) as any;

  it('fills status and parsed output into a stale running tool card', () => {
    const messages = [toolMessage('tool-1', { type: 'tool', name: 'read_file', status: 'running', input: {} })];

    const next = reconcilePersistedToolMessages(messages as any, [successCall('tool-1')]);

    const parsed = JSON.parse(next[0].content);
    expect(parsed.status).toBe('success');
    expect(parsed.output).toBe('file contents');
  });

  it('marks the card as error with a fallback message when the call failed', () => {
    const messages = [toolMessage('tool-1', { type: 'tool', name: 'read_file', status: 'running', input: {} })];
    const failedCall = { ...successCall('tool-1'), status: 'error', error: null, output: null };

    const next = reconcilePersistedToolMessages(messages as any, [failedCall]);

    const parsed = JSON.parse(next[0].content);
    expect(parsed.status).toBe('error');
    expect(parsed.error).toBe('Tool call did not complete successfully');
  });

  it('returns the same array reference when nothing needs updating', () => {
    const untouched = [
      toolMessage('tool-2', { type: 'tool', name: 'read_file', status: 'running', input: {} }),
      { id: 'msg-1', session_id: 'session-1', role: 'user' as const, content: 'hi', tokens: 1, created_at: 1 },
    ];

    expect(reconcilePersistedToolMessages(untouched as any, [successCall('unrelated')])).toBe(untouched);
    expect(reconcilePersistedToolMessages(untouched as any, [{ ...successCall('tool-2'), status: 'running' }])).toBe(untouched);
    expect(reconcilePersistedToolMessages([] as any, [successCall('tool-1')])).toEqual([]);
  });
});
