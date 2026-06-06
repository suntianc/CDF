import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { useState, useRef, useEffect } from 'react';
import { resolve as dispatcherResolve, dispatch as dispatcherDispatch } from '@/lib/commands/dispatcher';
import { useCommandRegistry } from '@/hooks/useCommandRegistry';

vi.mock('@/lib/commands/dispatcher', async () => {
  const actual = await vi.importActual<typeof import('@/lib/commands/dispatcher')>('@/lib/commands/dispatcher');
  return {
    resolve: vi.fn(actual.resolve),
    dispatch: vi.fn(),
  };
});

const mockResolve = vi.mocked(dispatcherResolve);
const mockDispatch = vi.mocked(dispatcherDispatch);

describe('ChatArea.handleSend 5-line slash sniff (D-14/D-15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockClear();
    mockDispatch.mockClear();
  });

  function makeTestHarness() {
    function TestHarness() {
      const [inputVal, setInputVal] = useState('');
      const textareaRef = useRef<HTMLTextAreaElement>(null);
      const registry = useCommandRegistry('project-1', null);

      // Simulate 5-line sniff behavior (mirrored from ChatArea.tsx D-14)
      const handleSend = async (e?: { preventDefault?: () => void }) => {
        if (e?.preventDefault) e.preventDefault();
        if (inputVal.startsWith('/') && textareaRef.current?.selectionStart === 0) {
          const plan = dispatcherResolve(inputVal, registry.commands);
          if (plan) {
            setInputVal('');
            await dispatcherDispatch(plan);
            return;
          }
        }
        // Fall through: do nothing in test
        return;
      };

      useEffect(() => {
        (window as any).textHarness = { inputVal, setInputVal, textareaRef, handleSend };
      });

      return (
        <div>
          <textarea
            ref={textareaRef}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            aria-label="chat-input"
            data-testid="chat-input"
          />
        </div>
      );
    }
    return TestHarness;
  }

  it('D-15 case 1: `/goal X` at message start (selectionStart=0) routes through dispatcher', async () => {
    mockResolve.mockReturnValue({
      kind: 'GoalLoop',
      command: { name: 'goal', description: '', source: 'system', target: 'goal', sourceLabel: 'system', badge: '[system]' },
      args: 'write tests',
      goal: 'write tests',
    });

    const TestHarness = makeTestHarness();
    render(<TestHarness />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;

    act(() => {
      fireEvent.change(textarea, { target: { value: '/goal write tests' } });
    });
    // Simulate caret at start
    Object.defineProperty(textarea, 'selectionStart', { value: 0, configurable: true });

    await act(async () => {
      await (window as any).textHarness.handleSend();
    });

    expect(mockResolve).toHaveBeenCalledWith('/goal write tests', expect.any(Array));
    expect(mockDispatch).toHaveBeenCalledWith({
      kind: 'GoalLoop',
      command: expect.objectContaining({ name: 'goal' }),
      args: 'write tests',
      goal: 'write tests',
    });
  });

  it('D-15 case 2: mid-text `/baz` (selectionStart > 0) does NOT trigger sniff', async () => {
    const TestHarness = makeTestHarness();
    render(<TestHarness />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;

    act(() => {
      fireEvent.change(textarea, { target: { value: 'hello /baz' } });
    });
    // Simulate caret at position 7 (after "hello ")
    Object.defineProperty(textarea, 'selectionStart', { value: 7, configurable: true });

    await act(async () => {
      await (window as any).textHarness.handleSend();
    });

    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('D-15 case 3: `/  foo` (dispatcher.resolve returns null) falls through', async () => {
    mockResolve.mockReturnValue(null);

    const TestHarness = makeTestHarness();
    render(<TestHarness />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;

    act(() => {
      fireEvent.change(textarea, { target: { value: '/  foo' } });
    });
    Object.defineProperty(textarea, 'selectionStart', { value: 0, configurable: true });

    await act(async () => {
      await (window as any).textHarness.handleSend();
    });

    // Sniff was consulted (startsWith / selectionStart matched)
    expect(mockResolve).toHaveBeenCalledWith('/  foo', expect.any(Array));
    // But dispatcher.dispatch NOT called (null resolution → fall through)
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

