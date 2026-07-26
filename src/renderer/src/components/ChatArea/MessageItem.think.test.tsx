// #237 safety net: pin the think-block parsing branches and the thinking timer
// behavior of MessageContentRenderer before extracting them into pure functions
// and a dedicated hook.
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { useSessionStore } from '../../stores/sessionStore';
import { MessageContentRenderer } from './MessageItem';

let mockTypewriting = false;
vi.mock('@/hooks/useTypewriter', () => ({
  useTypewriter: (content: string) => ({ displayedContent: content, isTypewriting: mockTypewriting }),
}));

beforeEach(async () => {
  await i18n.changeLanguage('en-US');
  mockTypewriting = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MessageContentRenderer folded think blocks (non-streaming)', () => {
  it('folds multiple think blocks into one collapsed trace between pre/post content', () => {
    const { container } = render(
      <MessageContentRenderer
        content={'Intro <think>first trace</think> middle <think>second trace</think> outro'}
        isLast={false}
        isStreaming={false}
      />
    );

    const toggle = screen.getByTestId('think-toggle');
    expect(toggle.textContent).toContain('Thinking complete');
    // Collapsed by default for an old message: the trace body is hidden.
    expect(container.textContent).not.toContain('first trace');
    expect(container.textContent).toContain('Intro');
    expect(container.textContent).toContain('outro');

    fireEvent.click(toggle);
    expect(container.textContent).toContain('first trace\nsecond trace');
  });

  it('shows the persisted duration in the folded header when available', () => {
    render(
      <MessageContentRenderer
        content={'<think>trace</think> answer'}
        isLast={false}
        isStreaming={false}
        thinkDurationSeconds={75}
      />
    );

    expect(screen.getByTestId('think-toggle').textContent)
      .toContain('Thinking complete (took 1 分 15 秒)');
  });

  it('falls back to an estimated token count when no duration was recorded', () => {
    render(
      <MessageContentRenderer
        content={'<think>four word think trace</think> answer'}
        isLast={false}
        isStreaming={false}
      />
    );

    expect(screen.getByTestId('think-toggle').textContent).toMatch(/Thinking complete \(~\d+ tokens\)/);
  });

  it('strips orphan </think> closers without eating message text', () => {
    const { container } = render(
      <MessageContentRenderer content={'Hello</think> world'} isLast={false} isStreaming={false} />
    );

    expect(container.textContent).toContain('Hello world');
    expect(container.textContent).not.toContain('</think>');
    expect(screen.queryByTestId('think-toggle')).toBeNull();
  });

  it('renders plain content without a think toggle', () => {
    const { container } = render(
      <MessageContentRenderer content={'Just an answer'} isLast={false} isStreaming={false} />
    );

    expect(container.textContent).toContain('Just an answer');
    expect(screen.queryByTestId('think-toggle')).toBeNull();
  });
});

describe('MessageContentRenderer streaming think timer', () => {
  it('ticks the in-progress header while the trace is open and keeps it expanded', () => {
    vi.useFakeTimers();
    mockTypewriting = true;

    const { container } = render(
      <MessageContentRenderer
        content={'<think>streaming trace'}
        isLast={true}
        isStreaming={true}
      />
    );

    expect(screen.getByTestId('think-toggle').textContent).toContain('Thinking (');
    // An unfinished trace starts expanded with the live caret visible.
    expect(container.textContent).toContain('streaming trace');

    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.getByTestId('think-toggle').textContent).toContain('2 秒');
  });

  it('persists the elapsed duration through the store once thinking closes', () => {
    vi.useFakeTimers();
    mockTypewriting = true;
    const updateMessageThinkDuration = vi.fn();
    useSessionStore.setState({ updateMessageThinkDuration } as any);

    const { rerender } = render(
      <MessageContentRenderer
        content={'<think>streaming trace'}
        isLast={true}
        isStreaming={true}
        messageId="msg-1"
      />
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    rerender(
      <MessageContentRenderer
        content={'<think>streaming trace</think> final answer'}
        isLast={true}
        isStreaming={true}
        messageId="msg-1"
      />
    );

    expect(updateMessageThinkDuration).toHaveBeenCalledWith('msg-1', 3);
    expect(screen.getByTestId('think-toggle').textContent).toContain('Thought (took 3 秒)');
  });
});
