import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: { prepare: vi.fn() },
}));

vi.mock('../../database', () => ({
  default: dbMock,
}));

import { collectWorkflowCommands } from './workflow';

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
}

function setupWorkflowQuery(rows: WorkflowRow[]): void {
  const allFn = vi.fn(() => rows);
  dbMock.prepare.mockReturnValueOnce({ all: allFn });
}

describe('collectors/workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns only active workflows with valid name regex (D-10)', async () => {
    setupWorkflowQuery([
      { id: 'w1', name: 'pr-review', description: 'PR review flow' },
      { id: 'w2', name: 'Invalid_Name!', description: 'should skip' },
      { id: 'w3', name: 'data-pipeline', description: 'pipeline' },
    ]);
    const result = await collectWorkflowCommands('/tmp/proj');
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.name).sort()).toEqual(['data-pipeline', 'pr-review']);
  });

  it('returns [] when no project matches projectPath (P6.1 — no throw)', async () => {
    setupWorkflowQuery([]);
    const result = await collectWorkflowCommands('/no/such/path');
    expect(result).toEqual([]);
  });

  it('uses lightweight SQL selecting id/name/description (D-11 — no graph_data)', async () => {
    const prepareSpy = vi.fn(() => ({ all: vi.fn(() => []) }));
    dbMock.prepare.mockImplementation(prepareSpy);
    await collectWorkflowCommands('/tmp/proj');
    const sql = (prepareSpy.mock.calls[0] as unknown as [string])[0];
    expect(sql).toContain('SELECT id, name, description FROM workflows');
    expect(sql).not.toContain('graph_data');
    expect(sql).toContain('status = ?');
    expect(sql).toContain('project_id = (SELECT id FROM projects WHERE path = ?)');
  });

  it('maps each row to source=workflow with badge [workflow] and target=row.id', async () => {
    setupWorkflowQuery([{ id: 'wf-uuid-1', name: 'simplify', description: 'simplify pr' }]);
    const result = await collectWorkflowCommands('/tmp/proj');
    expect(result[0]).toEqual({
      name: 'simplify',
      description: 'simplify pr',
      source: 'workflow',
      target: 'wf-uuid-1',
      sourceLabel: 'workflow',
      badge: '[workflow]',
    });
  });

  it('falls back to empty description for NULL description column', async () => {
    setupWorkflowQuery([{ id: 'w1', name: 'no-desc', description: null }]);
    const result = await collectWorkflowCommands('/tmp/proj');
    expect(result[0].description).toBe('');
  });

  it('returns [] when SQL throws (P6.1 — failure isolation)', async () => {
    dbMock.prepare.mockImplementationOnce(() => {
      throw new Error('database is locked');
    });
    const result = await collectWorkflowCommands('/tmp/proj');
    expect(result).toEqual([]);
  });
});
