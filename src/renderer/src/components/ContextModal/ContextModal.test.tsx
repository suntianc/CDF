import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Module-level mocks (hoisted by vi.mock factories)
const mockClose = vi.fn();
const mockState: Record<string, unknown> = {
  isOpen: true,
  open: vi.fn(),
  close: mockClose,
  toggle: vi.fn(),
};

const mockSessionGet = vi.fn();
const mockLLMGet = vi.fn();
const mockCurrentSession = vi.fn();

vi.mock('@/stores/contextModalStore', () => ({
  useContextModalStore: Object.assign(
    (selector: (s: typeof mockState) => unknown) => selector(mockState),
    { getState: () => mockState }
  ),
}));

vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: { getState: () => mockSessionGet() },
}));

vi.mock('@/stores/llmStore', () => ({
  useLLMStore: { getState: () => mockLLMGet() },
}));

// Radix Dialog mocks (mirrors PlanPopup.test.tsx pattern)
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  DialogContent: ({ children, ...rest }: { children: React.ReactNode; [k: string]: unknown }) => (
    <div data-testid="dialog-content" {...(rest as object)}>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
}));

declare global {
  // eslint-disable-next-line no-var
  var electronAPI: any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.isOpen = true;
  mockSessionGet.mockReset();
  mockLLMGet.mockReset();
  mockCurrentSession.mockReset();
  mockSessionGet.mockReturnValue({ activeSessionId: 'session-1' });
  mockLLMGet.mockReturnValue({ activeProvider: { context_limit: 200_000, default_model: 'claude-opus' } });
  globalThis.electronAPI = {
    context: { currentSession: mockCurrentSession },
  };
});

import { ContextModal } from './ContextModal';

const fullBreakdown = {
  conversation: 1000,
  skills: 200,
  mcp: 300,
  workflows: 400,
  systemPrompt: 0,
  systemTools: 0,
  customAgents: 0,
  memoryFiles: 0,
  messages: 1000,
  projectCommandBodies: 500,
  freeSpace: 100_000,
  autocompactBuffer: 30_000,
  mcpPerTool: [
    { tool: 'mcp__arxiv__search', server: 'arxiv', tokens: 150 },
    { tool: 'mcp__arxiv__summarize', server: 'arxiv', tokens: 200 },
  ],
};

describe('ContextModal', () => {
  it("renders with data-testid 'context-modal' when isOpen=true", () => {
    mockCurrentSession.mockResolvedValue({
      breakdown: fullBreakdown,
      total: 2400,
      modelName: 'claude-opus',
      contextLimit: 200_000,
      used: 2400,
      usedPct: 1,
      freePct: 50,
      mcpPerTool: fullBreakdown.mcpPerTool,
    });
    render(<ContextModal />);
    expect(screen.getByTestId('context-modal')).toBeTruthy();
  });

  it('shows Skeleton rows while loading', () => {
    // Don't resolve the promise — keeps loading state.
    mockCurrentSession.mockReturnValue(new Promise(() => {}));
    render(<ContextModal />);
    expect(screen.getByTestId('context-modal-loading')).toBeTruthy();
    const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThanOrEqual(5);
  });

  it('renders 11 category labels after data resolves', async () => {
    mockCurrentSession.mockResolvedValue({
      breakdown: fullBreakdown,
      total: 2400,
      modelName: 'claude-opus',
      contextLimit: 200_000,
      used: 2400,
      usedPct: 1,
      freePct: 50,
      mcpPerTool: fullBreakdown.mcpPerTool,
    });
    render(<ContextModal />);
    await waitFor(() => screen.getByTestId('context-modal-body'));
    const body = screen.getByTestId('context-modal-body');
    expect(body.textContent).toContain('System prompt');
    expect(body.textContent).toContain('System tools');
    expect(body.textContent).toContain('MCP tools');
    expect(body.textContent).toContain('Workflows');
    expect(body.textContent).toContain('Custom agents');
    expect(body.textContent).toContain('Memory files');
    expect(body.textContent).toContain('Skills');
    expect(body.textContent).toContain('Messages');
    expect(body.textContent).toContain('Project command bodies');
    expect(body.textContent).toContain('Free space');
    expect(body.textContent).toContain('Autocompact buffer');
  });

  it('renders progress bar with role=progressbar and aria-valuenow', async () => {
    mockCurrentSession.mockResolvedValue({
      breakdown: fullBreakdown,
      total: 100_000,
      modelName: 'claude-opus',
      contextLimit: 200_000,
      used: 100_000,
      usedPct: 50,
      freePct: 35,
      mcpPerTool: [],
    });
    render(<ContextModal />);
    await waitFor(() => screen.getByTestId('context-modal-progress'));
    const bar = screen.getByTestId('context-modal-progress');
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
  });

  it('MCP tools section toggles expand/collapse on click', async () => {
    mockCurrentSession.mockResolvedValue({
      breakdown: fullBreakdown,
      total: 2400,
      modelName: 'claude-opus',
      contextLimit: 200_000,
      used: 2400,
      usedPct: 1,
      freePct: 50,
      mcpPerTool: fullBreakdown.mcpPerTool,
    });
    render(<ContextModal />);
    await waitFor(() => screen.getByTestId('context-modal-mcp-toggle'));
    // Initially collapsed — per-tool rows NOT rendered
    expect(screen.queryAllByTestId('context-modal-mcp-tool')).toHaveLength(0);
    // Click to expand
    fireEvent.click(screen.getByTestId('context-modal-mcp-toggle'));
    expect(screen.getAllByTestId('context-modal-mcp-tool')).toHaveLength(2);
  });

  it('renders near-threshold warning when freeSpace < 10% of limit', async () => {
    mockCurrentSession.mockResolvedValue({
      breakdown: { ...fullBreakdown, freeSpace: 5_000 },
      total: 100_000,
      modelName: 'claude-opus',
      contextLimit: 200_000,
      used: 100_000,
      usedPct: 50,
      freePct: 2,
      mcpPerTool: [],
    });
    render(<ContextModal />);
    await waitFor(() => screen.getByTestId('context-modal-near-threshold'));
    const warning = screen.getByTestId('context-modal-near-threshold');
    expect(warning.textContent).toContain('距离自动压缩仅剩');
  });

  it('shows error message when IPC fetch fails', async () => {
    mockCurrentSession.mockRejectedValue(new Error('network down'));
    render(<ContextModal />);
    await waitFor(() => screen.getByTestId('context-modal-error'));
    const err = screen.getByTestId('context-modal-error');
    expect(err.textContent).toContain('Context 数据加载失败');
    expect(err.textContent).toContain('network down');
  });
});
