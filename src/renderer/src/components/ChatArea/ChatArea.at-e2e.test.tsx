// Phase 08.3 — G-01 end-to-end at-mention integration test
//
// Full happy path: type @ → popup opens → select candidate → @path in input
// → Enter → sendMessage receives literal @path string (D-03: @ prefix
// preserved through to LLM, no file content expansion per D-02).
//
// This is a single high-value integration test that covers the entire
// @-mention user flow from typing to sending. It re-implements the
// relevant ChatArea logic in a TestHarness (mirrors SlashCommandPopup.test.tsx
// pattern) to keep the test focused on the at-mention flow without
// instantiating the full ChatArea component.

import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { useState, useRef, useEffect, useMemo } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AtToken } from '@/components/AtMention/AtToken';
import { useAtMentionStore, type AtMentionState } from '@/stores/atMentionStore';
import { parseAtTokens, type AtTokenSpan } from '@/lib/commands/pathUtils';

// jsdom polyfills (same as other at-trigger tests)
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

const mockListAtMentionCandidates = vi.fn();
const mockSendMessage = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  useAtMentionStore.getState().close();
  mockListAtMentionCandidates.mockResolvedValue({
    candidates: ['src/foo.ts', 'docs/intro.md'],
    truncated: false,
  });
  mockSendMessage.mockResolvedValue(undefined);
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
  // Phase 08.3 fix #11: remove the stubbed `window.electronAPI` so it
  // doesn't leak into other test files in the same vitest worker and
  // shadow the real preload bridge.
  delete (window as any).electronAPI;
});

interface E2EHarnessHandle {
  getInputVal: () => string;
  isComposingRef: React.MutableRefObject<boolean>;
}

function TestHarness({
  refSetter,
  currentProjectId,
}: {
  refSetter?: (h: E2EHarnessHandle) => void;
  currentProjectId: string;
}) {
  const [inputVal, setInputVal] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);

  const currentProjectRoot = currentProjectId;
  const parsedAtTokens = useMemo(() => parseAtTokens(inputVal), [inputVal]);

  // IPC fetch effect
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
          });
      }
    });
    return unsubscribe;
  }, [currentProjectId]);

  useEffect(() => {
    refSetter?.({
      getInputVal: () => inputVal,
      isComposingRef,
    });
  });

  // handleSend: mirrors ChatArea's sendMessage call (NO modifications)
  const handleSend = async () => {
    if (!inputVal.trim() || !currentProjectId) return;
    const value = inputVal;
    setInputVal('');
    await mockSendMessage(currentProjectId, value, {});
  };

  return (
    <div>
      <textarea
        ref={textareaRef}
        value={inputVal}
        onChange={(e) => {
          const value = e.target.value;
          setInputVal(value);
          if (isComposingRef.current) return;
          // At-mention trigger
          if (currentProjectRoot) {
            const cursor = e.target.selectionStart;
            const textBeforeCursor = value.slice(0, cursor);
            const atMatch = textBeforeCursor.match(/(?:^|\s)@(\S*)$/);
            if (atMatch) {
              const state = useAtMentionStore.getState();
              if (!state.isOpen) {
                state.open(cursor);
              } else {
                useAtMentionStore.setState({ cursorPos: cursor });
              }
              state.setQuery(atMatch[1]);
            } else {
              useAtMentionStore.getState().close();
            }
          } else {
            useAtMentionStore.getState().close();
          }
        }}
        onKeyDown={(e) => {
          if (isComposingRef.current) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        aria-label="e2e-input"
        data-testid="e2e-input"
      />
    </div>
  );
}

describe('end-to-end at-mention (Phase 08.3 — G-01)', () => {
  it('type @ → popup → select → @path in input → Enter → sendMessage receives literal @path', async () => {
    let harness: E2EHarnessHandle | null = null;
    render(
      <TestHarness
        refSetter={(h) => (harness = h)}
        currentProjectId="proj-1"
      />
    );
    const textarea = screen.getByLabelText('e2e-input') as HTMLTextAreaElement;

    // Step 1: type @ → popup opens
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '@' } });
    });
    expect(useAtMentionStore.getState().isOpen).toBe(true);
    expect(mockListAtMentionCandidates).toHaveBeenCalledWith('proj-1');

    // Step 2: type 'sr' so inputVal is @sr
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '@sr' } });
    });
    expect(useAtMentionStore.getState().query).toBe('sr');

    // Step 3: simulate selecting the first candidate
    // (onSelect callback from AtMentionPopup — mirrors ChatArea's onSelect)
    const selectedPath = 'src/foo.ts';
    const cursor = useAtMentionStore.getState().cursorPos;
    const textBeforeCursor = '@sr';
    const atCharIndex = textBeforeCursor.lastIndexOf('@');
    const newValue = '@sr'.slice(0, atCharIndex) + '@' + selectedPath + ' ' + '@sr'.slice(cursor);

    // Use a synthetic event to set the value (matching the production onSelect flow)
    await act(async () => {
      fireEvent.change(textarea, { target: { value: newValue } });
    });
    act(() => {
      useAtMentionStore.getState().close();
    });

    // Assert: inputVal has @ prefix + path + trailing space (D-03)
    expect(harness!.getInputVal()).toBe('@src/foo.ts ');

    // Step 4: type the rest of the message
    const fullMessage = '@src/foo.ts please fix it';
    await act(async () => {
      fireEvent.change(textarea, { target: { value: fullMessage } });
    });
    expect(harness!.getInputVal()).toBe(fullMessage);

    // Step 5: press Enter → sendMessage is called with the LITERAL @path
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter' });
    });
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    // The literal @path string with @ prefix is preserved (D-03)
    expect(mockSendMessage).toHaveBeenCalledWith('proj-1', fullMessage, {});

    // Step 6: input is cleared after send
    expect(harness!.getInputVal()).toBe('');

    // D-02 guard: no file-content IPC was called
    // (the IPC mock only has listAtMentionCandidates, not readFile)
    // We assert the only IPC call was the candidate fetch, not a file read
    const allMockCalls = mockListAtMentionCandidates.mock.calls;
    expect(allMockCalls.length).toBe(1);
  });
});
