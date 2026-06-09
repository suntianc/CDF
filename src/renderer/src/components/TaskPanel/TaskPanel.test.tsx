import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
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
}));

vi.mock('../../stores/agentStore', () => ({
  useAgentStore: () => [],
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
