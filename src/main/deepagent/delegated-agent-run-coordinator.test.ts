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
  `);
  db.prepare('INSERT INTO agents (id) VALUES (?)').run('agent-child');
  db.prepare('INSERT INTO agent_runs (id) VALUES (?)').run('run-parent');
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
