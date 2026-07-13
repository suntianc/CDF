import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DelegatedTaskResult } from '../../shared/types';
import {
  DelegatedAgentRunRepository,
  initializeDelegatedAgentRunSchema,
} from './delegated-agent-run-repository';
import {
  DelegatedAgentRunCoordinator,
  type DelegatedRuntimeAdapter,
} from './delegated-agent-run-coordinator';

function createDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE agents (id TEXT PRIMARY KEY);
    CREATE TABLE agent_runs (id TEXT PRIMARY KEY);
    CREATE TABLE workflow_run_tasks (id TEXT PRIMARY KEY);
  `);
  db.prepare('INSERT INTO agents (id) VALUES (?)').run('agent-child');
  db.prepare('INSERT INTO agent_runs (id) VALUES (?)').run('run-parent');
  for (let index = 1; index <= 6; index += 1) {
    db.prepare('INSERT INTO workflow_run_tasks (id) VALUES (?)').run(`workflow-task-${index}`);
  }
  initializeDelegatedAgentRunSchema(db);
  return db;
}

const success: DelegatedTaskResult = {
  status: 'success',
  artifacts: ['/tmp/result.md'],
  summary: 'done',
};

const request = {
  parentAgentRunId: 'run-parent',
  targetAgentId: 'agent-child',
  targetAgentSlug: 'child',
  targetAgentName: 'Child Agent',
  taskToolCallId: 'task-call-1',
  goal: 'inspect the repository',
};

describe('DelegatedAgentRunCoordinator', () => {
  const databases: Database.Database[] = [];

  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
  });

  function setup(adapter: DelegatedRuntimeAdapter) {
    const db = createDatabase();
    databases.push(db);
    const repository = new DelegatedAgentRunRepository(db);
    const coordinator = new DelegatedAgentRunCoordinator(repository, adapter, {
      createId: () => 'delegated-run-1',
      now: vi.fn()
        .mockReturnValueOnce(100)
        .mockReturnValueOnce(200)
        .mockReturnValueOnce(300),
    });
    return { coordinator, repository };
  }

  it('persists queued identity before starting the runtime and records completion', async () => {
    let rowSeenByAdapter: ReturnType<DelegatedAgentRunRepository['get']>;
    const adapter: DelegatedRuntimeAdapter = {
      run: vi.fn(async (runtimeRequest) => {
        rowSeenByAdapter = repository.get(runtimeRequest.delegatedRunId);
        expect(rowSeenByAdapter).toMatchObject({
          id: 'delegated-run-1',
          parent_run_id: 'run-parent',
          target_agent_id: 'agent-child',
          target_agent_slug: 'child',
          launch_form: 'single',
          task_tool_call_id: 'task-call-1',
          status: 'running',
          created_at: 100,
          started_at: 200,
        });
        return success;
      }),
    };
    const { coordinator, repository } = setup(adapter);

    const queued = coordinator.queueSingle(request);
    expect(queued.status).toBe('queued');
    expect(adapter.run).not.toHaveBeenCalled();

    await expect(coordinator.runSingle({ ...request, delegatedRunId: queued.id, input: {} }))
      .resolves.toEqual(success);

    expect(repository.get(queued.id)).toMatchObject({
      status: 'completed',
      outcome: success,
      error_code: null,
      error_message: null,
      ended_at: 300,
    });
  });

  it('creates an isolated adapter invocation for every delegated run', async () => {
    const runtimeInstances: object[] = [];
    const adapter: DelegatedRuntimeAdapter = {
      run: vi.fn(async () => {
        runtimeInstances.push({});
        return success;
      }),
    };
    const db = createDatabase();
    databases.push(db);
    const repository = new DelegatedAgentRunRepository(db);
    let nextId = 0;
    const coordinator = new DelegatedAgentRunCoordinator(repository, adapter, {
      createId: () => `delegated-run-${++nextId}`,
      now: () => 100 + nextId,
    });

    const first = coordinator.queueSingle(request);
    const second = coordinator.queueSingle({ ...request, taskToolCallId: 'task-call-2' });
    await coordinator.runSingle({ ...request, delegatedRunId: first.id, input: {} });
    await coordinator.runSingle({ ...request, delegatedRunId: second.id, taskToolCallId: 'task-call-2', input: {} });

    expect(adapter.run).toHaveBeenCalledTimes(2);
    expect(runtimeInstances[0]).not.toBe(runtimeInstances[1]);
    expect(first.id).not.toBe(second.id);
  });

  it('coalesces concurrent and terminal replays of the same durable run', async () => {
    let resolveRuntime!: (outcome: DelegatedTaskResult) => void;
    const adapter: DelegatedRuntimeAdapter = {
      run: vi.fn(() => new Promise<DelegatedTaskResult>((resolve) => {
        resolveRuntime = resolve;
      })),
    };
    const { coordinator } = setup(adapter);
    const queued = coordinator.queueSingle(request);

    const first = coordinator.runSingle({ ...request, delegatedRunId: queued.id, input: {} });
    const concurrentReplay = coordinator.runSingle({ ...request, delegatedRunId: queued.id, input: {} });
    expect(adapter.run).toHaveBeenCalledTimes(1);

    resolveRuntime(success);
    await expect(Promise.all([first, concurrentReplay])).resolves.toEqual([success, success]);
    await expect(coordinator.runSingle({ ...request, delegatedRunId: queued.id, input: {} }))
      .resolves.toEqual(success);
    expect(adapter.run).toHaveBeenCalledTimes(1);
  });

  it('turns adapter exceptions into a structured failure so the parent can continue', async () => {
    const adapter: DelegatedRuntimeAdapter = {
      run: vi.fn(async () => {
        throw new Error('network terminated');
      }),
    };
    const { coordinator, repository } = setup(adapter);
    const queued = coordinator.queueSingle(request);

    const outcome = await coordinator.runSingle({ ...request, delegatedRunId: queued.id, input: {} });

    expect(outcome).toEqual({
      status: 'failure',
      artifacts: [],
      summary: '',
      error: { code: 'NETWORK', message: 'network terminated' },
    });
    expect(repository.get(queued.id)).toMatchObject({
      status: 'failed',
      outcome,
      error_code: 'NETWORK',
      error_message: 'network terminated',
    });
  });

  it('queues a parallel batch before running at most four children and promotes in order', async () => {
    const resolvers = new Map<string, (outcome: DelegatedTaskResult) => void>();
    const queuedIds: string[] = [];
    const started: string[] = [];
    const adapter: DelegatedRuntimeAdapter = {
      run: vi.fn((runtimeRequest) => new Promise<DelegatedTaskResult>((resolve) => {
        started.push(runtimeRequest.delegatedRunId);
        resolvers.set(runtimeRequest.delegatedRunId, resolve);
      })),
    };
    const db = createDatabase();
    databases.push(db);
    const repository = new DelegatedAgentRunRepository(db);
    let nextId = 0;
    const coordinator = new DelegatedAgentRunCoordinator(repository, adapter, {
      createId: () => `parallel-run-${++nextId}`,
      now: () => 100 + nextId,
    });

    const batchPromise = coordinator.runBatch({
      parentAgentRunId: 'run-parent',
      batchId: 'batch-1',
      items: Array.from({ length: 6 }, (_, index) => ({
        targetAgentId: 'agent-child',
        targetAgentSlug: 'child',
        targetAgentName: 'Child Agent',
        taskToolCallId: null,
        workflowRunTaskId: `workflow-task-${index + 1}`,
        goal: `task ${index + 1}`,
        input: { messages: [{ content: `task ${index + 1}` }] },
        onQueued: (run: { id: string }) => queuedIds.push(run.id),
      })),
    });

    expect(queuedIds).toEqual([
      'parallel-run-1',
      'parallel-run-2',
      'parallel-run-3',
      'parallel-run-4',
      'parallel-run-5',
      'parallel-run-6',
    ]);
    expect(started).toEqual([
      'parallel-run-1',
      'parallel-run-2',
      'parallel-run-3',
      'parallel-run-4',
    ]);
    expect(repository.listByBatch('run-parent', 'batch-1')).toMatchObject([
      {
        id: 'parallel-run-1',
        launch_form: 'parallel',
        batch_id: 'batch-1',
        workflow_run_task_id: 'workflow-task-1',
        status: 'running',
      },
      { id: 'parallel-run-2', status: 'running' },
      { id: 'parallel-run-3', status: 'running' },
      { id: 'parallel-run-4', status: 'running' },
      { id: 'parallel-run-5', status: 'queued' },
      { id: 'parallel-run-6', status: 'queued' },
    ]);

    resolvers.get('parallel-run-2')?.(success);
    await vi.waitFor(() => expect(started).toHaveLength(5));
    expect(started[4]).toBe('parallel-run-5');

    resolvers.get('parallel-run-1')?.({
      status: 'failure',
      artifacts: [],
      summary: '',
      error: { code: 'TOOL_FAILED', message: 'first failed' },
    });
    await vi.waitFor(() => expect(started).toHaveLength(6));
    expect(started[5]).toBe('parallel-run-6');

    for (const id of ['parallel-run-3', 'parallel-run-4', 'parallel-run-5', 'parallel-run-6']) {
      resolvers.get(id)?.(success);
    }

    const results = await batchPromise;
    expect(results.map(({ delegatedRun, outcome }) => ({
      id: delegatedRun.id,
      status: outcome.status,
    }))).toEqual([
      { id: 'parallel-run-1', status: 'failure' },
      { id: 'parallel-run-2', status: 'success' },
      { id: 'parallel-run-3', status: 'success' },
      { id: 'parallel-run-4', status: 'success' },
      { id: 'parallel-run-5', status: 'success' },
      { id: 'parallel-run-6', status: 'success' },
    ]);
    expect(adapter.run).toHaveBeenCalledTimes(6);
  });

  it('migrates single-only delegated-run storage without losing existing history', () => {
    const db = new Database(':memory:');
    databases.push(db);
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE agents (id TEXT PRIMARY KEY);
      CREATE TABLE agent_runs (id TEXT PRIMARY KEY);
      CREATE TABLE delegated_agent_runs (
        id TEXT PRIMARY KEY,
        parent_run_id TEXT NOT NULL,
        target_agent_id TEXT,
        target_agent_slug TEXT NOT NULL,
        target_agent_name TEXT NOT NULL,
        launch_form TEXT NOT NULL CHECK (launch_form = 'single'),
        task_tool_call_id TEXT,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        outcome TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE agent_tool_calls (
        id TEXT PRIMARY KEY,
        delegated_run_id TEXT REFERENCES delegated_agent_runs(id) ON DELETE SET NULL
      );
      INSERT INTO agents (id) VALUES ('agent-child');
      INSERT INTO agent_runs (id) VALUES ('run-parent');
      INSERT INTO delegated_agent_runs VALUES (
        'existing-single', 'run-parent', 'agent-child', 'child', 'Child Agent',
        'single', 'task-existing', 'existing goal', 'completed',
        '{"status":"success","artifacts":[],"summary":"kept"}',
        NULL, NULL, 10, 20, 30, 30
      );
      INSERT INTO agent_tool_calls VALUES ('tool-existing', 'existing-single');
    `);

    initializeDelegatedAgentRunSchema(db);
    const repository = new DelegatedAgentRunRepository(db);
    expect(repository.get('existing-single')).toMatchObject({
      launch_form: 'single',
      batch_id: null,
      workflow_run_task_id: null,
      outcome: { status: 'success', summary: 'kept' },
    });
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.prepare("SELECT delegated_run_id FROM agent_tool_calls WHERE id = 'tool-existing'").get())
      .toEqual({ delegated_run_id: 'existing-single' });
    expect(repository.createParallel({
      id: 'new-parallel',
      parentAgentRunId: 'run-parent',
      targetAgentId: 'agent-child',
      targetAgentSlug: 'child',
      targetAgentName: 'Child Agent',
      taskToolCallId: null,
      batchId: 'batch-after-migration',
      goal: 'new goal',
      createdAt: 40,
    })).toMatchObject({
      launch_form: 'parallel',
      batch_id: 'batch-after-migration',
    });
  });

  it('reconciles process-lifetime queued and running rows as interrupted', () => {
    const { coordinator, repository } = setup({ run: vi.fn(async () => success) });
    const queued = coordinator.queueSingle(request);
    repository.markRunning(queued.id, 150);

    coordinator.reconcileInterrupted(500);

    expect(repository.get(queued.id)).toMatchObject({
      status: 'interrupted',
      error_code: 'INTERRUPTED',
      ended_at: 500,
    });
  });
});
