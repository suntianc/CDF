import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mockOpen = vi.fn();
const mockState: Record<string, unknown> = {
  isOpen: false,
  open: mockOpen,
  close: vi.fn(),
  toggle: vi.fn(),
};

vi.mock('@/stores/contextModalStore', () => ({
  useContextModalStore: Object.assign(
    (selector: (s: typeof mockState) => unknown) => selector(mockState),
    { getState: () => mockState }
  ),
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

import { ContextButton } from './ContextButton';

beforeEach(() => {
  vi.clearAllMocks();
  mockState.isOpen = false;
});

describe('ContextButton', () => {
  it("renders with data-testid 'context-button'", () => {
    render(<ContextButton />);
    expect(screen.getByTestId('context-button')).toBeTruthy();
  });

  it('onClick calls useContextModalStore.open()', () => {
    render(<ContextButton />);
    fireEvent.click(screen.getByTestId('context-button'));
    expect(mockOpen).toHaveBeenCalled();
  });

  it("renders 'default' variant + info-tinted style when modal isOpen=true", () => {
    mockState.isOpen = true;
    render(<ContextButton />);
    const btn = screen.getByTestId('context-button');
    // 'bg-[var(--color-info)]' is the active state class (info-tinted)
    expect(btn.className).toContain('bg-[var(--color-info)]');
  });
});
