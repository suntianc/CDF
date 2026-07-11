import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import { TaskPanel } from './TaskPanel';

const fetchAgentActivity = vi.fn();
const listCapabilityJobs = vi.fn();
let capabilityJobListener: ((event: {
  projectId: string;
  job: {
    id: string;
    projectId: string;
    type: 'video.generate';
    status: 'queued' | 'running' | 'downloading' | 'completed' | 'failed';
    provider: 'xai-oauth';
    artifacts: Array<{ path: string; mimeType: string }>;
    error: string | null;
    createdAt: number;
    updatedAt: number;
  };
}) => void) | undefined;
let sessionState: Record<string, unknown>;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: (selector?: (state: Record<string, unknown>) => unknown) => (
    selector ? selector(sessionState) : sessionState
  ),
  estimateTokens: (text: string) => Math.ceil(text.length / 4),
}));

vi.mock('../../stores/agentStore', () => ({
  useAgentStore: () => [],
}));
vi.mock('../../stores/projectStore', () => ({
  useProjectStore: (selector: (state: { currentProjectId: string }) => unknown) =>
    selector({ currentProjectId: 'project-1' }),
}));


beforeEach(() => {
  fetchAgentActivity.mockReset();
  fetchAgentActivity.mockResolvedValue(undefined);
  listCapabilityJobs.mockReset();
  listCapabilityJobs.mockResolvedValue([]);
  capabilityJobListener = undefined;
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      capabilityJobs: {
        list: listCapabilityJobs,
        onChanged: (listener: typeof capabilityJobListener) => {
          capabilityJobListener = listener;
          return vi.fn();
        },
      },
    },
  });
  sessionState = {
    activeSessionId: 'session-1',
    activeRunId: null,
    agentRuns: [],
    agentToolCalls: [],
    delegatedTasks: [],
    pendingApproval: null,
    fetchAgentActivity,
    resolveApproval: vi.fn(),
    viewingSubagentId: null,
    setViewingSubagent: vi.fn(),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TaskPanel', () => {
  it('refreshes activity each time the panel is reopened for the same session', async () => {
    const { rerender } = render(
      <TaskPanel isOpen onClose={vi.fn()} />
    );

    await waitFor(() => expect(fetchAgentActivity).toHaveBeenCalledTimes(1));

    rerender(<TaskPanel isOpen={false} onClose={vi.fn()} />);
    rerender(<TaskPanel isOpen onClose={vi.fn()} />);

    await waitFor(() => expect(fetchAgentActivity).toHaveBeenCalledTimes(2));
    expect(fetchAgentActivity).toHaveBeenLastCalledWith('session-1');
  });

  it('retries activity fetch after a failed attempt for the same session', async () => {
    fetchAgentActivity.mockRejectedValueOnce(new Error('temporary db failure'));
    const { rerender } = render(
      <TaskPanel isOpen onClose={vi.fn()} />
    );

    await waitFor(() => expect(fetchAgentActivity).toHaveBeenCalledTimes(1));

    rerender(<TaskPanel isOpen={false} onClose={vi.fn()} />);
    rerender(<TaskPanel isOpen onClose={vi.fn()} />);

    await waitFor(() => expect(fetchAgentActivity).toHaveBeenCalledTimes(2));
    expect(fetchAgentActivity).toHaveBeenLastCalledWith('session-1');
  });

  it('recomputes tool summary when reopened after hidden updates', async () => {
    sessionState = {
      ...sessionState,
      activeRunId: 'run-1',
      agentRuns: [{ id: 'run-1', status: 'running', started_at: Date.now() }],
      agentToolCalls: [{ id: 'tool-1', tool_name: 'read_file', status: 'running' }],
    };

    const { rerender, queryByText } = render(
      <TaskPanel isOpen={false} onClose={vi.fn()} />
    );
    expect(queryByText('taskPanel.toolSummaryTitle')).toBeNull();

    rerender(<TaskPanel isOpen onClose={vi.fn()} />);

    await waitFor(() => expect(queryByText('taskPanel.toolSummaryTitle')).toBeTruthy());
  });

  it('does not keep the running-task timer active while hidden', () => {
    vi.useFakeTimers();
    sessionState = {
      ...sessionState,
      delegatedTasks: [{ taskId: 'task-1', status: 'running', chunks: [] }],
    };

    render(<TaskPanel isOpen={false} onClose={vi.fn()} />);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(vi.getTimerCount()).toBe(0);
  });
  it('shows project background video job state and applies status events', async () => {
    listCapabilityJobs.mockResolvedValue([{
      id: 'job-1',
      projectId: 'project-1',
      type: 'video.generate',
      status: 'queued',
      provider: 'xai-oauth',
      artifacts: [],
      error: null,
      createdAt: 1,
      updatedAt: 1,
    }]);
    const { getByText } = render(<TaskPanel isOpen onClose={vi.fn()} />);

    await waitFor(() => expect(getByText('taskPanel.jobStatus.queued')).toBeTruthy());
    act(() => capabilityJobListener?.({
      projectId: 'project-1',
      job: {
        id: 'job-1',
        projectId: 'project-1',
        type: 'video.generate',
        status: 'completed',
        provider: 'xai-oauth',
        artifacts: [{ path: '/project/video.mp4', mimeType: 'video/mp4' }],
        error: null,
        createdAt: 1,
        updatedAt: 2,
      },
    }));
    expect(getByText('taskPanel.jobStatus.completed')).toBeTruthy();
    expect(getByText('/project/video.mp4')).toBeTruthy();
  });

});

