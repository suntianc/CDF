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
import { captureDelegatedAgentConfigurationSnapshot } from './delegated-agent-configuration-snapshot';

function createDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE agents (id TEXT PRIMARY KEY);
    CREATE TABLE agent_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL);
    CREATE TABLE workflow_run_tasks (id TEXT PRIMARY KEY);
  `);
  db.prepare('INSERT INTO agents (id) VALUES (?)').run('agent-child');
  db.prepare('INSERT INTO agent_runs (id, session_id) VALUES (?, ?)').run('run-parent', 'session-1');
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

function configurationSnapshot(systemPrompt: string) {
  return captureDelegatedAgentConfigurationSnapshot({
    target: {
      id: 'agent-child',
      role: 'custom',
      name: 'Child Agent',
      slug: 'child',
      description: null,
      provider_id: null,
      system_prompt: systemPrompt,
      config: null,
      mcpServerExclusionIds: [],
      skillNames: [],
      created_at: 0,
      updated_at: 0,
    },
    mcpServerExclusionIds: [],
    skillNames: [],
    conversationSkillSnapshot: [],
  });
}

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

  it('pauses one gated tool action, approves it exactly once, and resumes the child', async () => {
    const db = createDatabase();
    databases.push(db);
    const repository = new DelegatedAgentRunRepository(db);
    let nextId = 0;
    let now = 100;
    const coordinator = new DelegatedAgentRunCoordinator(
      repository,
      { run: vi.fn(async () => success) },
      { createId: () => `id-${++nextId}`, now: () => ++now },
    );
    const delegatedRun = coordinator.queueSingle(request);
    repository.markRunning(delegatedRun.id, ++now);
    const approvals: Array<{ id: string; action: { name: string } }> = [];
    coordinator.subscribeToolApprovals((approval) => approvals.push(approval));
    const execute = vi.fn(async () => 'written');

    const resultPromise = coordinator.runToolAction({
      delegatedRunId: delegatedRun.id,
      action: { id: 'write-1', name: 'write_file', args: { path: 'a.md' } },
      requiresApproval: true,
      execute,
    });
    await vi.waitFor(() => expect(approvals).toHaveLength(1));

    expect(repository.get(delegatedRun.id)?.status).toBe('waiting_approval');
    expect(execute).not.toHaveBeenCalled();
    coordinator.resolveToolApproval(approvals[0].id, 'approve');

    await expect(resultPromise).resolves.toBe('written');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(repository.get(delegatedRun.id)?.status).toBe('running');
    expect(coordinator.listToolApprovalHistory(delegatedRun.id)).toEqual([
      expect.objectContaining({
        action_id: 'write-1',
        decision: 'approve',
        execution_status: 'success',
      }),
    ]);

    await expect(coordinator.runToolAction({
      delegatedRunId: delegatedRun.id,
      action: { id: 'write-1', name: 'write_file', args: { path: 'a.md' } },
      requiresApproval: true,
      execute,
    })).resolves.toBe('written');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not re-execute a failed action when the same stable action id is retried', async () => {
    const db = createDatabase();
    databases.push(db);
    const repository = new DelegatedAgentRunRepository(db);
    const coordinator = new DelegatedAgentRunCoordinator(
      repository,
      { run: vi.fn(async () => success) },
      { createId: (() => { let id = 0; return () => `id-${++id}`; })(), now: Date.now },
    );
    const delegatedRun = coordinator.queueSingle(request);
    repository.markRunning(delegatedRun.id, Date.now());
    const execute = vi.fn(async () => {
      throw new Error('write may have partially completed');
    });
    const input = {
      delegatedRunId: delegatedRun.id,
      action: { id: 'write-failed', name: 'write_file', args: { path: 'a.md' } },
      requiresApproval: false,
      execute,
    };

    await expect(coordinator.runToolAction(input)).rejects.toThrow('write may have partially completed');
    await expect(coordinator.runToolAction(input)).rejects.toThrow('write may have partially completed');

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('claims one approval atomically when duplicate resolutions arrive concurrently', async () => {
    const db = createDatabase();
    databases.push(db);
    const repository = new DelegatedAgentRunRepository(db);
    const coordinator = new DelegatedAgentRunCoordinator(
      repository,
      { run: vi.fn(async () => success) },
      { createId: (() => { let id = 0; return () => `id-${++id}`; })(), now: Date.now },
    );
    const delegatedRun = coordinator.queueSingle(request);
    repository.markRunning(delegatedRun.id, Date.now());
    let approvalId = '';
    coordinator.subscribeToolApprovals((approval) => { approvalId = approval.id; });
    const execute = vi.fn(async () => 'written once');
    const result = coordinator.runToolAction({
      delegatedRunId: delegatedRun.id,
      action: { id: 'write-concurrent', name: 'write_file', args: { path: 'a.md' } },
      requiresApproval: true,
      execute,
    });
    await vi.waitFor(() => expect(approvalId).not.toBe(''));

    const first = coordinator.resolveToolApproval(approvalId, 'approve');
    const second = coordinator.resolveToolApproval(approvalId, 'approve');

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    await expect(result).resolves.toBe('written once');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('isolates throwing approval observers from the active approval lifecycle', async () => {
    const db = createDatabase();
    databases.push(db);
    const repository = new DelegatedAgentRunRepository(db);
    const coordinator = new DelegatedAgentRunCoordinator(
      repository,
      { run: vi.fn(async () => success) },
      { createId: (() => { let id = 0; return () => `id-${++id}`; })(), now: Date.now },
    );
    const delegatedRun = coordinator.queueSingle(request);
    repository.markRunning(delegatedRun.id, Date.now());
    coordinator.subscribeToolApprovals(() => { throw new Error('renderer unavailable'); });
    let approvalId = '';
    coordinator.subscribeToolApprovals((approval) => { approvalId = approval.id; });

    const result = coordinator.runToolAction({
      delegatedRunId: delegatedRun.id,
      action: { id: 'write-observer', name: 'write_file', args: {} },
      requiresApproval: true,
      execute: async () => 'done',
    });
    await vi.waitFor(() => expect(approvalId).not.toBe(''));
    await coordinator.resolveToolApproval(approvalId, 'approve');
    await expect(result).resolves.toBe('done');
  });

  it('isolates throwing run-change observers before publishing an approval', async () => {
    const db = createDatabase();
    databases.push(db);
    const repository = new DelegatedAgentRunRepository(db);
    const coordinator = new DelegatedAgentRunCoordinator(
      repository,
      { run: vi.fn(async () => success) },
      { createId: (() => { let id = 0; return () => `id-${++id}`; })(), now: Date.now },
    );
    const delegatedRun = coordinator.queueSingle(request);
    repository.markRunning(delegatedRun.id, Date.now());
    coordinator.subscribeRunChanges(() => { throw new Error('renderer unavailable'); });
    let approvalId = '';
    coordinator.subscribeToolApprovals((approval) => { approvalId = approval.id; });

    const result = coordinator.runToolAction({
      delegatedRunId: delegatedRun.id,
      action: { id: 'write-run-observer', name: 'write_file', args: {} },
      requiresApproval: true,
      execute: async () => 'done',
    });
    await vi.waitFor(() => expect(approvalId).not.toBe(''));
    await coordinator.resolveToolApproval(approvalId, 'approve');
    await expect(result).resolves.toBe('done');
  });

  it('rejects without side effects and returns a standard rejection observation', async () => {
    const db = createDatabase();
    databases.push(db);
    const repository = new DelegatedAgentRunRepository(db);
    const coordinator = new DelegatedAgentRunCoordinator(
      repository,
      { run: vi.fn(async () => success) },
      { createId: (() => { let id = 0; return () => `id-${++id}`; })(), now: Date.now },
    );
    const delegatedRun = coordinator.queueSingle(request);
    repository.markRunning(delegatedRun.id, Date.now());
    let approvalId = '';
    coordinator.subscribeToolApprovals((approval) => { approvalId = approval.id; });
    const execute = vi.fn(async () => 'should not run');

    const resultPromise = coordinator.runToolAction({
      delegatedRunId: delegatedRun.id,
      action: { id: 'delete-1', name: 'delete_file', args: { path: 'a.md' } },
      requiresApproval: true,
      execute,
    });
    await vi.waitFor(() => expect(approvalId).not.toBe(''));
    coordinator.resolveToolApproval(approvalId, 'reject');

    const result = await resultPromise as { content?: unknown; name?: unknown };
    expect(execute).not.toHaveBeenCalled();
    expect(result.name).toBe('delete_file');
    expect(result.content).toContain('rejected');
    expect(repository.get(delegatedRun.id)?.status).toBe('running');
  });

  it('releases permitted siblings immediately and presents gated siblings in proposal order', async () => {
    const db = createDatabase();
    databases.push(db);
    const repository = new DelegatedAgentRunRepository(db);
    const coordinator = new DelegatedAgentRunCoordinator(
      repository,
      { run: vi.fn(async () => success) },
      { createId: (() => { let id = 0; return () => `id-${++id}`; })(), now: Date.now },
    );
    const delegatedRun = coordinator.queueSingle(request);
    repository.markRunning(delegatedRun.id, Date.now());
    const approvals: Array<{ id: string; action: { id: string } }> = [];
    coordinator.subscribeToolApprovals((approval) => approvals.push(approval));
    const effects: string[] = [];

    const first = coordinator.runToolAction({
      delegatedRunId: delegatedRun.id,
      action: { id: 'write-1', name: 'write_file', args: {} },
      requiresApproval: true,
      execute: async () => { effects.push('write-1'); return 'one'; },
    });
    const permitted = coordinator.runToolAction({
      delegatedRunId: delegatedRun.id,
      action: { id: 'read-1', name: 'read_file', args: {} },
      requiresApproval: false,
      execute: async () => { effects.push('read-1'); return 'read'; },
    });
    const second = coordinator.runToolAction({
      delegatedRunId: delegatedRun.id,
      action: { id: 'write-2', name: 'write_file', args: {} },
      requiresApproval: true,
      execute: async () => { effects.push('write-2'); return 'two'; },
    });

    await expect(permitted).resolves.toBe('read');
    expect(effects).toEqual(['read-1']);
    await vi.waitFor(() => expect(approvals.map(item => item.action.id)).toEqual(['write-1']));

    coordinator.resolveToolApproval(approvals[0].id, 'approve');
    await expect(first).resolves.toBe('one');
    await vi.waitFor(() => expect(approvals.map(item => item.action.id)).toEqual(['write-1', 'write-2']));
    coordinator.resolveToolApproval(approvals[1].id, 'reject');

    const [, rejected] = await Promise.all([first, second]);
    expect((rejected as { content: string }).content).toContain('rejected');
    expect(effects).toEqual(['read-1', 'write-1']);
  });

  it('keeps one active approval per child and resolves different children in reverse order', async () => {
    const db = createDatabase();
    databases.push(db);
    const repository = new DelegatedAgentRunRepository(db);
    const coordinator = new DelegatedAgentRunCoordinator(
      repository,
      { run: vi.fn(async () => success) },
      { createId: (() => { let id = 0; return () => `id-${++id}`; })(), now: Date.now },
    );
    const firstRun = coordinator.queueSingle(request);
    const secondRun = coordinator.queueSingle({ ...request, taskToolCallId: 'task-call-2', targetAgentSlug: 'child-2' });
    repository.markRunning(firstRun.id, Date.now());
    repository.markRunning(secondRun.id, Date.now());
    const approvals: Array<{ id: string; delegatedRunId: string }> = [];
    coordinator.subscribeToolApprovals((approval) => approvals.push(approval));
    const firstEffect = vi.fn(async () => 'first');
    const secondEffect = vi.fn(async () => 'second');
    const first = coordinator.runToolAction({
      delegatedRunId: firstRun.id,
      action: { id: 'write-first', name: 'write_file' },
      requiresApproval: true,
      execute: firstEffect,
    });
    const second = coordinator.runToolAction({
      delegatedRunId: secondRun.id,
      action: { id: 'write-second', name: 'write_file' },
      requiresApproval: true,
      execute: secondEffect,
    });
    await vi.waitFor(() => expect(approvals).toHaveLength(2));

    await coordinator.resolveToolApproval(approvals[1].id, 'approve');
    await expect(second).resolves.toBe('second');
    expect(repository.get(firstRun.id)?.status).toBe('waiting_approval');
    expect(repository.get(secondRun.id)?.status).toBe('running');
    expect(firstEffect).not.toHaveBeenCalled();

    await coordinator.resolveToolApproval(approvals[0].id, 'reject');
    await first;
    expect(firstEffect).not.toHaveBeenCalled();
    expect(secondEffect).toHaveBeenCalledTimes(1);
  });

  it('cancels queued, running, and approval-waiting children without deleting terminal history', async () => {
    const db = createDatabase();
    databases.push(db);
    const repository = new DelegatedAgentRunRepository(db);
    const coordinator = new DelegatedAgentRunCoordinator(
      repository,
      { run: vi.fn(async () => success) },
      { createId: (() => { let id = 0; return () => `cancel-${++id}`; })(), now: () => 500 },
    );
    const running = coordinator.queueSingle(request);
    const waiting = coordinator.queueSingle({ ...request, taskToolCallId: 'task-call-waiting' });
    const queued = coordinator.queueSingle({ ...request, taskToolCallId: 'task-call-queued' });
    repository.markRunning(running.id, 100);
    repository.markRunning(waiting.id, 100);
    const approvalResult = coordinator.runToolAction({
      delegatedRunId: waiting.id,
      action: { id: 'delete-waiting', name: 'delete_file' },
      requiresApproval: true,
      execute: vi.fn(async () => 'deleted'),
    });
    await vi.waitFor(() => expect(repository.get(waiting.id)?.status).toBe('waiting_approval'));

    expect(coordinator.cancelParent('run-parent', 500)).toBe(3);
    await expect(approvalResult).resolves.toEqual(expect.objectContaining({ name: 'cancelled' }));
    expect([running, waiting, queued].map((run) => repository.get(run.id)?.status))
      .toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect(coordinator.listToolApprovalHistory(waiting.id)).toEqual([
      expect.objectContaining({ approval_status: 'invalidated', execution_status: 'rejected' }),
    ]);
    expect(repository.createToolActionRepository().listForConversation('session-1')).toEqual([
      expect.objectContaining({ delegated_run_id: waiting.id, approval_status: 'invalidated' }),
    ]);
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

  it('keeps the configuration captured when a streamed task was queued', async () => {
    const db = createDatabase();
    databases.push(db);
    const repository = new DelegatedAgentRunRepository(db);
    const adapter: DelegatedRuntimeAdapter = { run: vi.fn(async () => success) };
    const coordinator = new DelegatedAgentRunCoordinator(repository, adapter, {
      createId: () => 'captured-before-run', now: () => 100,
    });
    const original = configurationSnapshot('prompt at queue time');
    const queued = coordinator.queueSingle({ ...request, configurationSnapshot: original });

    await coordinator.runSingle({
      ...request,
      delegatedRunId: queued.id,
      input: { messages: [] },
      configurationSnapshot: configurationSnapshot('edited after queue'),
      resolveConfigurationSnapshot: () => configurationSnapshot('resolved after queue'),
    });

    expect(adapter.run).toHaveBeenCalledWith(expect.objectContaining({
      configurationSnapshot: original,
    }));
  });

  it('keeps a running Delegated Agent Run on its captured configuration after target deletion', async () => {
    const db = createDatabase();
    databases.push(db);
    const repository = new DelegatedAgentRunRepository(db);
    let finish!: (outcome: DelegatedTaskResult) => void;
    const adapter: DelegatedRuntimeAdapter = {
      run: vi.fn((runtimeRequest) => new Promise<DelegatedTaskResult>((resolve) => {
        expect(runtimeRequest.configurationSnapshot?.target.system_prompt).toBe('prompt before start');
        finish = resolve;
      })),
    };
    const coordinator = new DelegatedAgentRunCoordinator(repository, adapter, {
      createId: () => 'running-snapshot', now: () => 100,
    });

    const execution = coordinator.runSingle({
      ...request,
      input: { messages: [] },
      configurationSnapshot: configurationSnapshot('prompt before start'),
    });
    await vi.waitFor(() => expect(repository.get('running-snapshot')?.status).toBe('running'));
    db.prepare("DELETE FROM agents WHERE id = 'agent-child'").run();
    finish(success);

    await expect(execution).resolves.toEqual(success);
    expect(repository.get('running-snapshot')).toMatchObject({
      target_agent_id: null,
      target_agent_name: 'Child Agent',
      status: 'completed',
    });
  });

  it('resumes a waiting-for-approval run after its target is deleted', async () => {
    const db = createDatabase();
    databases.push(db);
    const repository = new DelegatedAgentRunRepository(db);
    let coordinator!: DelegatedAgentRunCoordinator;
    const adapter: DelegatedRuntimeAdapter = {
      run: vi.fn(async (runtimeRequest) => {
        await coordinator.runToolAction({
          delegatedRunId: runtimeRequest.delegatedRunId,
          action: { id: 'write-after-delete', name: 'write_file', args: {} },
          requiresApproval: true,
          execute: async () => 'written',
        });
        return success;
      }),
    };
    coordinator = new DelegatedAgentRunCoordinator(repository, adapter, {
      createId: (() => { let id = 0; return () => `waiting-${++id}`; })(),
      now: () => 100,
    });
    let approvalId = '';
    coordinator.subscribeToolApprovals((approval) => { approvalId = approval.id; });

    const execution = coordinator.runSingle({
      ...request,
      input: { messages: [] },
      configurationSnapshot: configurationSnapshot('prompt before approval'),
    });
    await vi.waitFor(() => expect(approvalId).not.toBe(''));
    expect(repository.get('waiting-1')?.status).toBe('waiting_approval');
    db.prepare("DELETE FROM agents WHERE id = 'agent-child'").run();
    await coordinator.resolveToolApproval(approvalId, 'approve');

    await expect(execution).resolves.toEqual(success);
    expect(repository.get('waiting-1')).toMatchObject({ target_agent_id: null, status: 'completed' });
  });

  it('keeps delegated run history when its Custom target is deleted', () => {
    const db = createDatabase();
    databases.push(db);
    const repository = new DelegatedAgentRunRepository(db);
    const coordinator = new DelegatedAgentRunCoordinator(repository, { run: vi.fn(async () => success) }, {
      createId: () => 'deleted-target-history', now: () => 100,
    });
    const run = coordinator.queueSingle(request);

    db.prepare("DELETE FROM agents WHERE id = 'agent-child'").run();

    expect(repository.get(run.id)).toMatchObject({
      target_agent_id: null,
      target_agent_slug: 'child',
      target_agent_name: 'Child Agent',
      status: 'queued',
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
    expect(coordinator.reconcileInterrupted(600)).toBe(0);
  });
});
