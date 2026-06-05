import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SlashCommand } from '../../../../shared/types';

// Mock the stores at module level so dispatcher.ts picks them up
const mockSendMessage = vi.fn();
const mockGetProjectState = vi.fn();
const mockGetSessionState = vi.fn();
const mockSetSessionGoal = vi.fn();
const mockContextCurrentSession = vi.fn();
const mockReadBody = vi.fn();
vi.mock('@/stores/projectStore', () => ({
  useProjectStore: { getState: () => mockGetProjectState() },
}));
vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: { getState: () => mockGetSessionState() },
}));

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { resolve, dispatch } from './dispatcher';
import { toast } from 'sonner';

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
  // v1.1 polish: server-dimension. One slash command per MCP server, not
  // per tool — the LLM picks the appropriate tool from the server's
  // available tools at dispatch time.
  name: 'arxiv',
  description: 'arxiv MCP server (search/summarize/etc.)',
  source: 'mcp',
  target: 'arxiv',
  sourceLabel: 'mcp:arxiv',
  badge: '[mcp:arxiv]',
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

  it('preserves literal `/cmd-name args` contract for /goal fix login (Phase 08.1 R5 + dispatcher contract regression)', () => {
    const plan = resolve('/goal fix login', [goalCmd]);
    expect(plan).toEqual({ kind: 'SystemSilent', command: goalCmd, args: 'fix login' });
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

  it('PluginRewrite for MCP with args (D-18, v1.1 server-dim)', () => {
    const plan = resolve('/arxiv foo bar', [mcpCmd]);
    expect(plan).toEqual({
      kind: 'PluginRewrite',
      command: mcpCmd,
      args: 'foo bar',
      prompt: '请使用 arxiv MCP 服务器上的合适工具处理：foo bar',
    });
  });

  it('PluginRewrite for MCP with no args (no crash)', () => {
    const plan = resolve('/arxiv', [mcpCmd]);
    expect(plan).toEqual({
      kind: 'PluginRewrite',
      command: mcpCmd,
      args: '',
      prompt: '请使用 arxiv MCP 服务器上的合适工具处理：(无具体参数)',
    });
  });

  it('PluginRewrite for workflow (stays per-workflow, not server-dim)', () => {
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
    mockSetSessionGoal.mockReset();
    mockContextCurrentSession.mockReset();
    mockReadBody.mockReset();
    (window as any).electronAPI = {
      context: { currentSession: mockContextCurrentSession },
      commands: { readBody: mockReadBody },
    };
  });

  it('plugin rewrite does not pass overrides (D-18, v1.1 server-dim)', async () => {
    mockGetProjectState.mockReturnValue({ currentProjectId: 'projectId' });
    mockGetSessionState.mockReturnValue({ sendMessage: mockSendMessage });
    mockSendMessage.mockResolvedValue(undefined);

    await dispatch({
      kind: 'PluginRewrite',
      command: mcpCmd,
      args: 'foo',
      prompt: '请使用 arxiv MCP 服务器上的合适工具处理：foo',
    });

    expect(mockSendMessage).toHaveBeenCalledWith('projectId', '请使用 arxiv MCP 服务器上的合适工具处理：foo');
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

  // ===== Phase 7 Plan 01: real implementations (replaces 3 console.log placeholders) =====

  it('A. SystemSilent: writes to sessionGoals + emits /goal toast (D-01/D-02/D-03)', async () => {
    mockGetProjectState.mockReturnValue({ currentProjectId: 'project-1' });
    mockGetSessionState.mockReturnValue({
      activeSessionId: 'session-1',
      setSessionGoal: mockSetSessionGoal,
    });

    await dispatch({ kind: 'SystemSilent', command: goalCmd, args: 'write tests' });

    // setSessionGoal called with sessionId + trimmed args
    expect(mockSetSessionGoal).toHaveBeenCalledWith('session-1', 'write tests');
    // sendMessage NOT called (no LLM)
    expect(mockSendMessage).not.toHaveBeenCalled();
    // toast.info called with the D-01 placeholder string
    expect(toast.info).toHaveBeenCalled();
    const toastCall = (toast.info as any).mock.calls[0];
    expect(toastCall[0]).toBe('[system] 正在执行 /goal…');
  });

  it('B. SystemLocal: calls electronAPI.context.currentSession + emits breakdown toast (D-06/D-07/D-08)', async () => {
    mockGetProjectState.mockReturnValue({ currentProjectId: 'project-1' });
    mockGetSessionState.mockReturnValue({ activeSessionId: 'session-1' });
    mockContextCurrentSession.mockResolvedValue({
      breakdown: { conversation: 100, skills: 50, mcp: 25, workflows: 75 },
      total: 250,
    });

    await dispatch({ kind: 'SystemLocal', command: contextCmd, args: '' });

    // IPC called with sessionId
    expect(mockContextCurrentSession).toHaveBeenCalledWith('session-1');
    // toast.info called with the breakdown
    expect(toast.info).toHaveBeenCalled();
    const toastCall = (toast.info as any).mock.calls[0];
    expect(toastCall[0]).toBe('[system] 上下文');
    // Description must include the per-source tokens + total
    const desc: string = toastCall[1]?.description || '';
    expect(desc).toContain('对话: 100 tokens');
    expect(desc).toContain('Skills: 50 tokens');
    expect(desc).toContain('MCP: 25 tokens');
    expect(desc).toContain('Workflows: 75 tokens');
    expect(desc).toContain('Total: 250 tokens');
  });

  it('C. PlanMode: emits [plan] toast + calls sendMessage with { planOnly: true } (D-10/D-11/D-12)', async () => {
    mockGetProjectState.mockReturnValue({ currentProjectId: 'project-1' });
    mockGetSessionState.mockReturnValue({ sendMessage: mockSendMessage });
    mockSendMessage.mockResolvedValue(undefined);

    await dispatch({ kind: 'PlanMode', command: planCmd, args: 'write tests' });

    // sendMessage called with planOnly override
    expect(mockSendMessage).toHaveBeenCalledWith('project-1', 'write tests', { planOnly: true });
    // toast.info called with the [plan] marker
    expect(toast.info).toHaveBeenCalled();
    const toastCall = (toast.info as any).mock.calls[0];
    expect(toastCall[0]).toContain('[plan] 进入 plan 模式');
    expect(toastCall[0]).toContain('write tests');
  });

  // ===== 08.2 P1: PluginRewrite body load + $ARGUMENTS substitution (D-01/D-03) =====

  it('PluginRewrite with bodyPath: reads body via IPC, substitutes $ARGUMENTS, sends as user message (no prompt prefix)', async () => {
    mockGetProjectState.mockReturnValue({ currentProjectId: 'project-1' });
    mockGetSessionState.mockReturnValue({ sendMessage: mockSendMessage });
    mockSendMessage.mockResolvedValue(undefined);
    mockReadBody.mockResolvedValue({
      body: '请部署到 $0 环境。参数：$ARGUMENTS',
      mtimeMs: 12345,
    });

    const cmd: SlashCommand = {
      ...mcpCmd,
      bodyPath: '/home/user/.cdf/commands/deploy.md',
      frontmatter: { userInvocable: true, allowedTools: [], whenToUse: '', arguments: [] },
    };

    await dispatch({
      kind: 'PluginRewrite',
      command: cmd,
      args: 'production --force 顺带更新 changelog',
      prompt: '请使用 arxiv MCP 服务器上的合适工具处理：production --force',
    });

    // IPC readBody called with bodyPath
    expect(mockReadBody).toHaveBeenCalledWith('/home/user/.cdf/commands/deploy.md');
    // sendMessage called with substituted body — NOT the original prompt
    expect(mockSendMessage).toHaveBeenCalledWith(
      'project-1',
      '请部署到 production 环境。参数：production --force 顺带更新 changelog'
    );
    // Only 2 args: no overrides (allowedTools is empty array → no overrides)
    expect(mockSendMessage.mock.calls[0]).toHaveLength(2);
  });

  it('PluginRewrite without bodyPath: falls through to existing prompt rewrite (D-18 path)', async () => {
    mockGetProjectState.mockReturnValue({ currentProjectId: 'project-1' });
    mockGetSessionState.mockReturnValue({ sendMessage: mockSendMessage });
    mockSendMessage.mockResolvedValue(undefined);
    mockReadBody.mockResolvedValue({ body: '', mtimeMs: 0 });

    // mcpCmd has no bodyPath → existing prompt-rewrite path
    await dispatch({
      kind: 'PluginRewrite',
      command: mcpCmd,
      args: 'foo',
      prompt: '请使用 arxiv MCP 服务器上的合适工具处理：foo',
    });

    // readBody NOT called (no bodyPath)
    expect(mockReadBody).not.toHaveBeenCalled();
    // sendMessage called with the original prompt
    expect(mockSendMessage).toHaveBeenCalledWith(
      'project-1',
      '请使用 arxiv MCP 服务器上的合适工具处理：foo'
    );
  });

  it('PluginRewrite with frontmatter.allowedTools: passes overrides.allowedTools to sendMessage (D-09 type-level)', async () => {
    mockGetProjectState.mockReturnValue({ currentProjectId: 'project-1' });
    mockGetSessionState.mockReturnValue({ sendMessage: mockSendMessage });
    mockSendMessage.mockResolvedValue(undefined);
    mockReadBody.mockResolvedValue({
      body: '请部署到 $0 环境',
      mtimeMs: 0,
    });

    const cmd: SlashCommand = {
      ...mcpCmd,
      bodyPath: '/home/user/.cdf/commands/deploy.md',
      frontmatter: {
        userInvocable: true,
        allowedTools: ['Read', 'Bash'],
        whenToUse: '',
        arguments: [],
      },
    };

    await dispatch({
      kind: 'PluginRewrite',
      command: cmd,
      args: 'production',
      prompt: '请使用 arxiv MCP 服务器上的合适工具处理：production',
    });

    // sendMessage called with allowedTools in overrides
    expect(mockSendMessage).toHaveBeenCalledWith('project-1', '请部署到 production 环境', {
      allowedTools: ['Read', 'Bash'],
    });
  });
});
