import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// jsdom polyfills required by Radix Dialog (and friends)
beforeEach(() => {
  cleanup();
});

const mockOpen = vi.fn();
const mockClose = vi.fn();
const mockStartModify = vi.fn();
const mockExecute = vi.fn();
const mockAppendChunk = vi.fn();
const mockState: Record<string, unknown> = {
  isOpen: true,
  status: 'reviewing',
  planContent: '# 计划\n\n- 步骤 1\n- 步骤 2',
  iterationCount: 0,
  description: '重构 ChatArea',
  currentRequestId: null,
  modifyHistory: [],
  open: mockOpen,
  close: mockClose,
  startModify: mockStartModify,
  execute: mockExecute,
  appendChunk: mockAppendChunk,
};

vi.mock('@/stores/planPopupStore', () => ({
  usePlanPopupStore: Object.assign(
    (selector: (s: typeof mockState) => unknown) => selector(mockState),
    { getState: () => mockState }
  ),
}));

// Mock the Dialog primitives (Radix) — they're noisy in jsdom and we want
// to assert on rendered content rather than Radix internals.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  DialogContent: ({ children, ...rest }: { children: React.ReactNode; [k: string]: unknown }) => (
    <div data-testid="dialog-content" {...(rest as object)}>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div data-testid="dialog-header">{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2 data-testid="dialog-title">{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p data-testid="dialog-description">{children}</p>,
}));

vi.mock('@/components/ChatArea/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ text }: { text: string }) => <div data-testid="markdown-renderer">{text}</div>,
}));

import { PlanPopup } from './PlanPopup';

describe('PlanPopup', () => {
  it("renders with data-testid 'plan-popup' when isOpen=true", () => {
    mockState.isOpen = true;
    mockState.status = 'reviewing';
    mockState.planContent = 'demo';
    mockState.iterationCount = 0;
    mockState.description = 'demo';
    render(<PlanPopup />);
    expect(screen.getByTestId('plan-popup')).toBeTruthy();
  });

  it("shows Skeleton when status='generating'", () => {
    mockState.isOpen = true;
    mockState.status = 'generating';
    mockState.planContent = '';
    mockState.iterationCount = 0;
    mockState.description = 'demo';
    render(<PlanPopup />);
    // The Skeleton element exists — verify by class containing animate-pulse
    const skeleton = document.querySelector('.animate-pulse');
    expect(skeleton).toBeTruthy();
  });

  it("renders plan content via MarkdownRenderer when status='reviewing'", () => {
    mockState.isOpen = true;
    mockState.status = 'reviewing';
    mockState.planContent = '# 计划\n步骤 1';
    mockState.iterationCount = 0;
    mockState.description = 'demo';
    render(<PlanPopup />);
    const md = screen.getByTestId('markdown-renderer');
    expect(md.textContent).toContain('步骤 1');
  });

  it("renders 「修改计划」 + 「立即执行」 buttons", () => {
    mockState.isOpen = true;
    mockState.status = 'reviewing';
    mockState.planContent = 'demo';
    mockState.iterationCount = 0;
    mockState.description = 'demo';
    render(<PlanPopup />);
    expect(screen.getByTestId('plan-popup-modify-button').textContent).toContain('修改计划');
    expect(screen.getByTestId('plan-popup-execute-button').textContent).toContain('立即执行');
  });

  it("「立即执行」 onClick calls store.execute()", () => {
    mockState.isOpen = true;
    mockState.status = 'reviewing';
    mockState.planContent = 'demo';
    mockState.iterationCount = 0;
    mockState.description = 'demo';
    render(<PlanPopup />);
    fireEvent.click(screen.getByTestId('plan-popup-execute-button'));
    expect(mockExecute).toHaveBeenCalled();
  });

  it("at iterationCount===20: 「修改计划」 is disabled, 「立即执行」 is enabled", () => {
    mockState.isOpen = true;
    mockState.status = 'cap-reached';
    mockState.planContent = 'demo';
    mockState.iterationCount = 20;
    mockState.description = 'demo';
    render(<PlanPopup />);
    const modifyBtn = screen.getByTestId('plan-popup-modify-button') as HTMLButtonElement;
    const executeBtn = screen.getByTestId('plan-popup-execute-button') as HTMLButtonElement;
    expect(modifyBtn.disabled).toBe(true);
    expect(executeBtn.disabled).toBe(false);
  });
});
