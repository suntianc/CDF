// Phase 08.3 — C-03 MessageItem @-token rendering test
//
// Tests that MessageItem renders @relative/path substrings in historical
// message content as <AtToken> pills, matching the input overlay visual.
// Code blocks (backtick-wrapped text) are NOT tokenized — markdown code
// renders literally per Pitfall #7 (parser coexistence).
//
// lucide-react is mocked so each icon becomes a sentinel <svg data-testid="…">.

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MessageItem } from './MessageItem';

vi.mock('lucide-react', () => {
  const sentinel = (testId: string) => {
    const Cmp = (props: { className?: string; 'aria-hidden'?: boolean | string } & Record<string, unknown>) => (
      <svg data-testid={testId} {...(props as React.SVGAttributes<SVGElement>)} />
    );
    Cmp.displayName = `MockIcon(${testId})`;
    return Cmp;
  };
  return {
    File: sentinel('file'),
    Folder: sentinel('folder'),
    AlertTriangle: sentinel('alert-triangle'),
  };
});

const baseMessage = (content: string) => ({
  id: 'msg-1',
  role: 'user' as const,
  content,
  created_at: Date.now(),
  createdAt: new Date().toISOString(),
});

describe('MessageItem at-token rendering (Phase 08.3 — C-03)', () => {
  // Test 1: @path in plain message → <AtToken> rendered
  it('renders @path as <AtToken> in a plain message', () => {
    const { getByTestId, container } = render(
      <MessageItem
        message={baseMessage('see @src/foo.ts for details')}
        isLast={true}
        isStreaming={false}
      />
    );
    const token = getByTestId('history-at-token');
    expect(token).toBeTruthy();
    // The token should display the path as its monospace label
    expect(container.textContent).toContain('src/foo.ts');
  });

  // Test 2: @ inside backtick code block → NOT tokenized
  it('does NOT tokenize `@` inside code blocks', () => {
    const { queryByTestId } = render(
      <MessageItem
        message={baseMessage('try `@invalid` literal')}
        isLast={true}
        isStreaming={false}
      />
    );
    // The @invalid is inside backticks — should NOT become an AtToken pill
    expect(queryByTestId('history-at-token')).toBeNull();
  });

  // Test 3: multiple at tokens in same message
  it('renders multiple at tokens in the same message', () => {
    const { getAllByTestId } = render(
      <MessageItem
        message={baseMessage('@src/foo.ts and @docs/intro.md please')}
        isLast={true}
        isStreaming={false}
      />
    );
    const tokens = getAllByTestId('history-at-token');
    expect(tokens.length).toBe(2);
  });

  // Test 4: dir token (trailing slash) → kind="dir"
  it('renders dir tokens with trailing slash kind="dir"', () => {
    const { getByTestId } = render(
      <MessageItem
        message={baseMessage('check @src/components/ for more')}
        isLast={true}
        isStreaming={false}
      />
    );
    const token = getByTestId('history-at-token');
    expect(token).toBeTruthy();
    // The AtToken component sets data-at-token-kind={kind} — dir tokens have "dir"
    expect(token.getAttribute('data-at-token-kind')).toBe('dir');
  });
});
