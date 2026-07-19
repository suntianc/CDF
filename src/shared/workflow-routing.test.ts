import { describe, expect, it } from 'vitest';
import type { WorkflowStage } from './workflows';
import { normalizeWorkflowStages, selectWorkflowStageRoute, validateWorkflowStages } from './workflow-routing';

const stage = (id: string, extra: Partial<WorkflowStage> = {}): WorkflowStage => ({
  id,
  name: id,
  taskDescription: '',
  acceptanceCriteria: '',
  gateEnabled: false,
  ...extra,
});

describe('Workflow Stage routing', () => {
  it('upgrades legacy ordered stages to one explicit route and one explicit terminal', () => {
    const stages = normalizeWorkflowStages([stage('a'), stage('b')]);
    expect(stages[0]).toMatchObject({ terminal: false, routes: [{ targetStageId: 'b', condition: '' }] });
    expect(stages[1]).toMatchObject({ terminal: true, routes: [] });
    expect(validateWorkflowStages(stages)).toEqual([]);
  });

  it('rejects missing targets, self routes, terminal routes, and missing alternative conditions', () => {
    expect(validateWorkflowStages([
      stage('a', {
        terminal: false,
        routes: [
          { id: 'r1', targetStageId: 'a', condition: '' },
          { id: 'r2', targetStageId: '', condition: '' },
        ],
      }),
      stage('b', { terminal: true, routes: [{ id: 'r3', targetStageId: 'a', condition: 'fallback' }] }),
    ])).toEqual(expect.arrayContaining([
      expect.stringContaining('self-route'),
      expect.stringContaining('target is required'),
      expect.stringContaining('terminal stage'),
      expect.stringContaining('requires a condition'),
    ]));
  });

  it('selects only a route authored by the current stage', () => {
    const source = stage('a', {
      terminal: false,
      routes: [{ id: 'to-b', targetStageId: 'b', condition: 'approved' }],
    });
    expect(selectWorkflowStageRoute(source)?.id).toBe('to-b');
    expect(() => selectWorkflowStageRoute(source, 'foreign-route')).toThrow('Unknown route');
  });

  it('rejects cycles and unreachable Stages while allowing branch convergence', () => {
    const converging = [
      stage('entry', { terminal: false, routes: [
        { id: 'left', targetStageId: 'left', condition: 'left' },
        { id: 'right', targetStageId: 'right', condition: 'right' },
      ] }),
      stage('left', { terminal: false, routes: [{ id: 'left-end', targetStageId: 'end', condition: '' }] }),
      stage('right', { terminal: false, routes: [{ id: 'right-end', targetStageId: 'end', condition: '' }] }),
      stage('end', { terminal: true, routes: [] }),
    ];
    expect(validateWorkflowStages(converging)).toEqual([]);

    const invalid = [
      stage('entry', { terminal: false, routes: [{ id: 'to-loop', targetStageId: 'loop', condition: '' }] }),
      stage('loop', { terminal: false, routes: [{ id: 'back', targetStageId: 'entry', condition: '' }] }),
      stage('orphan', { terminal: true, routes: [] }),
    ];
    expect(validateWorkflowStages(invalid)).toEqual(expect.arrayContaining([
      expect.stringContaining('only entry'),
      expect.stringContaining('cycle'),
      expect.stringContaining('unreachable'),
    ]));
  });

  it('rejects empty and duplicate Stage identities before graph traversal', () => {
    expect(validateWorkflowStages([
      stage('entry', { terminal: false, routes: [{ id: 'to-end', targetStageId: 'end', condition: '' }] }),
      stage('end', { name: 'First end', terminal: true, routes: [] }),
      stage('end', { name: 'Duplicate end', terminal: true, routes: [] }),
    ])).toEqual(expect.arrayContaining([expect.stringContaining('duplicate Stage id end')]));

    expect(validateWorkflowStages([
      stage('', { name: 'Missing identity', terminal: true, routes: [] }),
    ])).toEqual(expect.arrayContaining([expect.stringContaining('stable id')]));
  });
});
