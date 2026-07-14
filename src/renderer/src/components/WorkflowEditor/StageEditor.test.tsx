import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StageEditor } from './StageEditor';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { Workflow, WorkflowStage } from '../../../../shared/types';

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const mockT: Record<string, string> = {
        'workflow.editor.back': 'Back',
        'workflow.editor.save': 'Save',
        'workflow.editor.saveSuccess': 'Saved',
        'workflow.editor.saveFailed': 'Save failed',
        'workflow.editor.nameEmpty': 'Name empty',
        'workflow.editor.workflowName': 'Workflow name',
        'workflow.editor.stageNamePlaceholder': 'e.g. Research',
        'workflow.editor.taskDescriptionPlaceholder': 'Describe task',
        'workflow.editor.acceptanceCriteriaPlaceholder': 'Acceptance criteria',
        'workflow.editor.gateEnabled': 'Enable gate',
        'workflow.editor.addStage': 'Add Stage',
        'workflow.editor.addStageHint': 'Add a stage',
        'workflow.editor.deleteStage': 'Delete',
        'workflow.editor.moveUp': 'Move up',
        'workflow.editor.moveDown': 'Move down',
        'workflow.editor.stageCount': `${params?.count ?? 0} stages`,
        'workflow.editor.noStages': 'No stages yet',
        'workflow.list.nodeCount': `${params?.count ?? 0} nodes`,
      };
      return mockT[key] || key;
    },
  }),
}));

function createWorkflow(stages?: WorkflowStage[]): Workflow {
  return {
    id: 'wf-1',
    project_id: 'proj-1',
    name: 'Test WF',
    stages: stages ?? [],
    status: 'draft',
    created_at: 1000,
    updated_at: 1000,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset store state
  useWorkflowStore.setState({
    workflows: [],
    currentWorkflow: null,
    isLoading: false,
    error: null,
  });
});

