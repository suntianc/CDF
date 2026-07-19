import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { ConversationComposerDock } from './ConversationComposerDock';
import { useComposerInputController } from './composerInput/useComposerInputController';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, number>) => {
      const translations: Record<string, string> = {
        'todo.expand': 'Expand todos',
        'todo.collapse': 'Collapse todos',
        'todo.completedCount': `${values?.completed ?? 0}/${values?.total ?? 0} completed`,
      };
      return translations[key] ?? key;
    },
  }),
}));

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = globalThis.ResizeObserver;
  }
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {};
  }
});

function renderDock(overrides: Partial<Omit<ComponentProps<typeof ConversationComposerDock>, 'composerController'>> = {}) {
  const onSubmit = vi.fn();
  const props = {
    hidden: false,
    showTodos: false,
    todos: [],
    todoExpanded: false,
    onToggleTodoExpanded: vi.fn(),
    isStreaming: false,
    inputLabel: 'Session Composer Input',
    placeholder: 'Ask CDF',
    commands: [],
    commandWarnings: [],
    commandLoading: 'idle' as const,
    onCommandSelect: vi.fn(),
    onCommandInsert: vi.fn(),
    onSubmit,
    canSubmit: true,
    sendLabel: 'Send message',
    stopGeneratingLabel: 'Stop generating',
    onStopGenerating: vi.fn(),
    leftToolbarSlot: <button type="button">Approval mode</button>,
    modelSelectorSlot: <button type="button">Model picker</button>,
    ...overrides,
  };

  function Harness() {
    const composerController = useComposerInputController({
      mode: 'session',
      isStreaming: props.isStreaming,
      projectId: 'project-1',
      hasPathMentionProject: true,
      commands: props.commands,
      resolveCommand: () => null,
      listPathMentionCandidates: async () => ({ candidates: [], truncated: false }),
    });

    return <ConversationComposerDock {...props} composerController={composerController} />;
  }

  return {
    ...render(<Harness />),
    props,
    onSubmit,
  };
}

describe('ConversationComposerDock', () => {
  it('lets a user submit from the Session Composer Input and renders control slots', () => {
    const { onSubmit } = renderDock();

    expect(screen.getByText('Approval mode')).toBeTruthy();
    expect(screen.getByText('Model picker')).toBeTruthy();

    act(() => {
      fireEvent.change(screen.getByLabelText('Session Composer Input'), {
        target: { value: 'Continue the analysis' },
      });
    });
    act(() => {
      fireEvent.click(screen.getByLabelText('Send message'));
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows transient todos and delegates stop generation while streaming', () => {
    const onStopGenerating = vi.fn();
    const onToggleTodoExpanded = vi.fn();

    renderDock({
      isStreaming: true,
      onStopGenerating,
      showTodos: true,
      todoExpanded: false,
      onToggleTodoExpanded,
      todos: [
        { content: 'Read files', status: 'completed' },
        { content: 'Write summary', status: 'in_progress' },
      ],
    });

    expect(screen.getByText('Todo List')).toBeTruthy();
    expect(screen.getByText('1/2 completed')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Expand todos'));
    expect(onToggleTodoExpanded).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Stop generating'));
    expect(onStopGenerating).toHaveBeenCalledTimes(1);
  });

  it('applies hidden state without owning delegated view semantics', () => {
    const { container } = renderDock({ hidden: true });

    expect(container.firstElementChild?.className).toContain('hidden');
  });
});
