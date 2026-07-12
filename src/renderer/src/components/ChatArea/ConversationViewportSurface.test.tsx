import { createRef } from 'react';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AgentApprovalRequest, Message } from '@shared/types';
import type { DelegatedTask, ParallelWorker } from '../../stores/sessionStore';
import type { ConversationTimelineItem } from './conversationTimeline/conversationTimeline';
import { ConversationViewportSurface } from './ConversationViewportSurface';

vi.mock('./GoalSystemBubble', () => ({
  GoalSystemBubble: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="goal-system-bubble">Goal bubble for {sessionId}</div>
  ),
}));

vi.mock('./SubagentView', () => ({
  SubagentView: ({ task, onBack }: { task: { agentName?: string; agentSlug: string }; onBack: () => void }) => (
    <div>
      <div>Subagent detail: {task.agentName ?? task.agentSlug}</div>
      <button type="button" onClick={onBack}>Back to master</button>
    </div>
  ),
}));

function message(overrides: Partial<Message> & Pick<Message, 'id' | 'role' | 'content'>): Message {
  return {
    session_id: 'session-1',
    created_at: 1_000,
    tokens: 0,
    ...overrides,
  };
}

function toolMessage(id: string, name: string): Message {
  return message({
    id,
    role: 'system',
    content: JSON.stringify({ type: 'tool', name, status: 'success' }),
  });
}

function renderSurface(overrides: Partial<ComponentProps<typeof ConversationViewportSurface>> = {}) {
  const props: ComponentProps<typeof ConversationViewportSurface> = {
    activeSessionId: 'session-1',
    timelineItems: [],
    messages: [],
    isConversationLoading: false,
    isStreaming: false,
    hasActiveGoal: false,
    viewingTask: null,
    viewingWorkerData: null,
    error: null,
    scrollContainerRef: createRef<HTMLDivElement>(),
    onScroll: vi.fn(),
    onOpenTaskPanel: vi.fn(),
    onBackFromSubagent: vi.fn(),
    onBackFromParallelWorker: vi.fn(),
    onClearError: vi.fn(),
    ...overrides,
  };

  return {
    ...render(<ConversationViewportSurface {...props} />),
    props,
  };
}

