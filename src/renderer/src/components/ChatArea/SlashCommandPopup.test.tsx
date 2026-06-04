import { describe, it, expect, beforeAll } from 'vitest';
import { useState, useRef, useEffect } from 'react';
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
}

function TestHarness({ refSetter }: { refSetter?: (h: TestHarnessHandle) => void }) {
  const [inputVal, setInputVal] = useState('');
  const [slashOpen, setSlashOpen] = useState(false);
  const slashRef = useRef<SlashCommandPopupHandle>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    refSetter?.({
      getInputVal: () => inputVal,
      focusTextarea: () => textareaRef.current?.focus(),
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
              const shouldOpen =
                value.startsWith('/') && !value.includes(' ') && value.length <= 32;
              setSlashOpen(shouldOpen);
            }}
            onKeyDown={(e) => {
              if (slashOpen) {
                if (e.key === 'Backspace' && inputVal === '/') {
                  e.preventDefault();
                  setSlashOpen(false);
                  return;
                }
                const handled = slashRef.current?.handleKeyDown(e.nativeEvent) ?? false;
                if (handled) return;
              }
            }}
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
});
