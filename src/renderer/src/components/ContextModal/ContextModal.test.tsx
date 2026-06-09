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

vi.mock('@/stores/sessionStore', () => {
  const store = (selector: any) => selector(mockSessionGet());
  store.getState = () => mockSessionGet();
  return { useSessionStore: store };
});

vi.mock('@/stores/llmStore', () => {
  const store = (selector: any) => selector(mockLLMGet());
  store.getState = () => mockLLMGet();
  return { useLLMStore: store };
});

// Radix Dialog mocks
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
  // 08.2 polish — per-source breakdowns (each can be expanded in the modal)
  skillsPerSkill: [
    { name: 'simplify', scope: 'global' as const, tokens: 100 },
    { name: 'debug', scope: 'project' as const, tokens: 100 },
  ],
  workflowsPerWorkflow: [{ id: 'wf-1', name: 'sample-workflow', tokens: 400 }],
  systemToolsPerTool: [
    { name: 'fetch', tokens: 80 },
    { name: 'bash', tokens: 60 },
    { name: 'delete_file', tokens: 40 },
  ],
  projectCommandsPerFile: [{ name: 'deploy.md', tokens: 500 }],
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
    await waitFor(() => screen.getByTestId('context-modal-detail-toggle-mcp'));
    // Initially collapsed — per-tool rows NOT rendered
    expect(screen.queryAllByTestId('context-modal-detail-row-mcp')).toHaveLength(0);
    // Click to expand
    fireEvent.click(screen.getByTestId('context-modal-detail-toggle-mcp'));
    expect(screen.getAllByTestId('context-modal-detail-row-mcp')).toHaveLength(2);
  });

  it('renders all 5 detail sections (MCP / Skills / Workflows / System tools / Project commands)', async () => {
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
    await waitFor(() => screen.getByTestId('context-modal-detail-toggle-mcp'));
    // 08.2 polish: all 5 detail sections should be present (MCP / Skills /
    // Workflows / System tools / Project commands). Each is collapsed by
    // default; we just verify the toggle buttons exist.
    expect(screen.getByTestId('context-modal-detail-toggle-mcp')).toBeTruthy();
    expect(screen.getByTestId('context-modal-detail-toggle-skills')).toBeTruthy();
    expect(screen.getByTestId('context-modal-detail-toggle-workflows')).toBeTruthy();
    expect(screen.getByTestId('context-modal-detail-toggle-systemTools')).toBeTruthy();
    expect(screen.getByTestId('context-modal-detail-toggle-projectCommands')).toBeTruthy();
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
    expect(warning.textContent).toContain('context.compressWarning');
  });

  it('shows error message when IPC fetch fails', async () => {
    mockCurrentSession.mockRejectedValue(new Error('network down'));
    render(<ContextModal />);
    await waitFor(() => screen.getByTestId('context-modal-error'));
    const err = screen.getByTestId('context-modal-error');
    expect(err.textContent).toContain('context.dataLoadFailed');
  });

  it('passes overridden model name to currentSession when session overrides exist', async () => {
    mockSessionGet.mockReturnValue({
      activeSessionId: 'session-1',
      sessionModelOverrides: {
        'session-1': { providerId: 'provider-2', model: 'gpt-4o' },
      },
    });
    mockLLMGet.mockReturnValue({
      activeProvider: { context_limit: 200_000, default_model: 'claude-opus' },
      providers: [
        { id: 'provider-1', context_limit: 200_000, default_model: 'claude-opus' },
        { id: 'provider-2', context_limit: 128_000, default_model: 'gpt-4o' },
      ],
    });
    mockCurrentSession.mockResolvedValue({
      breakdown: fullBreakdown,
      total: 2400,
      modelName: 'gpt-4o',
      contextLimit: 128_000,
      used: 2400,
      usedPct: 1,
      freePct: 50,
      mcpPerTool: [],
    });

    render(<ContextModal />);
    await waitFor(() => expect(mockCurrentSession).toHaveBeenCalledWith('session-1', 128_000, 'gpt-4o'));
  });
});
