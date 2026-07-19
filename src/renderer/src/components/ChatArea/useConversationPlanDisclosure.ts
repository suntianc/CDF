import { useEffect, useRef, useState } from 'react';
import type { TodoItem } from '@shared/types';

interface UseConversationPlanDisclosureInput {
  activeSessionId: string | null;
  todos: TodoItem[];
  isStreaming: boolean;
  streamingMessageId: string | null;
  activeRunId: string | null;
  clearTodos: () => void;
  clearCompletedDelayMs?: number;
}

interface ConversationPlanDisclosure {
  showTodos: boolean;
  todoExpanded: boolean;
  toggleTodoExpanded: () => void;
}

export function useConversationPlanDisclosure({
  activeSessionId,
  todos,
  isStreaming,
  streamingMessageId,
  activeRunId,
  clearTodos,
  clearCompletedDelayMs = 2000,
}: UseConversationPlanDisclosureInput): ConversationPlanDisclosure {
  const [expandedByPlan, setExpandedByPlan] = useState<Record<string, boolean>>({});
  const previousSessionIdRef = useRef<string | null>(null);
  const previousHasActivePlanRef = useRef(false);

  const hasTodos = todos.length > 0;
  const allTodosCompleted = hasTodos && todos.every((todo) => todo.status === 'completed');
  const hasActiveTodos = hasTodos && todos.some((todo) => todo.status !== 'completed');
  const hasActivePlan = isStreaming && hasActiveTodos;
  const todoPlanKey = activeSessionId && hasActivePlan
    ? `${activeSessionId}:${streamingMessageId || activeRunId || 'pending'}`
    : null;
  const todoExpanded = todoPlanKey ? expandedByPlan[todoPlanKey] ?? false : false;

  useEffect(() => {
    const previousSessionId = previousSessionIdRef.current;
    const stayedInSameSession = previousSessionId === activeSessionId;
    const planStartedInCurrentSession = todoPlanKey !== null && stayedInSameSession && !previousHasActivePlanRef.current;

    if (planStartedInCurrentSession) {
      setExpandedByPlan((prev) => (
        prev[todoPlanKey] === undefined ? { ...prev, [todoPlanKey]: true } : prev
      ));
    }

    previousSessionIdRef.current = activeSessionId;
    previousHasActivePlanRef.current = hasActivePlan;
  }, [activeSessionId, hasActivePlan, todoPlanKey]);

  useEffect(() => {
    if (!allTodosCompleted) {
      return;
    }

    const timer = setTimeout(() => {
      clearTodos();
    }, clearCompletedDelayMs);
    return () => clearTimeout(timer);
  }, [allTodosCompleted, clearCompletedDelayMs, clearTodos, todos]);

  const toggleTodoExpanded = () => {
    if (!todoPlanKey) return;
    setExpandedByPlan((prev) => ({
      ...prev,
      [todoPlanKey]: !(prev[todoPlanKey] ?? false),
    }));
  };

  return {
    showTodos: hasActivePlan,
    todoExpanded,
    toggleTodoExpanded,
  };
}
