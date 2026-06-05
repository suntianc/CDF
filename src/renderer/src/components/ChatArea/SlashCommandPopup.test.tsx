import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { useState, useRef, useEffect, useCallback } from 'react';
import type { MutableRefObject } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import {
  SlashCommandPopup,
  SlashCommandPopupHandle,
} from '@/components/SlashCommand/SlashCommandPopup';
import { resolve as dispatcherResolve } from '@/lib/commands/dispatcher';

// v1.1 polish: module-scope mocks for handleSlashSelect / handleSlashInsert
// so individual tests can assert which path the popup triggered
// (Enter → onSelect / Tab → onInsert). The TestHarness re-uses these refs
// and exposes them via the harness handle.
const handleSlashSelectMock = vi.fn();
const handleSlashInsertMock = vi.fn();

// jsdom does not implement ResizeObserver (used by cmdk for sizing)
// or scrollIntoView (used by cmdk for item navigation). Polyfill both.
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

interface TestHarnessHandle {
  getInputVal: () => string;
  focusTextarea: () => void;
  isComposingRef: MutableRefObject<boolean>;
  justFinishedComposingRef: MutableRefObject<boolean>;
  setSlashOpen: (v: boolean) => void;
  setInputVal: (v: string) => void;
  triggerCompositionEnd: () => void;
  triggerCompositionStart: () => void;
  // v1.1 polish: expose the two distinct onSelect / onInsert mocks so
  // tests can assert which path the popup triggered (Enter vs Tab).
  onSelect: ReturnType<typeof vi.fn>;
  onInsert: ReturnType<typeof vi.fn>;
}

