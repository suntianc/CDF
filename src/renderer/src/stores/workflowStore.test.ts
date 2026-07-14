import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowStage } from '../../../shared/types';
import { useWorkflowStore } from './workflowStore';

// Mock window.electronAPI
const mockDb = {
  getWorkflows: vi.fn(),
  getWorkflow: vi.fn(),
  saveWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as Record<string, unknown>).electronAPI = { db: mockDb };
  useWorkflowStore.setState({ workflows: [], currentWorkflow: null });
});

function sampleStage(overrides: Partial<WorkflowStage> = {}): WorkflowStage {
  return {
    id: 'stage-1',
    name: 'Research',
    taskDescription: 'Gather requirements',
    acceptanceCriteria: 'All requirements documented',
    gateEnabled: true,
    ...overrides,
  };
}

describe('workflowStore C-lite stages CRUD', () => {
  it('adds a stage to current workflow', () => {
    const store = useWorkflowStore.getState();
    // Test the runtime guard — cast needed because required `stages` may still be
    // missing in untyped API response data
    store.setCurrentWorkflow({
      id: 'wf-1',
      project_id: 'proj-1',
      name: 'Test workflow',
      description: '',
      stages: [],
      status: 'draft' as const,
      created_at: 1000,
      updated_at: 1000,
    });

    store.addStage();
    const stages = useWorkflowStore.getState().currentWorkflow?.stages;
    expect(stages).toHaveLength(1);
    expect(stages![0]).toHaveProperty('id');
    expect(stages![0].name).toBe('');
  });

  it('removes a stage by id', () => {
    const stageA = sampleStage({ id: 'st-a' });
    const stageB = sampleStage({ id: 'st-b' });
    useWorkflowStore.setState({
      currentWorkflow: {
        id: 'wf-1',
        project_id: 'proj-1',
        name: 'Test',
        stages: [stageA, stageB],
        status: 'draft' as const,
        created_at: 1000,
        updated_at: 1000,
      },
    });

    useWorkflowStore.getState().removeStage('st-a');
    const stages = useWorkflowStore.getState().currentWorkflow?.stages;
    expect(stages).toHaveLength(1);
    expect(stages![0].id).toBe('st-b');
  });

  it('updates a stage field', () => {
    const sample = sampleStage({ id: 'st-1' });
    useWorkflowStore.setState({
      currentWorkflow: {
        id: 'wf-1',
        project_id: 'proj-1',
        name: 'Test',
        stages: [sample],
        status: 'draft' as const,
        created_at: 1000,
        updated_at: 1000,
      },
    });

    useWorkflowStore.getState().updateStage('st-1', { name: 'Updated' });
    const workflow = useWorkflowStore.getState().currentWorkflow;
    const result = workflow?.stages![0];
    expect(result?.name).toBe('Updated');
    expect(result?.gateEnabled).toBe(true); // unchanged
  });

  it('initialises stages as empty array on setCurrentWorkflow if stages is undefined', () => {
    // Workflow type requires `stages`, but runtime data from API may lack it.
    // The store guards against this by initialising to [].
    const input = {
      id: 'wf-1',
      project_id: 'proj-1',
      name: 'No stages',
      description: '',
      status: 'draft' as const,
      created_at: 1000,
      updated_at: 1000,
    } as unknown as Workflow;

    useWorkflowStore.getState().setCurrentWorkflow(input);
    expect(useWorkflowStore.getState().currentWorkflow?.stages).toEqual([]);
  });
});

