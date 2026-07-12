import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StageEditor } from './StageEditor';
import { useAgentStore } from '../../stores/agentStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { Agent, Workflow, WorkflowStage } from '../../../../shared/types';

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
        'workflow.editor.stageEditorHelp': 'Help text',
        'workflow.editor.noStages': 'No stages yet',
        'workflow.editor.selectMasterAgent': 'Master Agent',
        'workflow.editor.selectMasterAgentPlaceholder': 'Select agent',
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
    master_agent_id: '',
    status: 'draft',
    created_at: 1000,
    updated_at: 1000,
  };
}

function createAgent(id: string, name: string, isDefault: number): Agent {
  return {
    id,
    project_id: 'proj-1',
    name,
    is_default: isDefault,
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
  useAgentStore.setState({
    agents: [],
    isLoading: false,
    error: null,
    fetchAgents: vi.fn().mockResolvedValue(undefined),
  });
});

describe('StageEditor component', () => {
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
      { id: 's1', name: 'First', taskDescription: '', acceptanceCriteria: '', gateEnabled: true },
      { id: 's2', name: 'Second', taskDescription: '', acceptanceCriteria: '', gateEnabled: true },
      { id: 's3', name: 'Third', taskDescription: '', acceptanceCriteria: '', gateEnabled: true },
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
  it('defaults to the project default Agent and allows selecting another Agent', async () => {
    const defaultAgent = createAgent('agent-default', 'Default Agent', 1);
    const reviewer = createAgent('agent-reviewer', 'Reviewer', 0);
    useAgentStore.setState({ agents: [defaultAgent, reviewer] });
    const saveWorkflowSpy = vi.spyOn(useWorkflowStore.getState(), 'saveWorkflow')
      .mockResolvedValue(createWorkflow());

    render(<StageEditor workflow={createWorkflow()} onBack={vi.fn()} />);

    // 默认展示 Default Agent
    expect(screen.getByText('Default Agent')).toBeTruthy();

    // 点击下拉框触发展开
    const triggerBtn = screen.getByRole('button', { name: 'Master Agent' });
    fireEvent.click(triggerBtn);

    // 此时展开了浮层，点击选项 "Reviewer"
    const option = screen.getByText('Reviewer');
    fireEvent.click(option);

    // 点击 Save 保存
    fireEvent.click(screen.getByText('Save'));

    expect(saveWorkflowSpy).toHaveBeenCalledWith(
      expect.objectContaining({ master_agent_id: 'agent-reviewer' }),
    );
  });

  it('reuses the generated workflow id when a new Workflow Skeleton is saved twice', async () => {
    const draft = { ...createWorkflow(), id: '' };
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