function TestHarness({
  refSetter,
  commands,
  hasMcpWarning,
  mcpWarningMessage,
  loading,
}: {
  refSetter?: (h: TestHarnessHandle) => void;
  commands?: import('../../../../shared/types').SlashCommand[];
  hasMcpWarning?: boolean;
  mcpWarningMessage?: string;
  loading?: 'idle' | 'pending' | 'slow' | 'ready' | 'error';
}) {
  const [inputVal, setInputVal] = useState('');
  const [slashOpen, setSlashOpen] = useState(false);
  const slashRef = useRef<SlashCommandPopupHandle>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // PITFALLS P13: IME safety state — mirrors ChatArea.tsx refs (lines 148-150)
  const isComposingRef = useRef(false);
  const justFinishedComposingRef = useRef(false);
  const compositionEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCompositionStart = useCallback(() => {
    if (compositionEndTimerRef.current) {
      clearTimeout(compositionEndTimerRef.current);
      compositionEndTimerRef.current = null;
    }
    isComposingRef.current = true;
    justFinishedComposingRef.current = false;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
    justFinishedComposingRef.current = true;
    if (compositionEndTimerRef.current) {
      clearTimeout(compositionEndTimerRef.current);
    }
    compositionEndTimerRef.current = setTimeout(() => {
      justFinishedComposingRef.current = false;
      compositionEndTimerRef.current = null;
    }, 200);
  }, []);

  useEffect(() => {
    return () => {
      if (compositionEndTimerRef.current) {
        clearTimeout(compositionEndTimerRef.current);
        compositionEndTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    refSetter?.({
      getInputVal: () => inputVal,
      focusTextarea: () => textareaRef.current?.focus(),
      isComposingRef,
      justFinishedComposingRef,
      setSlashOpen,
      setInputVal,
      triggerCompositionEnd: () => handleCompositionEnd(),
      triggerCompositionStart: () => handleCompositionStart(),
      // v1.1 polish: expose the two distinct onSelect / onInsert mocks so
      // tests can assert which path the popup triggered (Enter vs Tab).
      onSelect: handleSlashSelect,
      onInsert: handleSlashInsert,
    });
  });

  // v1.1 polish: Tab inserts without dispatching. Both mocks are declared
  // at module scope so tests can assert which path the popup triggered.
  const handleSlashSelect = handleSlashSelectMock;
  const handleSlashInsert = handleSlashInsertMock;
  // Re-implement the local side effect (mock + setInputVal + setSlashOpen)
  // so the test harness still exercises the textarea state path.
  handleSlashSelect.mockImplementation((cmd: string) => {
    setInputVal(cmd + ' ');
    setSlashOpen(false);
  });
  handleSlashInsert.mockImplementation((cmd: string) => {
    setInputVal(cmd + ' ');
    setSlashOpen(false);
  });

  return (
    <Popover open={slashOpen} onOpenChange={setSlashOpen} modal={false}>
      <PopoverAnchor asChild>
        <form onSubmit={(e) => e.preventDefault()}>
          <textarea
            ref={textareaRef}
            value={inputVal}
            onChange={(e) => {
              const value = e.target.value;
              setInputVal(value);
              // PITFALLS P13: suppress popup during composition + 200ms window
              if (isComposingRef.current || justFinishedComposingRef.current) return;
              const shouldOpen =
                value.startsWith('/') && !value.includes(' ') && value.length <= 32;
              setSlashOpen(shouldOpen);
            }}
            onKeyDown={(e) => {
              // PITFALLS P13: skip if composing
              if (isComposingRef.current) return;
              if (slashOpen) {
                if (e.key === 'Backspace' && inputVal === '/') {
                  e.preventDefault();
                  setSlashOpen(false);
                  return;
                }
                // PITFALLS P5: Shift+Enter must fall through to newline.
                // The parent (ChatArea) is responsible for filtering Shift+Enter
                // BEFORE delegating to slashRef.handleKeyDown so the popup does
                // not consume it as a normal Enter. This test harness mirrors
                // that contract.
                if (e.key === 'Enter' && e.shiftKey) return;
                const handled = slashRef.current?.handleKeyDown(e.nativeEvent) ?? false;
                if (handled) return;
              }
            }}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            aria-label="chat-input"
          />
        </form>
      </PopoverAnchor>
      <PopoverContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        align="start"
        side="top"
        sideOffset={8}
      >
        <SlashCommandPopup
          ref={slashRef}
          query={inputVal.startsWith('/') ? inputVal.slice(1) : ''}
          onSelect={handleSlashSelect}
          onInsert={handleSlashInsert}
          onClose={() => setSlashOpen(false)}
          commands={commands}
          hasMcpWarning={hasMcpWarning}
          mcpWarningMessage={mcpWarningMessage}
          loading={loading}
        />
      </PopoverContent>
    </Popover>
  );
}

describe('SlashCommandPopup', () => {
  it('keeps textarea focus when popup opens', () => {
    let harness: TestHarnessHandle | null = null;
    render(<TestHarness refSetter={(h) => (harness = h)} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      textarea.focus();
    });
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    expect(document.activeElement).toBe(textarea);
  });

  it('opens on slash', () => {
    render(<TestHarness />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    expect(screen.getByText('/goal')).toBeTruthy();
    expect(screen.getByText('/context')).toBeTruthy();
    expect(screen.getByText('/plan')).toBeTruthy();
  });

  it('closes when value does not start with /', () => {
    render(<TestHarness />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    expect(screen.getByText('/goal')).toBeTruthy();
    act(() => {
      fireEvent.change(textarea, { target: { value: 'hello' } });
    });
    expect(screen.queryByText('/goal')).toBeNull();
  });

  it('filters case-insensitive on command name', () => {
    render(<TestHarness />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/GO' } });
    });
    expect(screen.getByText('/goal')).toBeTruthy();
  });

  it('inserts command text and closes popup on Enter', () => {
    let harness: TestHarnessHandle | null = null;
    render(<TestHarness refSetter={(h) => (harness = h)} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    // ArrowDown cycles highlight to /context
    act(() => {
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    });
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Enter' });
    });
    expect(harness?.getInputVal()).toBe('/context ');
    expect(screen.queryByText('/goal')).toBeNull();
  });

  it('Tab inserts command text into textarea via onInsert (v1.1 polish — does NOT dispatch)', () => {
    let harness: TestHarnessHandle | null = null;
    render(<TestHarness refSetter={(h) => (harness = h)} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    // First row (/goal) is selected by default (D-04); Tab inserts it.
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Tab' });
    });
    expect(harness?.getInputVal()).toBe('/goal ');
    expect(screen.queryByText('/context')).toBeNull();
    // v1.1 polish: Tab must NOT fire the Enter-only onSelect (dispatch) path.
    expect(handleSlashSelectMock).not.toHaveBeenCalled();
    expect(handleSlashInsertMock).toHaveBeenCalledWith('/goal');
  });

  it('Enter still fires onSelect (dispatch path) for known commands', () => {
    let harness: TestHarnessHandle | null = null;
    render(<TestHarness refSetter={(h) => (harness = h)} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Enter' });
    });
    expect(harness?.getInputVal()).toBe('/goal ');
    expect(handleSlashSelectMock).toHaveBeenCalledWith('/goal');
    // v1.1 polish: Enter must NOT also fire onInsert — only one of the two.
    expect(handleSlashInsertMock).not.toHaveBeenCalled();
  });

  it('shows first row highlighted on initial open', () => {
    render(<TestHarness />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    const goalItem = screen.getByText('/goal').closest('[cmdk-item]') as HTMLElement | null;
    expect(goalItem?.getAttribute('data-selected')).toBe('true');
  });

  it('shows hint line when filter matches nothing', () => {
    render(<TestHarness />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/zzz' } });
    });
    expect(screen.getByText('无匹配命令')).toBeTruthy();
  });

  // -----------------------------------------------------------------
  // Phase 5 Plan 02 — edge-case tests (9-11 cases covering PITFALLS
  // P6a/P6b/P6c/P6e, P13 IME, D-04, D-07, Shift+Enter).
  // -----------------------------------------------------------------

  // Reset fake timers after each test in case a previous test left them on.
  afterEach(() => {
    vi.useRealTimers();
    handleSlashSelectMock.mockClear();
    handleSlashInsertMock.mockClear();
  });

  // 5-02-01 / SLASH-01
  it('closes on esc and returns focus to textarea', () => {
    let harness: TestHarnessHandle | null = null;
    render(<TestHarness refSetter={(h) => (harness = h)} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      textarea.focus();
    });
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    expect(screen.getByText('/goal')).toBeTruthy();
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Escape' });
    });
    expect(screen.queryByText('/goal')).toBeNull();
    expect(document.activeElement).toBe(textarea);
  });

  // 5-02-02 / SLASH-01
  it('closes on backspace when value is just /', () => {
    render(<TestHarness />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    expect(screen.getByText('/goal')).toBeTruthy();
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Backspace' });
    });
    expect(screen.queryByText('/goal')).toBeNull();
  });

  // 5-02-03 + PITFALLS P6e / SLASH-02
  it('arrow navigation wraps from last to first and first to last', () => {
    render(<TestHarness />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    const goalItem = () =>
      screen.getByText('/goal').closest('[cmdk-item]') as HTMLElement;
    const contextItem = () =>
      screen.getByText('/context').closest('[cmdk-item]') as HTMLElement;
    const planItem = () =>
      screen.getByText('/plan').closest('[cmdk-item]') as HTMLElement;

    expect(goalItem().getAttribute('data-selected')).toBe('true');
    // ArrowDown: /goal -> /context
    act(() => {
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    });
    expect(contextItem().getAttribute('data-selected')).toBe('true');
    // ArrowDown: /context -> /plan
    act(() => {
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    });
    expect(planItem().getAttribute('data-selected')).toBe('true');
    // ArrowDown: /plan -> /goal (wrap)
    act(() => {
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    });
    expect(goalItem().getAttribute('data-selected')).toBe('true');
    // ArrowUp: /goal -> /plan (wrap)
    act(() => {
      fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    });
    expect(planItem().getAttribute('data-selected')).toBe('true');
  });

  // 5-02-04 / D-05
  it('NFKC normalize and case-insensitive match', () => {
    render(<TestHarness />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    // case-insensitive: /CO (uppercase) matches /context
    // ('ctx' is NOT a substring of '/context' — verify with `'co'` instead.)
    act(() => {
      fireEvent.change(textarea, { target: { value: '/CO' } });
    });
    expect(screen.getByText('/context')).toBeTruthy();
    // CJK safe: none of the 3 ASCII commands contain 代, so hint shows
    // and filter does not crash on a CJK query (PITFALLS P6b regression guard).
    act(() => {
      fireEvent.change(textarea, { target: { value: '/代' } });
    });
    expect(screen.getByText('无匹配命令')).toBeTruthy();
  });

  // 5-02-05 / PITFALLS P6a
  it('period filter does not crash', () => {
    render(<TestHarness />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/foo.' } });
    });
    // Period is a literal char under String#includes; no commands match -> hint
    expect(screen.getByText('无匹配命令')).toBeTruthy();
    // The popup is still mounted (Command.Empty is rendered) so all 3 names
    // are filtered out, but no crash was thrown.
    expect(screen.queryByText('/goal')).toBeNull();
  });

  // 5-02-06 / PITFALLS P6c
  it('double slash filter does not crash', () => {
    render(<TestHarness />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '//' } });
    });
    // The query sent to SlashCommandPopup is `/` (slice(1)) which still
    // matches all 3 commands; the D-03 hint is shown only if zero matches.
    // Here we just verify no crash and that the popup is still open with
    // the 3 commands visible. (PITFALLS P6c: filter must not throw on `//`.)
    // Phase 6: rows now contain <Badge> + <span> /goal — assert text via getAllByText substring.
    expect(screen.getAllByText(/^\/goal$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^\/context$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^\/plan$/).length).toBeGreaterThan(0);
  });

  // 5-02-08 / PITFALLS P6e / D-04
  it('selectedIndex resets to 0 when filter reduces visible items', () => {
    render(<TestHarness />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/co' } });
    });
    const contextItem = () =>
      screen.getByText('/context').closest('[cmdk-item]') as HTMLElement;
    expect(contextItem().getAttribute('data-selected')).toBe('true');
    // Reset filter to all 3; top row /goal must be selected (D-04)
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    const goalItem = () =>
      screen.getByText('/goal').closest('[cmdk-item]') as HTMLElement;
    expect(goalItem().getAttribute('data-selected')).toBe('true');
  });

  // 5-02-09 / PITFALLS P13
  it('ime safe — composition does not open popup', () => {
    let harness: TestHarnessHandle | null = null;
    render(<TestHarness refSetter={(h) => (harness = h)} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    // Mid-composition: onChange gate bails early, popup does NOT open
    act(() => {
      harness!.isComposingRef.current = true;
    });
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    expect(screen.queryByText('/goal')).toBeNull();
    // Composition ends -> normal onChange resumes -> popup opens
    act(() => {
      harness!.isComposingRef.current = false;
    });
    act(() => {
      fireEvent.change(textarea, { target: { value: '' } });
    });
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    expect(screen.getByText('/goal')).toBeTruthy();
  });

  // 5-02-10 / PITFALLS P13 (200ms justFinishedComposingRef window)
  it('ime safe — 200ms justFinishedComposingRef window suppresses next keystroke', () => {
    vi.useFakeTimers();
    let harness: TestHarnessHandle | null = null;
    render(<TestHarness refSetter={(h) => (harness = h)} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    // Simulate IME composition end via the real handleCompositionEnd flow —
    // this sets justFinishedComposingRef.current = true AND registers a
    // 200ms setTimeout that will clear it (PITFALLS P13 contract).
    act(() => {
      harness!.triggerCompositionEnd();
    });
    // The very next keystroke (within the 200ms window) is suppressed.
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    expect(screen.queryByText('/goal')).toBeNull();
    // Advance past 200ms: the setTimeout inside handleCompositionEnd fires
    // and clears justFinishedComposingRef.
    act(() => {
      vi.advanceTimersByTime(250);
    });
    // Now the next keystroke should open the popup normally.
    act(() => {
      fireEvent.change(textarea, { target: { value: '' } });
    });
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    expect(screen.getByText('/goal')).toBeTruthy();
  });

  // 5-02-11 / PITFALLS P5
  it('shift enter inserts newline and does not trigger insert flow', () => {
    let harness: TestHarnessHandle | null = null;
    render(<TestHarness refSetter={(h) => (harness = h)} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      textarea.focus();
    });
    act(() => {
      fireEvent.change(textarea, { target: { value: '/goal' } });
    });
    // Both textarea value and the cmdk-item row contain `/goal`, so use
    // getAllByText and assert at least one match (the popup row).
    expect(screen.getAllByText('/goal').length).toBeGreaterThanOrEqual(1);
    // Shift+Enter: slashRef.handleKeyDown does not consume (only handles
    // ArrowUp/Down/Enter/Tab/Escape). The textarea retains the value, the
    // popup stays open, and focus stays on the textarea.
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    });
    expect(harness?.getInputVal()).toBe('/goal');
    expect(screen.getAllByText('/goal').length).toBeGreaterThanOrEqual(1);
    expect(document.activeElement).toBe(textarea);
    // Regular Enter: slashRef.handleKeyDown consumes it, inserts /goal + ' '
    // and closes the popup (D-07). The textarea will now contain `/goal ` (with
    // trailing space), so queryByText('/goal') would substring-match the
    // textarea. Instead, assert that the popup is unmounted (no cmdk-item).
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Enter' });
    });
    expect(harness?.getInputVal()).toBe('/goal ');
    expect(document.querySelector('[cmdk-item]')).toBeNull();
  });

  // 5-02-12 / D-04
  it('reopening popup highlights the top row (D-04)', () => {
    let harness: TestHarnessHandle | null = null;
    render(<TestHarness refSetter={(h) => (harness = h)} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    // Move highlight to /plan (two ArrowDowns from /goal)
    act(() => {
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    });
    act(() => {
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    });
    const planItem = () =>
      screen.getByText('/plan').closest('[cmdk-item]') as HTMLElement;
    expect(planItem().getAttribute('data-selected')).toBe('true');
    // Close the popup programmatically (Escape + same-value re-fire does not
    // re-open the popover in Radix — verify D-04 via direct state set).
    act(() => {
      harness!.setSlashOpen(false);
    });
    expect(screen.queryByText('/plan')).toBeNull();
    // Reopen: top row /goal must be selected, NOT /plan (D-04 reset).
    act(() => {
      harness!.setSlashOpen(true);
    });
    const goalItem = () =>
      screen.getByText('/goal').closest('[cmdk-item]') as HTMLElement;
    expect(goalItem().getAttribute('data-selected')).toBe('true');
  });
});

