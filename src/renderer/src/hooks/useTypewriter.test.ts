import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTypewriter } from './useTypewriter';

describe('useTypewriter', () => {
  let rafCallbacks: FrameRequestCallback[];
  let rafId: number;

  function setReducedMotion(reduced: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: reduced && query.includes('reduced-motion'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent() {
        return false;
      },
    }));
  }

  beforeEach(() => {
    rafCallbacks = [];
    rafId = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return ++rafId;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    setReducedMotion(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function flushFrames(max = 1000): void {
    let iterations = 0;
    act(() => {
      while (rafCallbacks.length > 0 && iterations < max) {
        const pending = rafCallbacks;
        rafCallbacks = [];
        for (const cb of pending) cb(0);
        iterations += 1;
      }
    });
  }

  it('does not leave isTypewriting stuck true after the stream ends with backlog (#213)', () => {
    const target = 'x'.repeat(500);
    const { result, rerender } = renderHook(
      ({ content, active }: { content: string; active: boolean }) => useTypewriter(content, active),
      { initialProps: { content: '', active: true } },
    );

    // Content arrives while streaming; reveal only part of it.
    rerender({ content: target, active: true });
    flushFrames(5);
    expect(result.current.isTypewriting).toBe(true);
    expect(result.current.displayedContent.length).toBeLessThan(target.length);

    // Stream ends with a backlog still buffered — ease-out must finish and clear the flag.
    rerender({ content: target, active: false });
    flushFrames();

    expect(result.current.isTypewriting).toBe(false);
    expect(result.current.displayedContent).toBe(target);
  });

  it('clears isTypewriting when the stream ends already caught up', () => {
    const { result, rerender } = renderHook(
      ({ content, active }: { content: string; active: boolean }) => useTypewriter(content, active),
      { initialProps: { content: 'hello', active: true } },
    );
    flushFrames();

    rerender({ content: 'hello', active: false });
    flushFrames();

    expect(result.current.isTypewriting).toBe(false);
    expect(result.current.displayedContent).toBe('hello');
  });

  it('clears isTypewriting on stream end under prefers-reduced-motion (#213)', () => {
    setReducedMotion(true);
    const { result, rerender } = renderHook(
      ({ content, active }: { content: string; active: boolean }) => useTypewriter(content, active),
      { initialProps: { content: 'hi', active: true } },
    );
    expect(result.current.isTypewriting).toBe(true);

    rerender({ content: 'hi there', active: false });
    flushFrames();

    expect(result.current.isTypewriting).toBe(false);
    expect(result.current.displayedContent).toBe('hi there');
  });
});
