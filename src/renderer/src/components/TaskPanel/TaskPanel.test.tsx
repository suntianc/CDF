import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import { TaskPanel } from './TaskPanel';
import type { CapabilityJobEvent } from '../../../../shared/capability-jobs';

const fetchAgentActivity = vi.fn();
const listCapabilityJobs = vi.fn();
const commandCapabilityJob = vi.fn();
let capabilityJobListener: ((event: CapabilityJobEvent) => void) | undefined;
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
  commandCapabilityJob.mockReset();
  commandCapabilityJob.mockResolvedValue({ ok: false, error: 'not configured', code: 'TEST' });
  capabilityJobListener = undefined;
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      capabilityJobs: {
        list: listCapabilityJobs,
        command: commandCapabilityJob,
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
  it('shows loading before an empty background Job list resolves', async () => {
    let resolveList!: (jobs: []) => void;
    listCapabilityJobs.mockReturnValue(new Promise((resolve) => {
      resolveList = resolve;
    }));
    const { getByText, queryByText } = render(<TaskPanel isOpen onClose={vi.fn()} />);

    expect(getByText('taskPanel.backgroundJobsLoading')).toBeTruthy();
    expect(queryByText('taskPanel.backgroundJobsEmpty')).toBeNull();

    resolveList([]);
    await waitFor(() => expect(getByText('taskPanel.backgroundJobsEmpty')).toBeTruthy());
    expect(queryByText('taskPanel.backgroundJobsLoading')).toBeNull();
  });

  it('refreshes activity for the newly selected Conversation', async () => {
    const { rerender } = render(<TaskPanel isOpen onClose={vi.fn()} />);
    await waitFor(() => expect(fetchAgentActivity).toHaveBeenCalledWith('session-1'));

    sessionState = { ...sessionState, activeSessionId: 'session-2' };
    rerender(<TaskPanel isOpen onClose={vi.fn()} />);

    await waitFor(() => expect(fetchAgentActivity).toHaveBeenCalledWith('session-2'));
  });

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
      connectionId: 'xai-oauth',
      queuePosition: 1,
      relatedJobId: null,
      availableActions: ['cancel'],
      error: null,
      statusMessage: 'waiting_connection_slot',
      continuationStatus: null,
      continuationError: null,
      createdAt: 1,
      updatedAt: 1,
      terminalAt: null,
      detailsPruned: false,
      prunedAt: null,
    }]);
    const { getByText, getByRole, queryByText } = render(<TaskPanel isOpen onClose={vi.fn()} />);

    await waitFor(() => expect(getByText('taskPanel.jobStatus.queued')).toBeTruthy());
    expect(getByRole('button', { name: 'taskPanel.jobToggle' }).getAttribute('aria-expanded')).toBe('true');
    const jobList = getByRole('region', { name: 'taskPanel.backgroundJobsTitle' });
    expect((jobList as HTMLElement).style.maxHeight).toBe('18rem');
    expect((jobList as HTMLElement).style.overflowY).toBe('auto');
    commandCapabilityJob.mockRejectedValueOnce(new Error('IPC unavailable'));
    fireEvent.click(getByRole('button', { name: 'taskPanel.jobAction.cancel' }));
    await waitFor(() => expect(getByRole('alert').textContent).toBe('taskPanel.commandError.generic'));
    act(() => capabilityJobListener?.({
      projectId: 'project-1',
      job: {
        id: 'job-1',
        projectId: 'project-1',
        type: 'video.generate',
        status: 'completed',
        provider: 'xai-oauth',
        artifacts: [{ path: '/project/video.mp4', mimeType: 'video/mp4' }],
        connectionId: 'xai-oauth',
        queuePosition: null,
        relatedJobId: null,
        availableActions: [],
        error: null,
        statusMessage: 'artifact_durable',
        continuationStatus: 'consumed',
        continuationError: null,
        createdAt: 1,
        updatedAt: 2,
        terminalAt: 2,
        detailsPruned: false,
        prunedAt: null,
      },
    }));
    expect(getByText('taskPanel.jobStatus.completed')).toBeTruthy();
    expect(queryByText('/project/video.mp4')).toBeNull();
    expect(queryByText('taskPanel.continuationStatus.consumed')).toBeNull();
    const completedToggle = getByRole('button', { name: 'taskPanel.jobToggle' });
    expect(completedToggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(completedToggle);
    expect(getByText('/project/video.mp4')).toBeTruthy();
    expect(getByText('taskPanel.continuationStatus.consumed')).toBeTruthy();
  });

  it('shows the frozen route, explicit mode, and non-sensitive first-frame snapshot summary', async () => {
    listCapabilityJobs.mockResolvedValue([{
      id: 'job-first-frame',
      projectId: 'project-1',
      type: 'video.generate',
      status: 'queued',
      provider: 'xai-oauth',
      artifacts: [],
      connectionId: 'xai-oauth',
      queuePosition: 1,
      relatedJobId: null,
      availableActions: ['cancel'],
      inputSummary: {
        mode: 'first-frame',
        firstFrame: {
          mimeType: 'image/png',
          sizeBytes: 2048,
          width: 1600,
          height: 900,
          aspectRatio: '16:9',
          sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        },
      },
      error: null,
      statusMessage: 'waiting_connection_slot',
      continuationStatus: null,
      continuationError: null,
      createdAt: 1,
      updatedAt: 1,
      terminalAt: null,
      detailsPruned: false,
      prunedAt: null,
    }]);

    const { getByText, queryByText } = render(<TaskPanel isOpen onClose={vi.fn()} />);

    await waitFor(() => expect(getByText('taskPanel.jobRoute.xai-oauth')).toBeTruthy());
    expect(getByText('taskPanel.videoModeValue.first-frame')).toBeTruthy();
    expect(getByText('image/png · 1600×900 · 16:9 · 2 KB · abcdef01')).toBeTruthy();
    expect(queryByText(/opening\.png|token=/)).toBeNull();
  });

  it('offers state-safe controls and explains unknown submission risk', async () => {
    listCapabilityJobs.mockResolvedValue([{
      id: 'job-unknown',
      projectId: 'project-1',
      type: 'video.generate',
      status: 'submission_unknown',
      provider: 'xai-oauth',
      connectionId: 'xai-oauth',
      queuePosition: null,
      relatedJobId: null,
      availableActions: ['resubmit'],
      artifacts: [],
      error: 'connection reset',
      statusMessage: 'submission_unknown_no_retry',
      continuationStatus: null,
      continuationError: null,
      createdAt: 1,
      updatedAt: 1,
      terminalAt: null,
      detailsPruned: false,
      prunedAt: null,
    }]);
    commandCapabilityJob.mockResolvedValue({ ok: true, job: {
      id: 'job-new',
      projectId: 'project-1',
      type: 'video.generate',
      status: 'queued',
      provider: 'xai-oauth',
      connectionId: 'xai-oauth',
      queuePosition: 1,
      relatedJobId: 'job-unknown',
      availableActions: ['cancel'],
      artifacts: [],
      error: null,
      statusMessage: 'explicit_resubmission_risk',
      continuationStatus: null,
      continuationError: null,
      createdAt: 2,
      updatedAt: 2,
      terminalAt: null,
      detailsPruned: false,
      prunedAt: null,
    } });
    const { getByText, getByRole } = render(<TaskPanel isOpen onClose={vi.fn()} />);

    await waitFor(() => expect(getByText('taskPanel.jobStatus.submission_unknown')).toBeTruthy());
    expect(getByText('taskPanel.jobMessage.submission_unknown_no_retry')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'taskPanel.jobAction.resubmit' }));
    await waitFor(() => expect(commandCapabilityJob).toHaveBeenCalledWith(
      'project-1', 'job-unknown', 'resubmit'
    ));
  });

  it('shows only stop tracking for an active MiniMax task and warns that remote billing may continue', async () => {
    listCapabilityJobs.mockResolvedValue([{
      id: 'job-minimax',
      projectId: 'project-1',
      type: 'video.generate',
      status: 'running',
      provider: 'minimax-token-plan',
      connectionId: 'minimax-token-plan',
      queuePosition: null,
      relatedJobId: null,
      availableActions: ['stop_tracking'],
      artifacts: [],
      error: null,
      statusMessage: 'provider_processing',
      continuationStatus: null,
      continuationError: null,
      createdAt: 1,
      updatedAt: 1,
      terminalAt: null,
      detailsPruned: false,
      prunedAt: null,
    }]);
    const { getByText, getByRole, queryByRole } = render(
      <TaskPanel isOpen onClose={vi.fn()} />
    );

    await waitFor(() => expect(getByText('taskPanel.remoteBillingWarning')).toBeTruthy());
    expect(getByText('taskPanel.jobMessage.provider_processing')).toBeTruthy();
    expect(getByRole('button', { name: 'taskPanel.jobAction.stop_tracking' })).toBeTruthy();
    expect(queryByRole('button', { name: 'taskPanel.jobAction.cancel' })).toBeNull();
    expect(queryByRole('button', { name: 'taskPanel.jobAction.resubmit' })).toBeNull();
  });

});

