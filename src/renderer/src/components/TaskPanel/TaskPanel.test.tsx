import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import { TaskPanel } from './TaskPanel';

const fetchAgentActivity = vi.fn();
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

vi.mock('./AgentTraceModal', () => ({
  AgentTraceModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="trace-modal-open" /> : null,
}));

beforeEach(() => {
  fetchAgentActivity.mockReset();
  fetchAgentActivity.mockResolvedValue(undefined);
  sessionState = {
    activeSessionId: 'session-1',
    activeRunId: null,
    agentRuns: [],
    agentToolCalls: [],
    delegatedTasks: [],
    pendingApproval: null,
    fetchAgentActivity,
    resolveApproval: vi.fn(),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TaskPanel', () => {
  it('refreshes activity each time the panel is reopened for the same session', async () => {
    const { rerender } = render(
      <TaskPanel isOpen onClose={vi.fn()} width={340} onResize={vi.fn()} />
    );

    await waitFor(() => expect(fetchAgentActivity).toHaveBeenCalledTimes(1));

    rerender(<TaskPanel isOpen={false} onClose={vi.fn()} width={340} onResize={vi.fn()} />);
    rerender(<TaskPanel isOpen onClose={vi.fn()} width={340} onResize={vi.fn()} />);

    await waitFor(() => expect(fetchAgentActivity).toHaveBeenCalledTimes(2));
    expect(fetchAgentActivity).toHaveBeenLastCalledWith('session-1');
  });

  it('retries activity fetch after a failed attempt for the same session', async () => {
    fetchAgentActivity.mockRejectedValueOnce(new Error('temporary db failure'));
    const { rerender } = render(
      <TaskPanel isOpen onClose={vi.fn()} width={340} onResize={vi.fn()} />
    );

    await waitFor(() => expect(fetchAgentActivity).toHaveBeenCalledTimes(1));

    rerender(<TaskPanel isOpen={false} onClose={vi.fn()} width={340} onResize={vi.fn()} />);
    rerender(<TaskPanel isOpen onClose={vi.fn()} width={340} onResize={vi.fn()} />);

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
      <TaskPanel isOpen={false} onClose={vi.fn()} width={340} onResize={vi.fn()} />
    );
    expect(queryByText('taskPanel.toolSummaryTitle')).toBeNull();

    rerender(<TaskPanel isOpen onClose={vi.fn()} width={340} onResize={vi.fn()} />);

    await waitFor(() => expect(queryByText('taskPanel.toolSummaryTitle')).toBeTruthy());
  });

  it('does not keep the running-task timer active while hidden', () => {
    vi.useFakeTimers();
    sessionState = {
      ...sessionState,
      delegatedTasks: [{ taskId: 'task-1', status: 'running', chunks: [] }],
    };

    render(<TaskPanel isOpen={false} onClose={vi.fn()} width={340} onResize={vi.fn()} />);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(vi.getTimerCount()).toBe(0);
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
      <TaskPanel isOpen onClose={vi.fn()} width={340} onResize={vi.fn()} />
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
      <TaskPanel isOpen onClose={vi.fn()} width={340} onResize={vi.fn()} />
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
      <TaskPanel isOpen onClose={vi.fn()} width={340} onResize={vi.fn()} />
    );
    fireEvent.click(getByText('common.approve'));
    expect(resolveApproval).toHaveBeenCalledWith('approve');
  });

  it('D-09: failure expanded body contains error summary with no recoverable action buttons', async () => {
    sessionState = {
      ...sessionState,
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
      <TaskPanel isOpen onClose={vi.fn()} width={340} onResize={vi.fn()} />
    );

    // Failure tasks don't auto-expand; click toggle to open
    const toggleBtn = getByText('FailAgent').closest('button') as Element;
    fireEvent.click(toggleBtn);

    await waitFor(() => expect(getByText('request timed out after 30s')).toBeTruthy());
    expect(getByText('ERR_TIMEOUT')).toBeTruthy();

    // The expanded body should have no retry / action buttons — only toggle + trace buttons
    const failCard = getByText('FailAgent').closest('.relative') as Element;
    const buttons = Array.from(failCard?.querySelectorAll('button') ?? []);
    const actionButtonLabels = buttons.map((b) =>
      (b.textContent?.trim() || b.getAttribute('aria-label') || '').toLowerCase()
    );
    expect(actionButtonLabels.some((label) => /retry|重试|再试|try again/.test(label))).toBe(false);
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
      <TaskPanel isOpen onClose={vi.fn()} width={340} onResize={vi.fn()} />
    );
    expect(getByText('ApprovedAgent')).toBeTruthy();
  });

  it('AgentTraceModal: clicking view-trace button opens the modal', () => {
    sessionState = {
      ...sessionState,
      delegatedTasks: [
        {
          taskId: 'trace-task', agentName: 'TraceAgent', agentSlug: 'trace',
          status: 'running', startedAt: Date.now(), chunks: ['work in progress'],
        },
      ],
    };
    const { getByLabelText, getByTestId } = render(
      <TaskPanel isOpen onClose={vi.fn()} width={340} onResize={vi.fn()} />
    );

    const traceBtn = getByLabelText('taskPanel.viewTrace');
    fireEvent.click(traceBtn);

    expect(getByTestId('trace-modal-open')).toBeTruthy();
  });
});
