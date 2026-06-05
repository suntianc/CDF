import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { resolve as dispatcherResolve, dispatch as dispatcherDispatch } from '@/lib/commands/dispatcher';
import { useCommandRegistry } from '@/hooks/useCommandRegistry';

vi.mock('@/lib/commands/dispatcher', async () => {
  const actual = await vi.importActual<typeof import('@/lib/commands/dispatcher')>('@/lib/commands/dispatcher');
  return {
    resolve: vi.fn(actual.resolve),
    dispatch: vi.fn(),
  };
});

// Module-scoped mocks for the PlanPopup integration test. Defined up here
// so they're available in the `vi.mock` factory below.
const mockSendMessage = vi.fn();
const mockGetProjectState = vi.fn();
const mockGetSessionState = vi.fn();
const mockStopChat = vi.fn();

vi.mock('@/stores/projectStore', () => ({
  useProjectStore: { getState: () => mockGetProjectState() },
}));
vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: { getState: () => mockGetSessionState() },
}));

// The PlanPopup store imports the mocked session/project stores at module
// load time, so its getState() calls are routed through our mocks above.
import { usePlanPopupStore } from '@/stores/planPopupStore';

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
      const [currentProjectId] = useState('project-1');
      const [isStreaming] = useState(false);
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
      kind: 'SystemSilent',
      command: { name: 'goal', description: '', source: 'system', target: 'goal', sourceLabel: 'system', badge: '[system]' },
      args: 'write tests',
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
      kind: 'SystemSilent',
      command: expect.objectContaining({ name: 'goal' }),
      args: 'write tests',
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

// ===== 08.2 C-3: 「立即执行」 integration (C3-03) =====
//
// Contract: clicking "立即执行" in PlanPopup → store.execute() →
// useSessionStore.sendMessage(projectId, '立即执行', undefined). The 3rd
// argument must be undefined (or an object without `planOnly: true`) so
// the next LLM call drives the agent into execution mode (no plan gate).
//
// The user-message path is the same one used by the regular ChatArea
// composer; this test pins the contract from the popup side and asserts
// the call shape that downstream sendMessage consumers (llm.ts → runtime.ts)
// rely on.
describe('PlanPopup 「立即执行」 integration (C3-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockReset();
    mockGetProjectState.mockReset();
    mockGetSessionState.mockReset();
    mockStopChat.mockReset();

    mockGetProjectState.mockReturnValue({ currentProjectId: 'project-1' });
    mockGetSessionState.mockReturnValue({
      sendMessage: mockSendMessage,
      streamingMessageId: null,
    });

    (window as any).electronAPI = { llm: { stopChat: mockStopChat } };
    usePlanPopupStore.setState({
      isOpen: false,
      status: 'closed',
      planContent: '',
      iterationCount: 0,
      modifyHistory: [],
      currentRequestId: null,
      description: '',
    });
  });

  it("execute() sends '立即执行' as user message WITHOUT planOnly flag (overrides is undefined or lacks planOnly)", async () => {
    mockSendMessage.mockResolvedValue(undefined);

    // Open the popup the way the dispatcher would: `usePlanPopupStore.open(desc)`.
    usePlanPopupStore.getState().open('重构 ChatArea');
    // Sanity: the popup is open and ready
    expect(usePlanPopupStore.getState().isOpen).toBe(true);

    // User clicks "立即执行" → store.execute()
    await usePlanPopupStore.getState().execute();

    // C3-03 contract: the synthetic user message must be exactly "立即执行"
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const call = mockSendMessage.mock.calls[0];
    expect(call[0]).toBe('project-1');
    expect(call[1]).toBe('立即执行');
    // The 3rd argument must NOT include `planOnly: true`. We allow it to be
    // undefined (cleanest), an empty object, or any other shape that doesn't
    // carry the planOnly flag.
    const overrides = call[2];
    if (overrides !== undefined) {
      expect(overrides).not.toMatchObject({ planOnly: true });
    }
  });
});