describe('TaskPanel — Activity Trail', () => {
  it('keeps a pruned Job understandable and links its retained artifact', async () => {
    listCapabilityJobs.mockResolvedValue([{
      id: 'job-tombstone',
      projectId: 'project-1',
      type: 'video.generate',
      status: 'completed',
      provider: 'xai-oauth',
      connectionId: 'xai-oauth',
      queuePosition: null,
      relatedJobId: null,
      availableActions: [],
      artifacts: [{ path: '/project/.cdf/artifacts/videos/paid.mp4', mimeType: 'video/mp4' }],
      error: null,
      statusMessage: null,
      continuationStatus: 'consumed',
      continuationError: null,
      createdAt: 1,
      updatedAt: 2,
      terminalAt: 2,
      detailsPruned: true,
      prunedAt: 3,
    }]);

    const { getByText, getByRole, queryByText } = render(<TaskPanel isOpen onClose={vi.fn()} />);

    await waitFor(() => expect(getByText('taskPanel.jobStatus.completed')).toBeTruthy());
    expect(queryByText('taskPanel.jobDetailsPruned')).toBeNull();
    expect(queryByText('/project/.cdf/artifacts/videos/paid.mp4')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'taskPanel.jobToggle' }));
    expect(getByText('taskPanel.jobDetailsPruned')).toBeTruthy();
    expect(getByText('/project/.cdf/artifacts/videos/paid.mp4')).toBeTruthy();
    expect(queryByText('taskPanel.videoModeValue.text')).toBeNull();
  });

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

  it('resolves concurrent delegated approvals by owning approval id with accessible source labels', () => {
    const resolveApproval = vi.fn();
    const writer = {
      id: 'approval-writer', runId: 'run-1', delegatedRunId: 'child-writer', targetAgentName: 'Writer', delegatedTask: 'write a.md',
      actions: [{ name: 'write_file', args: { path: 'a.md' } }],
    };
    const cleaner = {
      id: 'approval-cleaner', runId: 'run-1', delegatedRunId: 'child-cleaner', targetAgentName: 'Cleaner', delegatedTask: 'delete b.md',
      actions: [{ name: 'delete_file', args: { path: 'b.md' } }],
    };
    sessionState = {
      ...sessionState,
      resolveApproval,
      pendingApproval: writer,
      pendingApprovals: [writer, cleaner],
      approvalHistory: [{
        approval: { ...cleaner, id: 'approval-old' },
        status: 'approved',
        resolvedAt: 1,
        executionStatus: 'success',
      }],
    };

    const { getByRole, getByText } = render(<TaskPanel isOpen onClose={vi.fn()} />);
    fireEvent.click(getByRole('button', { name: 'common.reject Cleaner' }));

    expect(resolveApproval).toHaveBeenCalledWith('reject', undefined, 'approval-cleaner');
    expect(getByText('write a.md')).toBeTruthy();
    expect(getByText('delete b.md')).toBeTruthy();
    expect(getByText('taskPanel.approvalHistoryTitle')).toBeTruthy();
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