describe('workflowStore C-lite stage reordering', () => {
  const s1 = sampleStage({ id: 's1', name: 'First' });
  const s2 = sampleStage({ id: 's2', name: 'Second' });
  const s3 = sampleStage({ id: 's3', name: 'Third' });

  it('moves a stage up', () => {
    useWorkflowStore.setState({
      currentWorkflow: {
        id: 'wf-1',
        project_id: 'proj-1',
        name: 'Reorder',
        stages: [s1, s2, s3],
        status: 'draft' as const,
        created_at: 1000,
        updated_at: 1000,
      },
    });

    useWorkflowStore.getState().moveStageUp('s2');
    const stages = useWorkflowStore.getState().currentWorkflow!.stages;
    expect(stages.map((s) => s.id)).toEqual(['s2', 's1', 's3']);
  });

  it('does not move the first stage up', () => {
    useWorkflowStore.setState({
      currentWorkflow: {
        id: 'wf-1',
        project_id: 'proj-1',
        name: 'Reorder',
        stages: [s1, s2],
        status: 'draft' as const,
        created_at: 1000,
        updated_at: 1000,
      },
    });

    useWorkflowStore.getState().moveStageUp('s1');
    const stages = useWorkflowStore.getState().currentWorkflow!.stages;
    expect(stages.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('moves a stage down', () => {
    useWorkflowStore.setState({
      currentWorkflow: {
        id: 'wf-1',
        project_id: 'proj-1',
        name: 'Reorder',
        stages: [s1, s2, s3],
        status: 'draft' as const,
        created_at: 1000,
        updated_at: 1000,
      },
    });

    useWorkflowStore.getState().moveStageDown('s2');
    const stages = useWorkflowStore.getState().currentWorkflow!.stages;
    expect(stages.map((s) => s.id)).toEqual(['s1', 's3', 's2']);
  });

  it('does not move the last stage down', () => {
    useWorkflowStore.setState({
      currentWorkflow: {
        id: 'wf-1',
        project_id: 'proj-1',
        name: 'Reorder',
        stages: [s1, s2],
        status: 'draft' as const,
        created_at: 1000,
        updated_at: 1000,
      },
    });

    useWorkflowStore.getState().moveStageDown('s2');
    const stages = useWorkflowStore.getState().currentWorkflow!.stages;
    expect(stages.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('reorders stages by drag (explicit order)', () => {
    useWorkflowStore.setState({
      currentWorkflow: {
        id: 'wf-1',
        project_id: 'proj-1',
        name: 'Reorder',
        stages: [s1, s2, s3],
        status: 'draft' as const,
        created_at: 1000,
        updated_at: 1000,
      },
    });

    useWorkflowStore.getState().reorderStages(2, 0);
    const stages = useWorkflowStore.getState().currentWorkflow!.stages;
    expect(stages.map((s) => s.id)).toEqual(['s3', 's1', 's2']);
  });
});

describe('workflowStore C-lite save/load with stages', () => {
  const stages = [sampleStage({ id: 'st-1', name: 'Design' })];

  beforeEach(() => {
    mockDb.saveWorkflow.mockResolvedValue(undefined);
    mockDb.getWorkflows.mockResolvedValue([
      {
        id: 'wf-1',
        project_id: 'proj-1',
        name: 'Test',
        description: '',
        stages,
        status: 'draft' as const,
        created_at: 1000,
        updated_at: 1000,
      },
    ]);
  });

  it('saveWorkflow sends stages to backend', async () => {
    await useWorkflowStore.getState().saveWorkflow({
      id: 'wf-1',
      project_id: 'proj-1',
      name: 'Saved workflow',
      description: '',
      stages,
      status: 'draft' as const,
    });

    expect(mockDb.saveWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ stages, project_id: 'proj-1' }),
    );
  });

  it('loads workflow with stages via fetchWorkflows', async () => {
    await useWorkflowStore.getState().fetchWorkflows('proj-1');
    const workflows = useWorkflowStore.getState().workflows;
    expect(workflows).toHaveLength(1);
    expect(workflows[0].stages).toHaveLength(1);
    expect(workflows[0].stages![0].name).toBe('Design');
    expect(workflows[0]).not.toHaveProperty('master_agent_id');
  });

  it('loads a single workflow with stages via fetchWorkflow', async () => {
    mockDb.getWorkflow.mockResolvedValue({
      id: 'wf-single',
      project_id: 'proj-1',
      name: 'Single',
      description: '',
      stages: [sampleStage({ id: 'st-2', name: 'Analyze' })],
      status: 'draft' as const,
      created_at: 1000,
      updated_at: 1000,
    });

    await useWorkflowStore.getState().fetchWorkflow('wf-single');
    const wf = useWorkflowStore.getState().currentWorkflow;
    expect(wf?.stages).toHaveLength(1);
    expect(wf?.stages![0].name).toBe('Analyze');
    expect(wf).not.toHaveProperty('master_agent_id');
  });

  it('handles empty stages on load gracefully', async () => {
    mockDb.getWorkflows.mockResolvedValue([
      {
        id: 'wf-empty',
        project_id: 'proj-1',
        name: 'Empty stages',
        description: '',
        stages: [],
        status: 'draft' as const,
        created_at: 1000,
        updated_at: 1000,
      },
    ]);

    await useWorkflowStore.getState().fetchWorkflows('proj-1');
    const wf = useWorkflowStore.getState().workflows[0];
    expect(wf.stages).toEqual([]);
  });
});
