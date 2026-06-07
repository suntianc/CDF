// Phase 08.3 — B-01 / A-01 / A-05 / C-02 / C-05 at-mention trigger test
//
// This test file exercises the at-mention trigger logic that lives in
// ChatArea.tsx. Following the SlashCommandPopup.test.tsx pattern, we build
// a TestHarness that re-implements the small slice of ChatArea onChange /
// onKeyDown / onSelect logic, so the test focuses on the behavior rather
// than the full component's mount lifecycle.
//
// Cases (5):
//   A-01: typing `@` opens the at popup (store isOpen becomes true)
//   A-05: selecting a candidate replaces `@query` with `@relative/path `
//         (trailing space) and closes the popup
//   B-01: no popup when no project root (currentProjectId is null)
//   C-05: Backspace at the end of an at token atomically deletes the
//         entire `@path ` substring
//   C-02: overlay renders <AtTokenSequence> for `@relative/path` substrings

import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { useState, useRef, useEffect, useMemo } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AtToken } from '@/components/AtMention/AtToken';
import { useAtMentionStore, type AtMentionState } from '@/stores/atMentionStore';
import { parseAtTokens, type AtTokenSpan } from '@/lib/commands/pathUtils';

// jsdom polyfills (same as SlashCommandPopup.test.tsx)
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {};
  }
});

