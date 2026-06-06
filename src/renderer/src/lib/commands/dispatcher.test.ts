import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SlashCommand } from '../../../../shared/types';

// Mock the stores at module level so dispatcher.ts picks them up
const mockSendMessage = vi.fn();
const mockGetProjectState = vi.fn();
const mockGetSessionState = vi.fn();
const mockSetSessionGoal = vi.fn();
const mockContextCurrentSession = vi.fn();
const mockReadBody = vi.fn();
const mockContextModalOpen = vi.fn();
const mockStartGoalJudgeLoop = vi.fn();
const mockStopGoalJudgeLoop = vi.fn();
vi.mock('@/stores/projectStore', () => ({
  useProjectStore: { getState: () => mockGetProjectState() },
}));
vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: { getState: () => mockGetSessionState() },
}));
vi.mock('@/stores/contextModalStore', () => ({
  useContextModalStore: { getState: () => ({ open: mockContextModalOpen }) },
}));
vi.mock('@/hooks/useGoalJudge', () => ({
  startGoalJudgeLoop: (...args: unknown[]) => mockStartGoalJudgeLoop(...args),
  stopGoalJudgeLoop: (...args: unknown[]) => mockStopGoalJudgeLoop(...args),
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
  it('returns GoalLoop for /goal (08.2 P3 C1-05)', () => {
    const plan = resolve('/goal', [goalCmd]);
    expect(plan).toEqual({ kind: 'GoalLoop', command: goalCmd, args: '', goal: '' });
  });

  it('args passthrough no flag parsing (D-02) → GoalLoop carries goal', () => {
    const plan = resolve('/goal write tests', [goalCmd]);
    expect(plan).toEqual({ kind: 'GoalLoop', command: goalCmd, args: 'write tests', goal: 'write tests' });
  });

  it('preserves literal `/cmd-name args` contract for /goal fix login (Phase 08.1 R5 + dispatcher contract regression)', () => {
    const plan = resolve('/goal fix login', [goalCmd]);
    expect(plan).toEqual({ kind: 'GoalLoop', command: goalCmd, args: 'fix login', goal: 'fix login' });
  });

  it('returns SystemLocal for /context', () => {
    const plan = resolve('/context', [contextCmd]);
    expect(plan).toEqual({ kind: 'SystemLocal', command: contextCmd, args: '' });
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
    mockContextModalOpen.mockReset();
    mockStartGoalJudgeLoop.mockReset();
    mockStopGoalJudgeLoop.mockReset();
    mockStartGoalJudgeLoop.mockResolvedValue(undefined);
    mockStopGoalJudgeLoop.mockResolvedValue(undefined);
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

  // ===== Phase 7 Plan 01: real implementations (replaces 3 console.log placeholders) =====

  it('A. GoalLoop: writes sessionGoal + starts judge loop (08.2 P3 C1-05)', async () => {
    mockGetProjectState.mockReturnValue({ currentProjectId: 'project-1' });
    mockGetSessionState.mockReturnValue({
      activeSessionId: 'session-1',
      setSessionGoal: mockSetSessionGoal,
    });

    await dispatch({ kind: 'GoalLoop', command: goalCmd, args: 'write tests', goal: 'write tests' });

    // setSessionGoal called with sessionId + trimmed goal
    expect(mockSetSessionGoal).toHaveBeenCalledWith('session-1', 'write tests');
    // stopGoalJudgeLoop called first (防重入) then startGoalJudgeLoop
    expect(mockStopGoalJudgeLoop).toHaveBeenCalledWith('session-1');
    expect(mockStartGoalJudgeLoop).toHaveBeenCalledWith('session-1', 'write tests');
    // No sendMessage (the judge hook handles message injection internally)
    expect(mockSendMessage).not.toHaveBeenCalled();
    // No toast (per UI-SPEC.md §Surface 1: bubble is the only feedback)
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('A2. GoalLoop with empty goal: clear semantics — stop loop + clear goal, no start', async () => {
    mockGetProjectState.mockReturnValue({ currentProjectId: 'project-1' });
    mockGetSessionState.mockReturnValue({
      activeSessionId: 'session-1',
      setSessionGoal: mockSetSessionGoal,
    });

    await dispatch({ kind: 'GoalLoop', command: goalCmd, args: '', goal: '' });

    // stopGoalJudgeLoop called
    expect(mockStopGoalJudgeLoop).toHaveBeenCalledWith('session-1');
    // sessionGoal cleared to empty string
    expect(mockSetSessionGoal).toHaveBeenCalledWith('session-1', '');
    // startGoalJudgeLoop NOT called (no new goal)
    expect(mockStartGoalJudgeLoop).not.toHaveBeenCalled();
  });

  it('A3. GoalLoop with no active session: logs warn, does NOT start judge loop', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetProjectState.mockReturnValue({ currentProjectId: 'project-1' });
    mockGetSessionState.mockReturnValue({
      activeSessionId: null,
      setSessionGoal: mockSetSessionGoal,
    });

    await dispatch({ kind: 'GoalLoop', command: goalCmd, args: 'fix login', goal: 'fix login' });

    expect(warnSpy).toHaveBeenCalledWith('[dispatcher] GoalLoop: no active session');
    expect(mockStartGoalJudgeLoop).not.toHaveBeenCalled();
    expect(mockSetSessionGoal).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('B. SystemLocal: 08.2 P4 — opens useContextModalStore modal, NO toast, NO sendMessage (C2-03)', async () => {
    mockGetProjectState.mockReturnValue({ currentProjectId: 'project-1' });
    mockGetSessionState.mockReturnValue({ activeSessionId: 'session-1' });

    await dispatch({ kind: 'SystemLocal', command: contextCmd, args: '' });

    // C2-04 dual entry: /context slash command opens the same modal
    expect(mockContextModalOpen).toHaveBeenCalled();
    // C2-03: /context does NOT enter the chat stream
    expect(mockSendMessage).not.toHaveBeenCalled();
    // No toast: the modal is the only feedback surface (UI-SPEC.md §Surface 2)
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
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
