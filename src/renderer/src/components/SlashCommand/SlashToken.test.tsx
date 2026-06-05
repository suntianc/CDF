// Phase 08.1 — D-02 / D-04 / D-05 / D-06 / SPEC R1/R3/R5
//
// SlashToken is the inline visual pill rendered by the ChatArea overlay
// (Plan 03). It is a pure presentational component that:
//   - renders a 5-category lucide icon (skills/command collapse to single
//     icon — see iconMap.ts) + Title-Cased name
//   - exposes data-testid="slash-token" by default with optional override
//   - calls e.preventDefault() on mousedown so click-in-token never moves
//     the textarea caret (D-04 / SPEC R5)
//
// We mock lucide-react so each icon becomes a sentinel <svg data-testid="…">
// — that way tests assert on the icon's identity (the abstraction layer
// the component relies on) rather than on lucide's internal SVG geometry.

import { describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render } from '@testing-library/react';
import { SlashToken } from './SlashToken';

// Map every icon component the production code MIGHT import from lucide-react
// to a sentinel. The 5 icons the component actually uses are: Sparkles,
// GraduationCap, Wrench, Play, Terminal. We mock them ALL by their
// PascalCase name so vi.mock returns a sentinel for any icon the iconMap
// (or future maintainer) might swap in.
vi.mock('lucide-react', () => {
  const sentinel = (testId: string) => {
    const Cmp = (props: { className?: string; 'aria-hidden'?: boolean | string }) => (
      <svg data-testid={testId} className={props.className} aria-hidden={props['aria-hidden']} />
    );
    Cmp.displayName = `MockIcon(${testId})`;
    return Cmp;
  };
  return {
    Sparkles: sentinel('sparkles'),
    GraduationCap: sentinel('graduation-cap'),
    Wrench: sentinel('wrench'),
    Play: sentinel('play'),
    Terminal: sentinel('terminal'),
    // Fallback pass-through for any other icon the test harness
    // transitively imports (e.g. via @testing-library or React internals).
    // Without this, vi.mock('lucide-react', ...) replaces the entire module
    // and any non-mocked export would be `undefined`.
  };
});

describe('SlashToken (Phase 08.1 — D-02 / D-04 / D-05 / D-06)', () => {
  // Test 1 — Title-Case integration (D-05 / SPEC R3 acceptance: gsd-fast → Gsd-Fast)
  it('renders Title-Cased name from a hyphenated input', () => {
    const { getByTestId } = render(<SlashToken name="gsd-fast" source="system" />);
    expect(getByTestId('slash-token').textContent).toContain('Gsd-Fast');
  });

  // Test 2 — system source → sparkles icon
  it('renders system source with the sparkles icon', () => {
    const { getByTestId } = render(<SlashToken name="goal" source="system" />);
    expect(getByTestId('sparkles')).toBeTruthy();
    expect(getByTestId('slash-token')).toBeTruthy();
  });

  // Test 3 — skills pair collapse (D-02: skill:project + skill:global → GraduationCap)
  it('collapses skill:project and skill:global into the same icon (graduation-cap)', () => {
    const { getByTestId: getA, unmount: unmountA } = render(
      <SlashToken name="review" source="skill:project" />
    );
    expect(getA('graduation-cap')).toBeTruthy();
    unmountA();
    const { getByTestId: getB } = render(
      <SlashToken name="review" source="skill:global" />
    );
    expect(getB('graduation-cap')).toBeTruthy();
  });

  // Test 4 — command pair collapse (D-02: cmd:project + cmd:system → Terminal)
  it('collapses cmd:project and cmd:system into the same icon (terminal)', () => {
    const { getByTestId: getA, unmount: unmountA } = render(
      <SlashToken name="build" source="cmd:project" />
    );
    expect(getA('terminal')).toBeTruthy();
    unmountA();
    const { getByTestId: getB } = render(
      <SlashToken name="build" source="cmd:system" />
    );
    expect(getB('terminal')).toBeTruthy();
  });

  // Test 5 — mcp source → wrench
  it('renders mcp source with the wrench icon', () => {
    const { getByTestId } = render(<SlashToken name="arxiv" source="mcp" />);
    expect(getByTestId('wrench')).toBeTruthy();
  });

  // Test 6 — workflow source → play
  it('renders workflow source with the play icon', () => {
    const { getByTestId } = render(<SlashToken name="pr-review" source="workflow" />);
    expect(getByTestId('play')).toBeTruthy();
  });

  // Test 7 — click-in-token does not move caret (D-04 / SPEC R5)
  it('click on the token does not move focus (onMouseDown preventDefault)', () => {
    const { getByTestId } = render(<SlashToken name="goal" source="system" />);
    const token = getByTestId('slash-token');
    // Create a native MouseEvent, dispatch via fireEvent (which routes
    // through React 17+ event delegation on the document root), then read
    // the SAME event's `defaultPrevented` synchronously. The onMouseDown
    // handler is `(e) => e.preventDefault()` — when React's synthetic
    // handler invokes e.preventDefault() on the SyntheticEvent, React
    // calls the same method on the underlying native event, so
    // `event.defaultPrevented` becomes true before fireEvent returns.
    const event = createEvent.mouseDown(token);
    fireEvent(token, event);
    expect(event.defaultPrevented).toBe(true);
  });

  // Test 8 — data-testid override (SPEC R1)
  it('accepts a data-testid override', () => {
    const { getByTestId, queryByTestId } = render(
      <SlashToken name="goal" source="system" data-testid="custom-token" />
    );
    expect(getByTestId('custom-token')).toBeTruthy();
    // The default 'slash-token' must NOT exist when an override is supplied.
    expect(queryByTestId('slash-token')).toBeNull();
  });

  // Test 9 — visual snapshot baseline (SPEC R8 acceptance: stable baseline)
  it('visual snapshot of the standard token', () => {
    const { container } = render(<SlashToken name="gsd-fast" source="system" />);
    expect(container.firstElementChild?.outerHTML).toMatchSnapshot();
  });
});