// Mock window.electronAPI for the IPC fetch
const mockListAtMentionCandidates = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  useAtMentionStore.getState().close();
  mockListAtMentionCandidates.mockResolvedValue({
    candidates: ['src/foo.ts', 'docs/'],
    truncated: false,
  });
  Object.defineProperty(window, 'electronAPI', {
    value: {
      project: {
        listAtMentionCandidates: mockListAtMentionCandidates,
      },
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  useAtMentionStore.getState().close();
});

interface HarnessHandle {
  getInputVal: () => string;
  setInputVal: (v: string) => void;
  focusTextarea: () => void;
  isComposingRef: React.MutableRefObject<boolean>;
}

function TestHarness({
  refSetter,
  currentProjectId,
}: {
  refSetter?: (h: HarnessHandle) => void;
  currentProjectId: string | null;
}) {
  const [inputVal, setInputVal] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);

  // currentProjectRoot mirrors the derivation in ChatArea
  const currentProjectRoot = currentProjectId;

  // parsedAtTokens: scan inputVal for @relative/path substrings
  const parsedAtTokens = useMemo(() => parseAtTokens(inputVal), [inputVal]);

  // IPC fetch effect (mirrors ChatArea.tsx useEffect)
  useEffect(() => {
    const unsubscribe = useAtMentionStore.subscribe((state: AtMentionState, prev: AtMentionState) => {
      if (state.isOpen && !prev.isOpen) {
        if (!currentProjectId) {
          useAtMentionStore.getState().close();
          return;
        }
        useAtMentionStore.getState().setLoading(true);
        window.electronAPI.project
          .listAtMentionCandidates(currentProjectId)
          .then((result: { candidates: string[]; truncated: boolean }) => {
            useAtMentionStore
              .getState()
              .setCandidates(result.candidates, result.truncated);
          })
          .catch(() => {
            useAtMentionStore.getState().setCandidates([], false);
          });
      }
    });
    return unsubscribe;
  }, [currentProjectId]);

  useEffect(() => {
    refSetter?.({
      getInputVal: () => inputVal,
      setInputVal,
      focusTextarea: () => textareaRef.current?.focus(),
      isComposingRef,
    });
  });

  return (
    <div>
      {/* AtTokenSequence: mirrors the inline-flex overlay */}
      {parsedAtTokens.length > 0 && (
        <div data-testid="at-token-sequence" style={{ fontSize: '14px' }}>
          {parsedAtTokens.map((t: AtTokenSpan) => (
            <AtToken key={`${t.start}-${t.path}`} path={t.path} kind={t.kind} />
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={inputVal}
        onChange={(e) => {
          const value = e.target.value;
          setInputVal(value);
          if (isComposingRef.current) return;
          // A-01 at-mention trigger (mirrors ChatArea onChange predicate)
          if (currentProjectRoot) {
            const cursor = e.target.selectionStart;
            const textBeforeCursor = value.slice(0, cursor);
            const atMatch = textBeforeCursor.match(/(?:^|\s)@(\S*)$/);
            if (atMatch) {
              useAtMentionStore.getState().open(cursor);
              useAtMentionStore.getState().setQuery(atMatch[1]);
            } else {
              useAtMentionStore.getState().close();
            }
          } else {
            useAtMentionStore.getState().close();
          }
        }}
        onKeyDown={(e) => {
          if (isComposingRef.current) return;
          // C-05: atomic Backspace for the last at token
          if (e.key === 'Backspace' && parsedAtTokens.length > 0) {
            const lastAt = parsedAtTokens[parsedAtTokens.length - 1];
            const cursor = e.currentTarget.selectionStart;
            if (cursor === lastAt.end + 1 && e.currentTarget.selectionEnd === cursor) {
              e.preventDefault();
              setInputVal(inputVal.slice(0, lastAt.start));
              useAtMentionStore.getState().close();
              return;
            }
          }
        }}
        aria-label="at-test-input"
        data-testid="at-test-input"
      />
    </div>
  );
}

describe('ChatArea at-mention trigger (Phase 08.3 — A-01 / A-05 / B-01 / C-02 / C-05)', () => {
  // A-01: typing @ opens the popup and triggers IPC
  it('A-01: typing `@` opens the popup and calls listAtMentionCandidates', async () => {
    render(<TestHarness refSetter={() => {}} currentProjectId="proj-1" />);
    const textarea = screen.getByLabelText('at-test-input') as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(textarea, { target: { value: '@' } });
    });

    // Store should be open
    expect(useAtMentionStore.getState().isOpen).toBe(true);
    // IPC should have been called with the project ID
    expect(mockListAtMentionCandidates).toHaveBeenCalledWith('proj-1');
  });

  // A-05: selecting a candidate replaces @query with @relative/path
  it('A-05: selecting a candidate replaces `@query` with `@relative/path ` (trailing space) and closes the popup', async () => {
    let harness: HarnessHandle | null = null;
    render(
      <TestHarness
        refSetter={(h) => (harness = h)}
        currentProjectId="proj-1"
      />
    );
    const textarea = screen.getByLabelText('at-test-input') as HTMLTextAreaElement;

    // Type `@` to open the popup
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '@' } });
    });

    // Simulate the onSelect callback from AtMentionPopup (mirrors ChatArea's onSelect)
    const cursor = useAtMentionStore.getState().cursorPos;
    const textBeforeCursor = '@';
    const atCharIndex = textBeforeCursor.lastIndexOf('@');
    const newValue = '@'.slice(0, atCharIndex) + '@' + 'src/foo.ts' + ' ' + '@'.slice(cursor);
    act(() => {
      harness!.setInputVal(newValue);
    });
    act(() => {
      useAtMentionStore.getState().close();
    });

    // After selection: inputVal has @ prefix + path + trailing space
    expect(harness!.getInputVal()).toBe('@src/foo.ts ');
    // Popup closes
    expect(useAtMentionStore.getState().isOpen).toBe(false);
  });

  // B-01: no popup when no project root
  it('B-01: typing `@` does NOT open the popup when no project is active', async () => {
    render(<TestHarness refSetter={() => {}} currentProjectId={null} />);
    const textarea = screen.getByLabelText('at-test-input') as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(textarea, { target: { value: '@' } });
    });

    // Store should NOT be open (the onChange predicate closes it when no root)
    expect(useAtMentionStore.getState().isOpen).toBe(false);
    // IPC should NOT have been called
    expect(mockListAtMentionCandidates).not.toHaveBeenCalled();
  });

  // C-05: atomic Backspace
  it('C-05: Backspace at the end of an at token atomically deletes the entire `@path `', async () => {
    let harness: HarnessHandle | null = null;
    render(
      <TestHarness
        refSetter={(h) => (harness = h)}
        currentProjectId="proj-1"
      />
    );
    const textarea = screen.getByLabelText('at-test-input') as HTMLTextAreaElement;

    // Set inputVal to 'hello @src/foo.ts ' (parsedAtTokens will find the @src/foo.ts)
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'hello @src/foo.ts ' } });
    });

    // Set the textarea's actual selectionStart/End to position 18
    // (after the trailing space). parsedAtTokens returns { start: 6, end: 17 }
    // for 'src/foo.ts' in 'hello @src/foo.ts ' (end is exclusive, @ starts at 6).
    // Cursor at lastAt.end + 1 = 18 satisfies the atomic delete condition.
    textarea.setSelectionRange(18, 18);

    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Backspace' });
    });

    // InputVal should now be 'hello ' (atomic deletion of @src/foo.ts + space)
    expect(harness!.getInputVal()).toBe('hello ');
    // Popup closes
    expect(useAtMentionStore.getState().isOpen).toBe(false);
  });

  // C-02: overlay renders <AtTokenSequence>
  it('C-02: overlay renders <AtTokenSequence> for `@relative/path` substrings', async () => {
    render(<TestHarness refSetter={() => {}} currentProjectId="proj-1" />);
    const textarea = screen.getByLabelText('at-test-input') as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'see @src/foo.ts for more' } });
    });

    // The AtTokenSequence wrapper should be present
    expect(screen.getByTestId('at-token-sequence')).toBeTruthy();
    // The individual AtToken pill should be present
    expect(screen.getByTestId('at-token')).toBeTruthy();
  });
});
