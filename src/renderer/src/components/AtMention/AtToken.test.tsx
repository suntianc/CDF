// Phase 08.3 — A-02 / C-01 / C-04 / C-06 / F-02
//
// AtToken is the inline visual pill rendered by ChatArea's overlay (Plan 03)
// for `@relative/path` references. It is a pure presentational component that:
//   - renders a File or Folder lucide icon based on `kind`
//   - renders the path as a monospace label (NOT Title-Cased — paths are literal)
//   - exposes data-testid="at-token" by default with optional override
//   - calls e.preventDefault() on mousedown so click-in-token never moves
//     the textarea caret (C-06 / Phase 08.1 D-04)
//   - renders an AlertTriangle icon + reduced opacity + native title tooltip
//     when `ignored` is true (F-02 — .gitignore-excluded paths)
//
// We mock lucide-react so each icon becomes a sentinel <svg data-testid="…">
// — same pattern as SlashToken.test.tsx. Tests assert on the icon's identity
// (the abstraction layer the component relies on) rather than SVG geometry.

import { describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render } from '@testing-library/react';
import { AtToken } from './AtToken';

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

describe('AtToken (Phase 08.3 — A-02 / C-01 / C-04 / C-06 / F-02)', () => {
  // Test 1 — file kind → file icon
  it('renders file kind with the file icon', () => {
    const { getByTestId, queryByTestId } = render(<AtToken path="src/foo.ts" kind="file" />);
    expect(getByTestId('at-token')).toBeTruthy();
    expect(getByTestId('file')).toBeTruthy();
    expect(queryByTestId('folder')).toBeNull();
  });

  // Test 2 — dir kind → folder icon
  it('renders dir kind with the folder icon', () => {
    const { getByTestId, queryByTestId } = render(<AtToken path="docs/" kind="dir" />);
    expect(getByTestId('at-token')).toBeTruthy();
    expect(getByTestId('folder')).toBeTruthy();
    expect(queryByTestId('file')).toBeNull();
  });

  // Test 3 — full path is the visible label (monospace, NOT Title-Cased)
  it('renders the full path as the visible label', () => {
    const { getByTestId } = render(<AtToken path="src/components/Button.tsx" kind="file" />);
    expect(getByTestId('at-token').textContent).toBe('src/components/Button.tsx');
  });

  // Test 4 — click-in-token does not move caret (C-06 / Phase 08.1 D-04)
  it('click on the token does not move focus (onMouseDown preventDefault)', () => {
    const { getByTestId } = render(<AtToken path="src/foo.ts" kind="file" />);
    const token = getByTestId('at-token');
    const event = createEvent.mouseDown(token);
    fireEvent(token, event);
    expect(event.defaultPrevented).toBe(true);
  });

  // Test 5 — data-testid override
  it('accepts a data-testid override', () => {
    const { getByTestId, queryByTestId } = render(
      <AtToken path="src/foo.ts" kind="file" data-testid="custom-at" />
    );
    expect(getByTestId('custom-at')).toBeTruthy();
    expect(queryByTestId('at-token')).toBeNull();
  });

  // Test 6 — ignored state → AlertTriangle + opacity-70
  it('renders ignored state with the alert-triangle icon and opacity', () => {
    const { getByTestId } = render(<AtToken path="ignored/foo.ts" kind="file" ignored />);
    expect(getByTestId('alert-triangle')).toBeTruthy();
    expect(getByTestId('at-token').className).toContain('opacity-70');
  });

  // Test 7 — no alert-triangle when not ignored
  it('does not render alert-triangle when not ignored', () => {
    const { queryByTestId } = render(<AtToken path="src/foo.ts" kind="file" />);
    expect(queryByTestId('alert-triangle')).toBeNull();
  });

  // Test 8 — visual snapshot baseline
  it('visual snapshot of the standard file token', () => {
    const { container } = render(<AtToken path="src/components/Button.tsx" kind="file" />);
    expect(container.firstElementChild?.outerHTML).toMatchSnapshot();
  });
});