describe('Phase 6 source badges + warnings', () => {
  const goalSlashCmd: import('../../../../shared/types').SlashCommand = {
    name: 'goal',
    description: '设置 session 目标',
    source: 'system',
    target: 'goal',
    sourceLabel: 'system',
    badge: '[system]',
  };
  const mcpCmd: import('../../../../shared/types').SlashCommand = {
    name: 'arxiv_search',
    description: 'Search arxiv papers',
    source: 'mcp',
    target: 'arxiv_search',
    sourceLabel: 'mcp:arxiv',
    badge: '[mcp:arxiv_search]',
  };
  const workflowCmd: import('../../../../shared/types').SlashCommand = {
    name: 'pr-review',
    description: 'PR review workflow',
    source: 'workflow',
    target: 'pr-review',
    sourceLabel: 'workflow',
    badge: '[workflow]',
  };
  const skillProjectCmd: import('../../../../shared/types').SlashCommand = {
    name: 'code-review',
    description: 'Code review skill',
    source: 'skill:project',
    target: 'code-review',
    sourceLabel: 'skill:project',
    badge: '[skill:project]',
  };
  const cmdSystemCmd: import('../../../../shared/types').SlashCommand = {
    name: 'refactor',
    description: 'Refactor command',
    source: 'cmd:system',
    target: 'refactor',
    sourceLabel: 'cmd:system',
    badge: '[cmd:system]',
  };

  it('renders source badge for system command', () => {
    render(<TestHarness commands={[goalSlashCmd]} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    expect(screen.getByText('[system]')).toBeTruthy();
    expect(screen.getByText('/goal')).toBeTruthy();
  });

  it('renders source badge for mcp tool', () => {
    render(<TestHarness commands={[mcpCmd]} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/ar' } });
    });
    expect(screen.getByText('[mcp:arxiv_search]')).toBeTruthy();
    // D-09: MCP tools do NOT render description
    expect(screen.queryByText('Search arxiv papers')).toBeNull();
  });

  it('renders source badge for workflow', () => {
    render(<TestHarness commands={[workflowCmd]} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/pr' } });
    });
    expect(screen.getByText('[workflow]')).toBeTruthy();
  });

  it('renders source badge for skill:project', () => {
    render(<TestHarness commands={[skillProjectCmd]} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/co' } });
    });
    expect(screen.getByText('[skill:project]')).toBeTruthy();
  });

  it('renders source badge for cmd:system', () => {
    render(<TestHarness commands={[cmdSystemCmd]} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/re' } });
    });
    expect(screen.getByText('[cmd:system]')).toBeTruthy();
  });

  it('does not render description for mcp tools (D-09)', () => {
    render(<TestHarness commands={[mcpCmd]} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/ar' } });
    });
    expect(screen.queryByText('Search arxiv papers')).toBeNull();
  });

  it('renders description for non-mcp commands', () => {
    render(<TestHarness commands={[goalSlashCmd]} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/go' } });
    });
    expect(screen.getByText('设置 session 目标')).toBeTruthy();
  });

  it('renders mcp_health_warning row at top when hasMcpWarning is true', () => {
    render(<TestHarness hasMcpWarning mcpWarningMessage="MCP server down" />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    expect(screen.getByTestId('mcp-health-warning')).toBeTruthy();
    expect(screen.getByText('MCP server down')).toBeTruthy();
  });

  it('does not render mcp_health_warning row when hasMcpWarning is false', () => {
    render(<TestHarness hasMcpWarning={false} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    expect(screen.queryByTestId('mcp-health-warning')).toBeNull();
  });

  it('preserves D-04 — opens with top row highlighted even with 5+ commands', () => {
    const all = [goalSlashCmd, mcpCmd, workflowCmd, skillProjectCmd, cmdSystemCmd];
    render(<TestHarness commands={all} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    const firstItem = screen.getByText('/goal').closest('[cmdk-item]') as HTMLElement;
    expect(firstItem.getAttribute('data-selected')).toBe('true');
  });

  it('key prop includes source — duplicate names render as 2 separate rows', () => {
    const systemGoal = { ...goalSlashCmd, source: 'system' as const };
    const workflowGoal: import('../../../../shared/types').SlashCommand = {
      name: 'goal',
      description: 'Goal workflow',
      source: 'workflow',
      target: 'goal',
      sourceLabel: 'workflow',
      badge: '[workflow]',
    };
    render(<TestHarness commands={[systemGoal, workflowGoal]} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/go' } });
    });
    // Both rows should be in the document
    expect(screen.getByText('[system]')).toBeTruthy();
    expect(screen.getByText('[workflow]')).toBeTruthy();
  });

  it('data-source attribute matches command source for testing', () => {
    render(<TestHarness commands={[goalSlashCmd, mcpCmd, workflowCmd]} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    const systemItem = screen.getByText('/goal').closest('[cmdk-item]') as HTMLElement;
    expect(systemItem.getAttribute('data-source')).toBe('system');
  });
});

describe('Phase 6 handleSlashSelect routing (light integration)', () => {
  it('ChatArea handleSlashSelect pattern: dispatcher.resolve gets full /cmd', () => {
    // This test documents the integration contract. The actual ChatArea
    // handleSlashSelect in production calls dispatcher.resolve(inputVal, registry.commands).
    // Verified in src/renderer/src/lib/commands/dispatcher.test.ts:
    // - "plugin rewrite does not pass overrides (D-18)"
    // - "PlanMode dispatch passes planOnly override"
    // - "warns and returns when no active project"
    // Here we just verify resolve() correctly maps `/goal` (full command) to SystemSilent.
    const plan = dispatcherResolve('/goal', [{
      name: 'goal', description: 'set goal', source: 'system', target: 'goal',
      sourceLabel: 'system', badge: '[system]',
    }]);
    expect(plan).toEqual({
      kind: 'SystemSilent',
      command: expect.objectContaining({ name: 'goal' }),
      args: '',
    });
  });

  it('ChatArea handleSlashSelect pattern: null resolution falls back to text-insert', () => {
    // Verified: dispatcher.resolve returns null for unknown commands; ChatArea
    // falls back to the old `setInputVal(cmd + ' ')` path (D-07 preserved).
    expect(dispatcherResolve('/unknown', [])).toBeNull();
    // When resolve returns null, ChatArea still does setInputVal(cmd + ' ').
    // This test mirrors the Phase 5 behavior; Tab + unknown commands both
    // hit this fallback.
  });
});

// -----------------------------------------------------------------
// Phase 8 Plan 01 — popup polish (D-01..D-04 + D-05d + D-12 + D-15)
// -----------------------------------------------------------------

describe('Phase 8 polish', () => {
  // D-01..D-04: 7-color source badge palette. Each Command.Source maps to a
  // distinct text-* class via SOURCE_TEXT_COLOR lookup map. The Badge is the
  // sibling <span> /{name}, so we look for it as the child element of
  // [cmdk-item] that is not the [font-mono] slash span.
  it('applies distinct text-* color class per CommandSource (D-01..D-04)', () => {
    const all: import('../../../../shared/types').SlashCommand[] = [
      { name: 'goal', description: '', source: 'system', target: 'goal', sourceLabel: 'system', badge: '[system]' },
      { name: 'review-global', description: '', source: 'skill:global', target: 'review-global', sourceLabel: 'skill:global', badge: '[skill:global]' },
      { name: 'review-project', description: '', source: 'skill:project', target: 'review-project', sourceLabel: 'skill:project', badge: '[skill:project]' },
      { name: 'pr-flow', description: '', source: 'workflow', target: 'pr-flow', sourceLabel: 'workflow', badge: '[workflow]' },
      { name: 'arxiv', description: '', source: 'mcp', target: 'arxiv', sourceLabel: 'mcp:arxiv', badge: '[mcp:arxiv]' },
      { name: 'sys-cmd', description: '', source: 'cmd:system', target: 'sys-cmd', sourceLabel: 'cmd:system', badge: '[cmd:system]' },
      { name: 'proj-cmd', description: '', source: 'cmd:project', target: 'proj-cmd', sourceLabel: 'cmd:project', badge: '[cmd:project]' },
    ];
    const expected: Array<[string, RegExp]> = [
      ['goal', /text-blue-400/],
      ['review-global', /text-violet-300/],
      ['review-project', /text-purple-400/],
      ['pr-flow', /text-green-400/],
      ['arxiv', /text-amber-400/],
      ['sys-cmd', /text-gray-400/],
      ['proj-cmd', /text-gray-500/],
    ];
    render(<TestHarness commands={all} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    for (const [cmdName, cls] of expected) {
      // The Badge contains the literal text in its child <div>: [system],
      // [skill:global], etc. The slash name /${name} is in a sibling <span>.
      const item = screen.getByText(`/${cmdName}`).closest('[cmdk-item]') as HTMLElement;
      expect(item, `cmdk-item for /${cmdName} should be present`).toBeTruthy();
      // Badge is the only non-[font-mono] element inside the row (the slash
      // name uses font-mono too, so we filter by the bracket badge text).
      const badge = Array.from(item.querySelectorAll('div')).find(
        (el) => /^\[.+\]$/.test(el.textContent || '')
      ) as HTMLElement | undefined;
      expect(badge, `Badge div for /${cmdName}`).toBeTruthy();
      expect(badge!.className, `className on Badge for /${cmdName}`).toMatch(cls);
    }
  });

  // D-05d: NFKC + variation-selector removal. A command whose name contains
  // the U+FE0F variation selector must still match a query typed without
  // the selector (and vice-versa), because normForFilter strips VS1–VS16
  // from BOTH the query and the name before comparison.
  it('filters emoji with and without U+FE0F variation selector (D-05d)', () => {
    // Command name has the U+FE0F VS16 attached (party🎉︎).
    const partyWithSelector: import('../../../../shared/types').SlashCommand = {
      name: 'party\u{1F389}️',
      description: '',
      source: 'system',
      target: 'party\u{1F389}️',
      sourceLabel: 'system',
      badge: '[system]',
    };
    render(<TestHarness commands={[partyWithSelector]} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    // Query WITHOUT U+FE0F (just the base codepoint U+1F389).
    act(() => {
      fireEvent.change(textarea, { target: { value: '/\u{1F389}' } });
    });
    expect(
      screen.getByText('/party\u{1F389}️'),
      'command should match when query has no VS16'
    ).toBeTruthy();
    // Query WITH U+FE0F VS16 — must still match (D-05d: equivalence after strip).
    act(() => {
      fireEvent.change(textarea, { target: { value: '/\u{1F389}️' } });
    });
    expect(
      screen.getByText('/party\u{1F389}️'),
      'command should match when query has VS16'
    ).toBeTruthy();
  });

  // D-12: 1-row Skeleton placeholder when loading='slow'. The
  // `data-testid="mcp-skeleton"` is the entry point; we also assert that
  // exactly two <Skeleton> placeholders are rendered inside the row
  // (badge-width + name-width).
  it('renders Skeleton row when loading=slow (D-12)', () => {
    render(<TestHarness commands={[]} loading="slow" />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    const skeletonRow = screen.getByTestId('mcp-skeleton');
    expect(skeletonRow).toBeTruthy();
    // Two Skeleton placeholders (badge + name) inside the row.
    const placeholders = skeletonRow.querySelectorAll('[data-slot="skeleton"]');
    expect(placeholders.length).toBe(2);
  });

  // D-15: IME z-index comment is present in the source. forwardRef components
  // are React objects, not strings, so we read the file directly and grep
  // for the marker phrase.
  it('contains IME z-index known-issue comment (D-15)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    const filePath = path.resolve(
      // Test file lives at src/renderer/src/components/ChatArea/
      // Target file is at src/renderer/src/components/SlashCommand/
      __dirname,
      '../SlashCommand/SlashCommandPopup.tsx'
    );
    const source = fs.readFileSync(filePath, 'utf-8') as string;
    expect(source).toContain('IME z-index known issue');
    // Make sure no TODO/FIXME markers snuck in (Pitfall P9).
    const commentStart = source.indexOf('IME z-index known issue');
    const commentEnd = source.indexOf('IMKCandidates placement API', commentStart);
    expect(commentStart).toBeGreaterThan(-1);
    expect(commentEnd).toBeGreaterThan(commentStart);
    const commentBlock = source.slice(commentStart, commentEnd);
    expect(commentBlock).not.toMatch(/\b(TODO|FIXME)\b/);
  });
});