describe('TaskPanel — Activity Trail', () => {
  it('D-05: newest task (higher startedAt) appears before older task in DOM', () => {
    sessionState = {
      ...sessionState,
      delegatedTasks: [
        {
          taskId: 'old-task', agentName: 'OldAgent', agentSlug: 'old-agent',
          status: 'success', startedAt: 1000, completedAt: 2000, chunks: ['done'],
        },
        {
          taskId: 'new-task', agentName: 'NewAgent', agentSlug: 'new-agent',
          status: 'running', startedAt: 5000, chunks: ['work'],
        },
      ],
    };
    const { getByText } = render(
      <TaskPanel isOpen onClose={vi.fn()} />
    );
    const newEl = getByText('NewAgent');
    const oldEl = getByText('OldAgent');
    // DOCUMENT_POSITION_FOLLOWING (4): oldEl follows newEl means newEl is first
    expect(newEl.compareDocumentPosition(oldEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('D-07: elapsed time shown for completed task, absent for running task', () => {
    sessionState = {
      ...sessionState,
      delegatedTasks: [
        {
          taskId: 'done-task', agentName: 'DoneAgent', agentSlug: 'done',
          status: 'success', startedAt: 1000, completedAt: 6000, chunks: ['result'],
        },
        {
          taskId: 'run-task', agentName: 'RunAgent', agentSlug: 'run',
          status: 'running', startedAt: Date.now() - 3000, chunks: ['live'],
        },
      ],
    };
    const { getByText } = render(
      <TaskPanel isOpen onClose={vi.fn()} />
    );

    const doneCard = getByText('DoneAgent').closest('.relative') as Element;
    expect(doneCard?.textContent).toMatch(/5s/);

    const runCard = getByText('RunAgent').closest('.relative') as Element;
    expect(runCard?.textContent).not.toMatch(/\d+s\b/);
  });

  it('D-08: approve button calls resolveApproval("approve")', () => {
    const resolveApproval = vi.fn();
    sessionState = {
      ...sessionState,
      resolveApproval,
      pendingApproval: {
        runId: 'run-1',
        actions: [{ name: 'write_file', args: { file_path: '/foo.txt', content: 'bar' } }],
      },
    };
    const { getByText } = render(
      <TaskPanel isOpen onClose={vi.fn()} />
    );
    fireEvent.click(getByText('common.approve'));
    expect(resolveApproval).toHaveBeenCalledWith('approve');
  });

  it('D-09: clicking a delegated task card selects it for viewing', async () => {
    const setViewingSubagent = vi.fn();
    sessionState = {
      ...sessionState,
      setViewingSubagent,
      delegatedTasks: [
        {
          taskId: 'fail-task', agentName: 'FailAgent', agentSlug: 'fail',
          status: 'failure', chunks: [],
          errorCode: 'ERR_TIMEOUT',
          result: { error: { message: 'request timed out after 30s' } },
        },
      ],
    };
    const { getByText } = render(
      <TaskPanel isOpen onClose={vi.fn()} />
    );

    const toggleBtn = getByText('FailAgent').closest('button') as Element;
    fireEvent.click(toggleBtn);

    expect(setViewingSubagent).toHaveBeenCalledWith('fail-task');
  });

  it('D-10: task entry remains visible in timeline after transitioning out of waiting_approval', () => {
    // A task that was approved and is now "success" must still appear in the timeline
    sessionState = {
      ...sessionState,
      delegatedTasks: [
        {
          taskId: 'approved-task', agentName: 'ApprovedAgent', agentSlug: 'approved',
          status: 'success', startedAt: 1000, completedAt: 2000, chunks: ['done'],
        },
      ],
    };
    const { getByText } = render(
      <TaskPanel isOpen onClose={vi.fn()} />
    );
    expect(getByText('ApprovedAgent')).toBeTruthy();
  });

});
