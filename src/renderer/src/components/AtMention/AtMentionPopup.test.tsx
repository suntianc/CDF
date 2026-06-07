// Phase 08.3 — A-02 / A-03 / A-04 / F-03
//
// AtMentionPopup mirrors the 08.1 <SlashCommandPopup> pattern:
//   - forwardRef + useImperativeHandle handleKeyDown
//   - cmdk <Command.List> + <Command.Item> + <Command.Empty>
//   - NFKC + variation-selector filter via normForFilter (shared from pathUtils)
//   - isDir inferred from path.endsWith('/')
//
// Differences from <SlashCommandPopup>:
//   - props.candidates is `string[]` (not `SlashCommand[]`); kind inferred
//   - props.onSelect receives a raw path (no leading `/` to prepend)
//   - Tab inserts the selected path (same as Enter — no dispatch concept)
//   - Empty state is "未找到匹配文件" (F-03)
//
// jsdom polyfills: ResizeObserver + Element.prototype.scrollIntoView
// (PITFALL P8-9: cmdk portal needs these in jsdom).

import { describe, expect, it, vi, beforeAll } from 'vitest';
import { createRef } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { AtMentionPopup, type AtMentionPopupHandle } from './AtMentionPopup';

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

// PITFALL P8-9: cmdk uses Radix Popover portal which doesn't mount reliably
// in jsdom. Stub cmdk so we can assert on its API surface directly.
vi.mock('cmdk', () => {
  const Command = ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="cmdk">{children}</div>
  );
  Command.List = ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="cmdk-list">{children}</div>
  );
  Command.Item = ({
    children,
    value,
    onSelect,
    className,
    ...rest
  }: {
    children?: React.ReactNode;
    value: string;
    onSelect?: (v: string) => void;
    className?: string;
    [key: string]: unknown;
  }) => {
    // Strip data-testid from rest so the value-derived testid takes effect
    // (the real cmdk passes data-testid through, but in the mock we want
    // per-item selectors that include the path).
    const { 'data-testid': _dropped, ...restNoTestid } = rest as Record<string, unknown>;
    return (
      <div
        data-testid={`item-${value}`}
        className={className}
        onClick={() => onSelect?.(value)}
        {...restNoTestid}
      >
        {children}
      </div>
    );
  };
  Command.Empty = ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="cmdk-empty">{children}</div>
  );
  return { Command };
});

vi.mock('lucide-react', () => {
  const sentinel = (testId: string) => {
    const Cmp = (props: { className?: string; 'aria-hidden'?: boolean | string } & Record<string, unknown>) => (
      <svg data-testid={testId} {...(props as React.SVGAttributes<SVGElement>)} />
    );
    Cmp.displayName = `MockIcon(${testId})`;
    return Cmp;
  };
  return { File: sentinel('file'), Folder: sentinel('folder') };
});

describe('AtMentionPopup (Phase 08.3 — A-02 / A-03 / A-04 / F-03)', () => {
  // Test 1 — renders all candidates as Command.Items
  it('renders all candidates as Command.Items', () => {
    const { getByTestId } = render(
      <AtMentionPopup
        query=""
        candidates={['src/foo.ts', 'docs/']}
        truncated={false}
        loading={false}
        onSelect={() => {}}
        onClose={() => {}}
      />
    );
    expect(getByTestId('item-src/foo.ts')).toBeTruthy();
    expect(getByTestId('item-docs/')).toBeTruthy();
  });

  // Test 2 — infers dir kind from trailing slash
  it('infers dir kind from trailing slash', () => {
    const { getByTestId: g1 } = render(
      <AtMentionPopup
        query=""
        candidates={['docs/']}
        truncated={false}
        loading={false}
        onSelect={() => {}}
        onClose={() => {}}
      />
    );
    expect(g1('item-docs/').getAttribute('data-at-mention-kind')).toBe('dir');

    const { getByTestId: g2 } = render(
      <AtMentionPopup
        query=""
        candidates={['src/foo.ts']}
        truncated={false}
        loading={false}
        onSelect={() => {}}
        onClose={() => {}}
      />
    );
    expect(g2('item-src/foo.ts').getAttribute('data-at-mention-kind')).toBe('file');
  });

  // Test 3 — filters by NFKC-normalized substring (A-03).
  // We use the fi ligature (U+FB01) — NFKC compatibility decomposition
  // splits it into "fi". This is the actual character class that NFKC
  // normalization affects in real-world file paths.
  it('filters by NFKC-normalized substring (A-03)', () => {
    // "ﬁle.ts" (with ligature) normalizes to "file.ts" via NFKC
    // The query "FIL" normalizes to "fil" which is a substring of "file.ts"
    const { getByTestId, queryByTestId } = render(
      <AtMentionPopup
        query="FIL"
        candidates={['ﬁle.ts', 'cake.ts']}
        truncated={false}
        loading={false}
        onSelect={() => {}}
        onClose={() => {}}
      />
    );
    // 'FIL' normalizes to 'fil' — substring of 'file.ts' (the normalized ligature) — match
    expect(getByTestId('item-ﬁle.ts')).toBeTruthy();
    // 'cake.ts' does NOT contain 'fil' — no match
    expect(queryByTestId('item-cake.ts')).toBeNull();
  });

  // Test 4 — shows the '未找到匹配文件' empty state (F-03)
  it('shows the 未找到匹配文件 empty state (F-03)', () => {
    const { getByTestId } = render(
      <AtMentionPopup
        query="zzz_no_match"
        candidates={['src/foo.ts']}
        truncated={false}
        loading={false}
        onSelect={() => {}}
        onClose={() => {}}
      />
    );
    const empty = getByTestId('cmdk-empty');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toBe('未找到匹配文件');
  });

  // Test 5 — click on an item triggers onSelect with the path
  it('click on an item triggers onSelect with the path', () => {
    const onSelect = vi.fn();
    const { getByTestId } = render(
      <AtMentionPopup
        query=""
        candidates={['src/foo.ts', 'docs/']}
        truncated={false}
        loading={false}
        onSelect={onSelect}
        onClose={() => {}}
      />
    );
    fireEvent.click(getByTestId('item-src/foo.ts'));
    expect(onSelect).toHaveBeenCalledWith('src/foo.ts');
  });

  // Test 6 — Enter key on the selected item triggers onSelect (A-04)
  it('Enter key on the selected item triggers onSelect (A-04)', () => {
    const onSelect = vi.fn();
    const ref = createRef<AtMentionPopupHandle>();
    render(
      <AtMentionPopup
        ref={ref}
        query=""
        candidates={['src/foo.ts', 'docs/']}
        truncated={false}
        loading={false}
        onSelect={onSelect}
        onClose={() => {}}
      />
    );
    // selectedValue defaults to first candidate 'src/foo.ts'
    const handled = ref.current?.handleKeyDown({
      key: 'Enter',
      preventDefault: () => {},
    } as unknown as KeyboardEvent);
    expect(handled).toBe(true);
    expect(onSelect).toHaveBeenCalledWith('src/foo.ts');
  });

  // Test 7 — Escape key triggers onClose (A-04)
  it('Escape key triggers onClose (A-04)', () => {
    const onClose = vi.fn();
    const ref = createRef<AtMentionPopupHandle>();
    render(
      <AtMentionPopup
        ref={ref}
        query=""
        candidates={['src/foo.ts']}
        truncated={false}
        loading={false}
        onSelect={() => {}}
        onClose={onClose}
      />
    );
    const handled = ref.current?.handleKeyDown({
      key: 'Escape',
      preventDefault: () => {},
    } as unknown as KeyboardEvent);
    expect(handled).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });
});
