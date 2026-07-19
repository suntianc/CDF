import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TodoItem } from '@shared/types';
import { useConversationPlanDisclosure } from './useConversationPlanDisclosure';

const activeTodos: TodoItem[] = [
  { content: 'Inspect files', status: 'in_progress' },
  { content: 'Write tests', status: 'pending' },
];

const completedTodos: TodoItem[] = [
  { content: 'Inspect files', status: 'completed' },
  { content: 'Write tests', status: 'completed' },
];

describe('useConversationPlanDisclosure', () => {
  it('shows and auto-expands a transient plan that starts in the current Conversation', () => {
    const clearTodos = vi.fn();
    const { result, rerender } = renderHook(
      ({ todos, isStreaming, streamingMessageId }) => useConversationPlanDisclosure({
        activeSessionId: 'session-1',
        todos,
        isStreaming,
        streamingMessageId,
        activeRunId: 'run-1',
        clearTodos,
      }),
      {
        initialProps: {
          todos: [] as TodoItem[],
          isStreaming: false,
          streamingMessageId: null as string | null,
        },
      },
    );

    expect(result.current.showTodos).toBe(false);

    act(() => {
      rerender({
        todos: activeTodos,
        isStreaming: true,
        streamingMessageId: 'message-1',
      });
    });

    expect(result.current.showTodos).toBe(true);
    expect(result.current.todoExpanded).toBe(true);
  });

  it('keeps manual expanded state scoped to the current transient plan', () => {
    const clearTodos = vi.fn();
    const { result, rerender } = renderHook(
      ({ todos, isStreaming, streamingMessageId }) => useConversationPlanDisclosure({
        activeSessionId: 'session-1',
        todos,
        isStreaming,
        streamingMessageId,
        activeRunId: 'run-1',
        clearTodos,
      }),
      {
        initialProps: {
          todos: [] as TodoItem[],
          isStreaming: false,
          streamingMessageId: null as string | null,
        },
      },
    );

    act(() => {
      rerender({
        todos: activeTodos,
        isStreaming: true,
        streamingMessageId: 'message-1',
      });
    });
    expect(result.current.todoExpanded).toBe(true);

    act(() => {
      result.current.toggleTodoExpanded();
    });
    expect(result.current.todoExpanded).toBe(false);

    act(() => {
      rerender({
        todos: activeTodos,
        isStreaming: true,
        streamingMessageId: 'message-2',
      });
    });
    expect(result.current.todoExpanded).toBe(false);

    act(() => {
      result.current.toggleTodoExpanded();
    });
    expect(result.current.todoExpanded).toBe(true);

    act(() => {
      rerender({
        todos: activeTodos,
        isStreaming: true,
        streamingMessageId: 'message-1',
      });
    });
    expect(result.current.todoExpanded).toBe(false);
  });

  it('clears a completed transient plan after the configured delay', () => {
    vi.useFakeTimers();
    const clearTodos = vi.fn();

    renderHook(() => useConversationPlanDisclosure({
      activeSessionId: 'session-1',
      todos: completedTodos,
      isStreaming: false,
      streamingMessageId: null,
      activeRunId: 'run-1',
      clearTodos,
      clearCompletedDelayMs: 50,
    }));

    expect(clearTodos).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(49);
    });
    expect(clearTodos).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(clearTodos).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
