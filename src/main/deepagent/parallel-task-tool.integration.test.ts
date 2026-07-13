import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DelegatedTaskResult } from '../../shared/types';

const { testDb, sendMock } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  return {
    testDb: new Database(':memory:'),
    sendMock: vi.fn(),
  };
});

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{
      isDestroyed: () => false,
      webContents: { send: sendMock },
    }]),
  },
}));

vi.mock('../database', () => ({ default: testDb }));
vi.mock('../workflow-run/db', () => ({
  getRunBySessionId: vi.fn(() => undefined),
  getCurrentStage: vi.fn(() => null),
  createTask: vi.fn(),
  setTaskDelegation: vi.fn(),
  updateTaskStatus: vi.fn(),
  getTask: vi.fn(),
}));
vi.mock('../workflow-run/notify', () => ({ pushProjectionEvent: vi.fn() }));

import {
  DelegatedAgentRunRepository,
  initializeDelegatedAgentRunSchema,
} from './delegated-agent-run-repository';
import {
  DelegatedAgentRunCoordinator,
  type DelegatedRuntimeAdapter,
} from './delegated-agent-run-coordinator';
import { createParallelTaskTool } from './parallel-task-tool';

const success: DelegatedTaskResult = {
  status: 'success',
  artifacts: [],
  summary: 'done',
};

describe('parallel_tasks + Delegated Run Coordinator integration', () => {
  beforeEach(() => {
    sendMock.mockClear();
    testDb.exec(`
      DROP TABLE IF EXISTS delegated_agent_runs;
      DROP TABLE IF EXISTS agent_runs;
      DROP TABLE IF EXISTS agents;
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        slug TEXT,
        description TEXT
      );
      CREATE TABLE agent_runs (id TEXT PRIMARY KEY);
    `);
    testDb.prepare(`INSERT INTO agents (id, project_id, name, slug, description)
      VALUES ('agent-1', 'project-1', 'Worker Agent', 'worker', 'Does work')`).run();
    testDb.prepare("INSERT INTO agent_runs (id) VALUES ('run-parent')").run();
    initializeDelegatedAgentRunSchema(testDb);
  });

  it('queues, promotes, isolates failure, and aggregates through the coordinator seam', async () => {
    const resolvers = new Map<string, (outcome: DelegatedTaskResult) => void>();
    const starts: string[] = [];
    const adapter: DelegatedRuntimeAdapter = {
      run: vi.fn((request) => new Promise<DelegatedTaskResult>((resolve) => {
        starts.push(request.delegatedRunId);
        request.onStep?.({ type: 'thinking', ts: 1, content: request.goal });
        resolvers.set(request.delegatedRunId, resolve);
      })),
    };
    const repository = new DelegatedAgentRunRepository(testDb);
    let nextId = 0;
    const coordinator = new DelegatedAgentRunCoordinator(repository, adapter, {
      createId: () => `delegated-${++nextId}`,
      now: () => 100 + nextId,
    });
    const parallelTool = createParallelTaskTool('project-1', 'session-1', {
      coordinator,
      createBatchId: () => 'batch-integration',
    });

    const invocation = parallelTool.invoke({
      tasks: Array.from({ length: 6 }, (_, index) => ({
        name: 'worker',
        description: `task ${index + 1}`,
      })),
    }, { configurable: { parentAgentRunId: 'run-parent' } });

    await vi.waitFor(() => expect(starts).toHaveLength(4));
    expect(starts).toEqual(['delegated-1', 'delegated-2', 'delegated-3', 'delegated-4']);
    expect(repository.listByBatch('run-parent', 'batch-integration').map((run) => run.status))
      .toEqual(['running', 'running', 'running', 'running', 'queued', 'queued']);

    resolvers.get('delegated-1')?.({
      status: 'failure',
      artifacts: [],
      summary: '',
      error: { code: 'TOOL_FAILED', message: 'isolated failure' },
    });
    await vi.waitFor(() => expect(starts).toContain('delegated-5'));
    resolvers.get('delegated-2')?.(success);
    await vi.waitFor(() => expect(starts).toContain('delegated-6'));
    for (const id of ['delegated-3', 'delegated-4', 'delegated-5', 'delegated-6']) {
      resolvers.get(id)?.(success);
    }

    const aggregate = JSON.parse(String(await invocation));
    expect(aggregate.results).toHaveLength(6);
    expect(aggregate.results[0]).toMatchObject({
      delegatedRunId: 'delegated-1',
      status: 'failure',
      error: 'isolated failure',
      outcome: {
        status: 'failure',
        artifacts: [],
        summary: '',
        error: { code: 'TOOL_FAILED', message: 'isolated failure' },
      },
    });
    expect(aggregate.results.slice(1).every((result: { status: string }) => result.status === 'success'))
      .toBe(true);
    expect(new Set(aggregate.results.map((result: { delegatedRunId: string }) => result.delegatedRunId)).size)
      .toBe(6);
    expect(sendMock).toHaveBeenCalledWith(
      expect.stringContaining('agent:parallel-task-step-'),
      expect.objectContaining({ delegatedRunId: 'delegated-1', workerId: 'delegated-1' }),
    );
  });
});