describe('StageEditor component', () => {
  it('authors explicit next Stage routes and terminal completion in the Stage list', () => {
    const stages: WorkflowStage[] = [
      {
        id: 's1', name: 'Start', taskDescription: '', acceptanceCriteria: '', gateEnabled: true, terminal: false,
        routes: [{ id: 'route-1', targetStageId: 's2', condition: '' }],
      },
      { id: 's2', name: 'Done', taskDescription: '', acceptanceCriteria: '', gateEnabled: false, terminal: true, routes: [] },
    ];
    const workflow = createWorkflow(stages);
    useWorkflowStore.getState().setCurrentWorkflow(workflow);
    render(<StageEditor workflow={workflow} onBack={vi.fn()} />);

    expect(screen.getAllByText('workflow.editor.nextStep')).toHaveLength(2);
    expect(screen.getByDisplayValue('→ Done')).toBeTruthy();
    fireEvent.click(screen.getByText('workflow.editor.addRoute'));
    expect(useWorkflowStore.getState().currentWorkflow?.stages[0].routes).toHaveLength(2);

    const terminalToggles = screen.getAllByLabelText('workflow.editor.completeRun');
    fireEvent.click(terminalToggles[0]);
    expect(useWorkflowStore.getState().currentWorkflow?.stages[0]).toMatchObject({ terminal: true, routes: [] });
  });

  it('shows Stage-specific validation and does not save an invalid cyclic Skeleton', () => {
    const stages: WorkflowStage[] = [
      {
        id: 'entry', name: 'Entry', taskDescription: '', acceptanceCriteria: '', gateEnabled: true, terminal: false,
        routes: [{ id: 'to-loop', targetStageId: 'loop', condition: '' }],
      },
      {
        id: 'loop', name: 'Loop', taskDescription: '', acceptanceCriteria: '', gateEnabled: true, terminal: false,
        routes: [{ id: 'to-entry', targetStageId: 'entry', condition: '' }],
      },
    ];
    const workflow = createWorkflow(stages);
    useWorkflowStore.getState().setCurrentWorkflow(workflow);
    const saveWorkflowSpy = vi.spyOn(useWorkflowStore.getState(), 'saveWorkflow');
    render(<StageEditor workflow={workflow} onBack={vi.fn()} />);

    fireEvent.click(screen.getByText('Save'));

    expect(saveWorkflowSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/Loop:.*entry|route cycle|terminal Stage/s)).toBeTruthy();
  });

  it('renders empty state when no stages', () => {
    const onBack = vi.fn();
    render(<StageEditor workflow={createWorkflow([])} onBack={onBack} />);
    expect(screen.getByText('0 stages')).toBeTruthy();
    expect(screen.getByText('No stages yet')).toBeTruthy();
  });

  it('adds a stage on button click', () => {
    const onBack = vi.fn();
    render(<StageEditor workflow={createWorkflow([])} onBack={onBack} />);

    // Set currentWorkflow so addStage works
    useWorkflowStore.getState().setCurrentWorkflow(createWorkflow([]));

    const addBtn = screen.getByText('Add Stage');
    fireEvent.click(addBtn);

    const stages = useWorkflowStore.getState().currentWorkflow?.stages;
    expect(stages).toHaveLength(1);
  });

  it('renders existing stages', () => {
    const stages: WorkflowStage[] = [
      { id: 's1', name: 'Research', taskDescription: 'Do research', acceptanceCriteria: 'Research done', gateEnabled: true },
      { id: 's2', name: 'Draft', taskDescription: 'Write draft', acceptanceCriteria: 'Draft written', gateEnabled: false },
    ];
    useWorkflowStore.getState().setCurrentWorkflow(createWorkflow(stages));
    const onBack = vi.fn();
    render(<StageEditor workflow={createWorkflow(stages)} onBack={onBack} />);

    expect(screen.getByDisplayValue('Research')).toBeTruthy();
    expect(screen.getByDisplayValue('Draft')).toBeTruthy();
    expect(screen.getByDisplayValue('Do research')).toBeTruthy();
    expect(screen.getByDisplayValue('Write draft')).toBeTruthy();
  });

  it('removes a stage', () => {
    const stages: WorkflowStage[] = [
      { id: 's1', name: 'Stage A', taskDescription: '', acceptanceCriteria: '', gateEnabled: true },
      { id: 's2', name: 'Stage B', taskDescription: '', acceptanceCriteria: '', gateEnabled: true },
    ];
    useWorkflowStore.getState().setCurrentWorkflow(createWorkflow(stages));
    const onBack = vi.fn();
    render(<StageEditor workflow={createWorkflow(stages)} onBack={onBack} />);

    const deleteButtons = screen.getAllByTitle('Delete');
    fireEvent.click(deleteButtons[0]);

    const remaining = useWorkflowStore.getState().currentWorkflow?.stages;
    expect(remaining).toHaveLength(1);
    expect(remaining![0].id).toBe('s2');
  });

  it('moves a stage up and down', () => {
    const stages: WorkflowStage[] = [
      { id: 's1', name: 'First', taskDescription: '', acceptanceCriteria: '', gateEnabled: true, terminal: false, routes: [{ id: 'first-third', targetStageId: 's3', condition: '' }] },
      { id: 's2', name: 'Second', taskDescription: '', acceptanceCriteria: '', gateEnabled: true, terminal: false, routes: [{ id: 'second-third', targetStageId: 's3', condition: '' }] },
      { id: 's3', name: 'Third', taskDescription: '', acceptanceCriteria: '', gateEnabled: true, terminal: true, routes: [] },
    ];
    useWorkflowStore.getState().setCurrentWorkflow(createWorkflow(stages));
    const onBack = vi.fn();
    render(<StageEditor workflow={createWorkflow(stages)} onBack={onBack} />);

    // Move "Second" up
    const moveUpButtons = screen.getAllByTitle('Move up');
    fireEvent.click(moveUpButtons[1]); // index 1 = Second's up button

    const result1 = useWorkflowStore.getState().currentWorkflow?.stages!;
    expect(result1.map(s => s.name)).toEqual(['Second', 'First', 'Third']);

    // Move "First" (now index 1) down
    const moveDownButtons = screen.getAllByTitle('Move down');
    fireEvent.click(moveDownButtons[1]); // index 1 = First's down button

    const result2 = useWorkflowStore.getState().currentWorkflow?.stages!;
    expect(result2.map(s => s.name)).toEqual(['Second', 'Third', 'First']);
    expect(result2.find((stage) => stage.id === 's1')?.routes?.[0].targetStageId).toBe('s3');
    expect(result2.find((stage) => stage.id === 's2')?.routes?.[0].targetStageId).toBe('s3');
  });

  it('disables move up for first stage and move down for last stage', () => {
    const stages: WorkflowStage[] = [
      { id: 's1', name: 'Alone', taskDescription: '', acceptanceCriteria: '', gateEnabled: true },
    ];
    useWorkflowStore.getState().setCurrentWorkflow(createWorkflow(stages));
    const onBack = vi.fn();
    render(<StageEditor workflow={createWorkflow(stages)} onBack={onBack} />);

    const moveUpButtons = screen.getAllByTitle('Move up');
    const moveDownButtons = screen.getAllByTitle('Move down');

    // Both disabled for a single item
    expect((moveUpButtons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((moveDownButtons[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves workflow with stages', async () => {
    const saveWorkflowSpy = vi.spyOn(useWorkflowStore.getState(), 'saveWorkflow')
      .mockResolvedValue({} as Workflow);

    const stages: WorkflowStage[] = [
      { id: 's1', name: 'A', taskDescription: 'Desc', acceptanceCriteria: 'Criteria', gateEnabled: true },
    ];
    useWorkflowStore.getState().setCurrentWorkflow(createWorkflow(stages));
    const onBack = vi.fn();

    render(<StageEditor workflow={createWorkflow(stages)} onBack={onBack} />);

    const saveBtn = screen.getByText('Save');
    fireEvent.click(saveBtn);

    expect(saveWorkflowSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        stages: expect.arrayContaining([
          expect.objectContaining({ name: 'A', taskDescription: 'Desc' }),
        ]),
      }),
    );
  });

  it('edits stage fields', () => {
    const stages: WorkflowStage[] = [
      { id: 's1', name: 'Old name', taskDescription: '', acceptanceCriteria: '', gateEnabled: true },
    ];
    useWorkflowStore.getState().setCurrentWorkflow(createWorkflow(stages));
    const onBack = vi.fn();
    render(<StageEditor workflow={createWorkflow(stages)} onBack={onBack} />);

    const nameInput = screen.getByDisplayValue('Old name');
    fireEvent.change(nameInput, { target: { value: 'New name' } });

    const updated = useWorkflowStore.getState().currentWorkflow?.stages![0];
    expect(updated?.name).toBe('New name');
  });
  it('does not expose a root Agent selector or save caller-controlled root configuration', async () => {
    const saveWorkflowSpy = vi.spyOn(useWorkflowStore.getState(), 'saveWorkflow')
      .mockResolvedValue(createWorkflow());
    const terminalStage: WorkflowStage = {
      id: 'terminal',
      name: 'Done',
      taskDescription: '',
      acceptanceCriteria: '',
      gateEnabled: false,
      terminal: true,
      routes: [],
    };
    render(<StageEditor workflow={createWorkflow([terminalStage])} onBack={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Master Agent' })).toBeNull();
    fireEvent.click(screen.getByText('Save'));

    expect(saveWorkflowSpy).toHaveBeenCalledOnce();
    expect(saveWorkflowSpy.mock.calls[0][0]).not.toHaveProperty('master_agent_id');
  });

  it('reuses the generated workflow id when a new Workflow Skeleton is saved twice', async () => {
    const terminalStage: WorkflowStage = {
      id: 'terminal',
      name: 'Done',
      taskDescription: '',
      acceptanceCriteria: '',
      gateEnabled: false,
      terminal: true,
      routes: [],
    };
    const draft = { ...createWorkflow([terminalStage]), id: '' };
    const saved = { ...draft, id: 'wf-created' };
    const saveWorkflowSpy = vi.spyOn(useWorkflowStore.getState(), 'saveWorkflow')
      .mockResolvedValue(saved);

    render(<StageEditor workflow={draft} onBack={vi.fn()} />);
    const saveButton = screen.getByText('Save');
    fireEvent.click(saveButton);
    await screen.findByText('Saved');
    fireEvent.click(saveButton);

    expect(saveWorkflowSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: '' }),
    );
    expect(saveWorkflowSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'wf-created' }),
    );
  });

});
