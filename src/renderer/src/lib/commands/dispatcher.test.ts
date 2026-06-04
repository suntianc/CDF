import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SlashCommand } from '../../../../shared/types';

// Mock the stores at module level so dispatcher.ts picks them up
const mockSendMessage = vi.fn();
const mockGetProjectState = vi.fn();
const mockGetSessionState = vi.fn();
vi.mock('@/stores/projectStore', () => ({
  useProjectStore: { getState: () => mockGetProjectState() },
}));
vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: { getState: () => mockGetSessionState() },
}));

import { resolve, dispatch } from './dispatcher';

const goalCmd: SlashCommand = {
  name: 'goal',
  description: '设置 session 目标',
  source: 'system',
  target: 'goal',
  sourceLabel: 'system',
  badge: '[system]',
};

const contextCmd: SlashCommand = {
  name: 'context',
  description: '查看 session token 用量',
  source: 'system',
  target: 'context',
  sourceLabel: 'system',
  badge: '[system]',
};

const planCmd: SlashCommand = {
  name: 'plan',
  description: '进入 plan 模式',
  source: 'system',
  target: 'plan',
  sourceLabel: 'system',
  badge: '[system]',
};

const mcpCmd: SlashCommand = {
  name: 'arxiv_search',
  description: 'Search arxiv papers',
  source: 'mcp',
  target: 'arxiv_search',
  sourceLabel: 'mcp:arxiv',
  badge: '[mcp:arxiv_search]',
};

const workflowCmd: SlashCommand = {
  name: 'pr-review',
  description: 'PR review workflow',
  source: 'workflow',
  target: 'pr-review',
  sourceLabel: 'workflow',
  badge: '[workflow]',
};

describe('dispatcher.resolve', () => {
  it('returns SystemSilent for /goal', () => {
    const plan = resolve('/goal', [goalCmd]);
    expect(plan).toEqual({ kind: 'SystemSilent', command: goalCmd, args: '' });
  });

  it('args passthrough no flag parsing (D-02)', () => {
    const plan = resolve('/goal write tests', [goalCmd]);
    expect(plan).toEqual({ kind: 'SystemSilent', command: goalCmd, args: 'write tests' });
  });

  it('returns SystemLocal for /context', () => {
    const plan = resolve('/context', [contextCmd]);
    expect(plan).toEqual({ kind: 'SystemLocal', command: contextCmd, args: '' });
  });

  it('returns PlanMode for /plan', () => {
    const plan = resolve('/plan', [planCmd]);
    expect(plan).toEqual({ kind: 'PlanMode', command: planCmd, args: '' });
  });

  it('PlanMode args passthrough — /plan --priority=high', () => {
    const plan = resolve('/plan --priority=high', [planCmd]);
    expect(plan).toEqual({ kind: 'PlanMode', command: planCmd, args: '--priority=high' });
  });

  it('PluginRewrite for MCP with args (D-18)', () => {
    const plan = resolve('/arxiv_search foo bar', [mcpCmd]);
    expect(plan).toEqual({
      kind: 'PluginRewrite',
      command: mcpCmd,
      args: 'foo bar',
      prompt: '请调用 arxiv_search 工具，参数：foo bar',
    });
  });

  it('PluginRewrite for MCP with no args (no crash)', () => {
    const plan = resolve('/arxiv_search', [mcpCmd]);
    expect(plan).toEqual({
      kind: 'PluginRewrite',
      command: mcpCmd,
      args: '',
      prompt: '请调用 arxiv_search 工具，参数：(无参数)',
    });
  });

  it('PluginRewrite for workflow', () => {
    const plan = resolve('/pr-review', [workflowCmd]);
    expect(plan).toEqual({
      kind: 'PluginRewrite',
      command: workflowCmd,
      args: '',
      prompt: '请调用 pr-review 工具，参数：(无参数)',
    });
  });

  it('returns null for non-slash input', () => {
    expect(resolve('hello', [goalCmd])).toBeNull();
  });

  it('returns null for unknown command', () => {
    expect(resolve('/unknown', [goalCmd])).toBeNull();
  });

  it('returns null for empty registry', () => {
    expect(resolve('/goal', [])).toBeNull();
  });
});

describe('dispatcher.dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockReset();
    mockGetProjectState.mockReset();
    mockGetSessionState.mockReset();
  });

  it('plugin rewrite does not pass overrides (D-18)', async () => {
    mockGetProjectState.mockReturnValue({ currentProjectId: 'projectId' });
    mockGetSessionState.mockReturnValue({ sendMessage: mockSendMessage });
    mockSendMessage.mockResolvedValue(undefined);

    await dispatch({
      kind: 'PluginRewrite',
      command: mcpCmd,
      args: 'foo',
      prompt: '请调用 arxiv_search 工具，参数：foo',
    });

    expect(mockSendMessage).toHaveBeenCalledWith('projectId', '请调用 arxiv_search 工具，参数：foo');
    // CRITICAL: no third argument (D-18 — args go to message.content, not tool schema)
    expect(mockSendMessage.mock.calls[0]).toHaveLength(2);
  });

  it('PlanMode dispatch passes planOnly override', async () => {
    mockGetProjectState.mockReturnValue({ currentProjectId: 'projectId' });
    mockGetSessionState.mockReturnValue({ sendMessage: mockSendMessage });
    mockSendMessage.mockResolvedValue(undefined);

    await dispatch({ kind: 'PlanMode', command: planCmd, args: 'write tests' });

    expect(mockSendMessage).toHaveBeenCalledWith('projectId', 'write tests', { planOnly: true });
  });

  it('warns and returns when no active project', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetProjectState.mockReturnValue({ currentProjectId: null });
    mockGetSessionState.mockReturnValue({ sendMessage: mockSendMessage });

    await dispatch({ kind: 'PlanMode', command: planCmd, args: 'x' });

    expect(warnSpy).toHaveBeenCalledWith('[dispatcher] No active project; cannot dispatch');
    expect(mockSendMessage).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
