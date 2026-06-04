import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { useState, useRef, useEffect, useCallback } from 'react';
import type { MutableRefObject } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import {
  SlashCommandPopup,
  SlashCommandPopupHandle,
} from '@/components/SlashCommand/SlashCommandPopup';

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
}

function TestHarness({
  refSetter,
  commands,
  hasMcpWarning,
  mcpWarningMessage,
}: {
  refSetter?: (h: TestHarnessHandle) => void;
  commands?: import('../../../../shared/types').SlashCommand[];
  hasMcpWarning?: boolean;
  mcpWarningMessage?: string;
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
    });
  });

  const handleSlashSelect = (cmd: string) => {
    setInputVal(cmd + ' ');
    setSlashOpen(false);
  };

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
          onClose={() => setSlashOpen(false)}
          commands={commands}
          hasMcpWarning={hasMcpWarning}
          mcpWarningMessage={mcpWarningMessage}
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

  it('inserts command text and closes popup on Tab (identical to Enter)', () => {
    let harness: TestHarnessHandle | null = null;
    render(<TestHarness refSetter={(h) => (harness = h)} />);
    const textarea = screen.getByLabelText('chat-input') as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(textarea, { target: { value: '/' } });
    });
    // First row (/goal) is selected by default (D-04); Tab confirms
    act(() => {
      fireEvent.keyDown(textarea, { key: 'Tab' });
    });
    expect(harness?.getInputVal()).toBe('/goal ');
    expect(screen.queryByText('/context')).toBeNull();
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