describe('ConversationViewportSurface', () => {
  it('shows an independent loading state instead of stale timeline content', () => {
    const staleMessage = message({ id: 'stale', role: 'assistant', content: 'stale Conversation' });
    renderSurface({
      isConversationLoading: true,
      messages: [staleMessage],
      timelineItems: [{ type: 'message', id: 'stale', message: staleMessage }],
    });

    expect(screen.getByRole('status').textContent).toContain('chat.loadingConversation');
    expect(screen.queryByText('stale Conversation')).toBeNull();
  });

  it('renders master Conversation timeline items and pending approval affordance', () => {
    const userMessage = message({ id: 'user-1', role: 'user', content: '请写两个文件' });
    const assistantMessage = message({ id: 'assistant-1', role: 'assistant', content: '完成了' });
    const foldedMessage = message({ id: 'assistant-think', role: 'assistant', content: '读取文件并写入' });
    const tool = toolMessage('tool-1', 'write_to_file');
    const approval: AgentApprovalRequest = {
      id: 'approval-1',
      runId: 'run-1',
      actions: [{ name: 'write_file', args: { file_path: 'README.md' } }],
    };
    const timelineItems: ConversationTimelineItem[] = [
      { type: 'message', id: userMessage.id, message: userMessage },
      {
        type: 'folded_block',
        id: 'folded-0',
        duration: 120,
        foldedItems: [{ type: 'message', id: foldedMessage.id, message: foldedMessage }],
      },
      { type: 'tool_group', id: tool.id, tools: [tool] },
      { type: 'pending_approval_block', id: 'pending-approval-1', approval },
      { type: 'message', id: assistantMessage.id, message: assistantMessage },
    ];
    const onOpenTaskPanel = vi.fn();

    renderSurface({ timelineItems, onOpenTaskPanel });

    expect(screen.getByText('请写两个文件')).toBeTruthy();
    expect(screen.getByText('完成了')).toBeTruthy();
    expect(screen.getByText(/processedDuration/)).toBeTruthy();
    expect(screen.getByText(/modifiedFiles/)).toBeTruthy();
    expect(screen.getByText(/awaitingApproval/)).toBeTruthy();

    fireEvent.click(screen.getByText(/awaitingApproval/));
    fireEvent.click(screen.getByText('chat.goApproveNow'));
    expect(onOpenTaskPanel).toHaveBeenCalledTimes(1);
  });

  it('does not expose prompt or signed first-frame source details in approval UI', () => {
    const approval: AgentApprovalRequest = {
      id: 'approval-video',
      runId: 'run-video',
      actions: [{
        name: 'generate_video',
        args: {
          mode: 'first-frame',
          route_hint: 'xai-oauth',
          duration: 5,
          resolution: '720p',
          prompt: 'confidential campaign description',
          images: [{
            role: 'first-frame',
            source: 'https://cdn.example.com/opening.png?token=signed-secret',
          }],
        },
      }],
    };

    renderSurface({
      timelineItems: [{
        type: 'pending_approval_block',
        id: 'pending-video',
        approval,
      }],
    });
    fireEvent.click(screen.getByText(/awaitingApproval/));

    expect(screen.getByText(/"route_hint": "xai-oauth"/)).toBeTruthy();
    expect(screen.getByText(/"mode": "first-frame"/)).toBeTruthy();
    expect(screen.getByText(/"duration": 5/)).toBeTruthy();
    expect(screen.getByText(/"resolution": "720p"/)).toBeTruthy();
    expect(screen.getByText(/"input_summary": "taskPanel.videoInputFirstFrameRemote"/)).toBeTruthy();
    expect(screen.getByText(/"non_cancellation_warning": "taskPanel.nonCancellationWarning"/)).toBeTruthy();
    expect(screen.queryByText(/signed-secret|confidential/)).toBeNull();
  });

  it('renders delegated task detail instead of master timeline and wires back navigation', () => {
    const onBackFromSubagent = vi.fn();
    const viewingTask: DelegatedTask = {
      taskId: 'task-1',
      agentSlug: 'writer',
      agentName: 'Writer Agent',
      goal: 'Write files',
      status: 'running',
      chunks: [],
      steps: [],
      startedAt: 1_000,
    };

    renderSurface({
      timelineItems: [
        { type: 'message', id: 'assistant-1', message: message({ id: 'assistant-1', role: 'assistant', content: 'master timeline' }) },
      ],
      viewingTask,
      onBackFromSubagent,
    });

    expect(screen.getByText('Subagent detail: Writer Agent')).toBeTruthy();
    expect(screen.queryByText('master timeline')).toBeNull();

    fireEvent.click(screen.getByText('Back to master'));
    expect(onBackFromSubagent).toHaveBeenCalledTimes(1);
  });

  it('renders parallel worker detail instead of master timeline and wires back navigation', () => {
    const onBackFromParallelWorker = vi.fn();
    const viewingWorkerData: ParallelWorker = {
      workerId: 'worker-1',
      agentSlug: 'reviewer',
      agentName: 'Reviewer Agent',
      goal: 'Review output',
      status: 'success',
      steps: [],
      textBuffer: 'review complete',
      startedAt: 1_000,
      completedAt: 2_000,
    };

    renderSurface({
      timelineItems: [
        { type: 'message', id: 'assistant-1', message: message({ id: 'assistant-1', role: 'assistant', content: 'master timeline' }) },
      ],
      viewingWorkerData,
      onBackFromParallelWorker,
    });

    expect(screen.getByText('Subagent detail: Reviewer Agent')).toBeTruthy();
    expect(screen.queryByText('master timeline')).toBeNull();

    fireEvent.click(screen.getByText('Back to master'));
    expect(onBackFromParallelWorker).toHaveBeenCalledTimes(1);
  });

  it('shows a typing indicator while streaming an empty assistant placeholder', () => {
    renderSurface({
      isStreaming: true,
      messages: [
        message({ id: 'assistant-empty', role: 'assistant', content: '' }),
      ],
    });

    expect(screen.getByRole('status', { name: 'chat.generating' })).toBeTruthy();
  });

  it('renders Conversation error recovery actions and clears the error after action', () => {
    const recover = vi.fn();
    const onClearError = vi.fn();

    renderSurface({
      error: {
        message: '加载失败',
        recoverableActions: [{ label: '重试', action: recover }],
      },
      onClearError,
    });

    expect(screen.getByRole('alert').textContent).toContain('加载失败');

    fireEvent.click(screen.getByText('重试'));
    expect(recover).toHaveBeenCalledTimes(1);
    expect(onClearError).toHaveBeenCalledTimes(1);
  });

  it('renders the Goal bubble and reserves viewport space when a goal is active', () => {
    const { container } = renderSurface({ hasActiveGoal: true });

    expect(screen.getByTestId('goal-system-bubble').textContent).toContain('session-1');
    expect(container.querySelector('.messages')?.getAttribute('style')).toContain('padding-top: 64px');
  });
});
