import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SubagentView } from './SubagentView';
import type { DelegatedTask } from '../../stores/sessionStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (
      key === 'toolMessage.callTool' ? `call ${options?.name}` : key
    ),
  }),
}));

vi.mock('../../stores/sessionStore', async () => {
  const actual = await vi.importActual<typeof import('../../stores/sessionStore')>('../../stores/sessionStore');
  return {
    ...actual,
    useSessionStore: (selector?: (state: { isStreaming: boolean }) => unknown) => (
      selector ? selector({ isStreaming: false }) : { isStreaming: false }
    ),
  };
});

vi.mock('./MessageItem', () => ({
  MessageContentRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('./StreamdownRenderer', () => ({
  StreamdownRenderer: ({ text }: { text: string }) => <div>{text}</div>,
}));

describe('SubagentView', () => {
  it('renders subagent tool call result details from paired execution steps', () => {
    const task: DelegatedTask = {
      delegatedRunId: 'delegated-1',
      taskId: 'task-1',
      agentSlug: 'code',
      agentName: 'Code Agent',
      goal: 'Read a file',
      status: 'success',
      chunks: [],
      steps: [
        {
          type: 'tool_call',
          tool: 'read_file',
          args: { path: '/tmp/a.ts' },
          ts: 1000,
          spanId: 'abcd1234',
        },
        {
          type: 'tool_result',
          tool: 'read_file',
          success: true,
          output: 'file content',
          ts: 1001,
          spanId: 'abcd1234',
        },
      ],
    };

    render(<SubagentView task={task} onBack={vi.fn()} />);

    fireEvent.click(screen.getByText('call read_file'));

    expect(screen.getByText('Output')).toBeTruthy();
    expect(screen.getByText('file content')).toBeTruthy();
  });

  it('does not show a completed subagent tool call without output as loading', () => {
    const task: DelegatedTask = {
      delegatedRunId: 'delegated-1',
      taskId: 'task-1',
      agentSlug: 'code',
      agentName: 'Code Agent',
      goal: 'Read a file',
      status: 'success',
      chunks: [],
      steps: [
        {
          type: 'tool_call',
          tool: 'read_file',
          args: { file_path: '/tmp/a.ts', offset: 0, limit: 100 },
          ts: 1000,
          spanId: 'abcd1234',
        },
      ],
    };

    const { container } = render(<SubagentView task={task} onBack={vi.fn()} />);

    expect(screen.getByText('call read_file')).toBeTruthy();
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
});
