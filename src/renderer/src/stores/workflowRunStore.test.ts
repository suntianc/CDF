import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowRunStore } from './workflowRunStore';
import { useSessionStore } from './sessionStore';
import type { WorkflowRun, WorkflowStageGate } from '../../../shared/types';
import { initialProjectionState } from '../components/WorkflowRunView/workflowRunProjection';

// ---- helpers ----

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  const now = Date.now();
  return {
    id: 'run-1',
    workflow_id: 'wf-1',
    project_id: 'proj-1',
    session_id: 'session-1',
    status: 'running',
    current_stage_index: 0,
    total_stages: 2,
    master_agent_id: 'agent-1',
    stages: JSON.stringify([
      { id: 'stage-1', name: 'Stage 1', taskDescription: 'Task 1', acceptanceCriteria: 'criterion 1', gateEnabled: true },
      { id: 'stage-2', name: 'Stage 2', taskDescription: 'Task 2', acceptanceCriteria: ['criterion 2a', 'criterion 2b'], gateEnabled: true },
    ]),
    skeleton_snapshot: null,
    error: null,
    started_at: now,
    ended_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}


// ---- setup ----

beforeEach(() => {
  vi.restoreAllMocks();

  // 默认 mock：所有调用尽可能快返回空/健康数据
  window.electronAPI = {
    store: { get: vi.fn(), set: vi.fn() },
    db: {
      getMessages: vi.fn(),
      saveMessage: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      getProviders: vi.fn(),
      saveProvider: vi.fn(),
      deleteProvider: vi.fn(),
      selectDirectory: vi.fn(),
    },
    llm: {
      chat: vi.fn(),
      judge: vi.fn(),
      stopChat: vi.fn(),
      testProvider: vi.fn(),
      fetchProviderModels: vi.fn(),
      fetchOllamaModels: vi.fn(),
      onChunk: vi.fn(() => () => {}),
    },
    deepagents: { onParallelTaskStep: vi.fn(() => () => {}) },
    platform: 'darwin',
    workflowRun: {
      start: vi.fn(),
      getRuns: vi.fn(),
      getRun: vi.fn(),
      getRunBySession: vi.fn(),
      getStageGates: vi.fn(),
      resolveStageGate: vi.fn(),
      abort: vi.fn(),
      getTasks: vi.fn(),
    },
  } as unknown as Window['electronAPI'];

  useWorkflowRunStore.setState({
    activeRun: null,
    projectionState: initialProjectionState,
    isLoading: false,
    error: null,
    _requestSeq: 0,
  });
  useSessionStore.setState({ pendingApproval: null });
});

// ---- tests ----

describe('workflowRunStore.loadRunForSession', () => {
  it('loads a run and its gates/tasks when session has a run', async () => {
    const runA = makeRun({ id: 'run-a', session_id: 'session-a' });

    vi.mocked(window.electronAPI.workflowRun.getRunBySession).mockResolvedValue(runA);
    vi.mocked(window.electronAPI.workflowRun.getStageGates).mockResolvedValue([]);
    vi.mocked(window.electronAPI.workflowRun.getTasks).mockResolvedValue([]);

    await useWorkflowRunStore.getState().loadRunForSession('session-a');

    const state = useWorkflowRunStore.getState();
    expect(state.activeRun?.id).toBe('run-a');
    expect(state.projectionState.run?.id).toBe('run-a');
  });

  it('clears state when session has no run', async () => {
    // 先设置一个已有 run
    useWorkflowRunStore.setState({
      activeRun: makeRun({ id: 'old-run' }),
      projectionState: { ...initialProjectionState, run: { id: 'old-run', status: 'completed', currentStageIndex: 0, error: null } },
    });

    vi.mocked(window.electronAPI.workflowRun.getRunBySession).mockResolvedValue(null);

    await useWorkflowRunStore.getState().loadRunForSession('session-empty');

    const state = useWorkflowRunStore.getState();
    expect(state.activeRun).toBeNull();
    expect(state.projectionState.run).toBeNull();
  });

  it('slow response A does not overwrite state set by fast response B', async () => {
    let resolveA!: (run: WorkflowRun) => void;
    let resolveB!: (run: WorkflowRun) => void;

    const runB = makeRun({ id: 'run-b', session_id: 'session-b' });

    // A: 慢 — 需要手动 resolve
    vi.mocked(window.electronAPI.workflowRun.getRunBySession).mockImplementation(async (sessionId) => {
      if (sessionId === 'session-a') {
        return new Promise<WorkflowRun>((resolve) => { resolveA = resolve; });
      }
      if (sessionId === 'session-b') {
        return new Promise<WorkflowRun>((resolve) => { resolveB = resolve; });
      }
      return null;
    });

    vi.mocked(window.electronAPI.workflowRun.getStageGates).mockResolvedValue([]);
    vi.mocked(window.electronAPI.workflowRun.getTasks).mockResolvedValue([]);

    // 同时发起两个请求
    const promiseA = useWorkflowRunStore.getState().loadRunForSession('session-a');
    const promiseB = useWorkflowRunStore.getState().loadRunForSession('session-b');

    // B 先完成
    resolveB(runB);
    await promiseB;

    // 验证 B 已设置
    expect(useWorkflowRunStore.getState().activeRun?.id).toBe('run-b');

    // A 慢返回 — 应被丢弃
    resolveA(makeRun({ id: 'run-a', session_id: 'session-a' }));
    await promiseA;

    // 终态应是 B 而非 A
    expect(useWorkflowRunStore.getState().activeRun?.id).toBe('run-b');
  });

  it('slow no-run response does not clear a later successful load', async () => {
    let resolveA!: (run: WorkflowRun | null) => void;
    let resolveB!: (run: WorkflowRun) => void;

    const runB = makeRun({ id: 'run-b', session_id: 'session-b' });

    vi.mocked(window.electronAPI.workflowRun.getRunBySession).mockImplementation(async (sessionId) => {
      if (sessionId === 'session-a') {
        return new Promise<WorkflowRun | null>((resolve) => { resolveA = resolve; });
      }
      if (sessionId === 'session-b') {
        return new Promise<WorkflowRun>((resolve) => { resolveB = resolve; });
      }
      return null;
    });

    vi.mocked(window.electronAPI.workflowRun.getStageGates).mockResolvedValue([]);
    vi.mocked(window.electronAPI.workflowRun.getTasks).mockResolvedValue([]);

    // 先设一个已有 run，模拟正常态
    useWorkflowRunStore.setState({
      activeRun: makeRun({ id: 'run-b' }),
      projectionState: { ...initialProjectionState, run: { id: 'run-b', status: 'running', currentStageIndex: 0, error: null } },
    });

    // 同时发起：A 慢（最终 no-run）、B
    const promiseA = useWorkflowRunStore.getState().loadRunForSession('session-a');
    const promiseB = useWorkflowRunStore.getState().loadRunForSession('session-b');

    // B 先完成并且有数据
    resolveB(runB);
    await promiseB;
    expect(useWorkflowRunStore.getState().activeRun?.id).toBe('run-b');

    // A 最后返回 null（no-run）
    resolveA(null);
    await promiseA;

    // 不应被 A 的 no-run 状态覆盖
    expect(useWorkflowRunStore.getState().activeRun?.id).toBe('run-b');
    expect(useWorkflowRunStore.getState().projectionState.run?.id).toBe('run-b');
  });

  it('slow error response does not affect a later successful load', async () => {
    let rejectA!: (err: Error) => void;
    let resolveB!: (run: WorkflowRun) => void;

    const runB = makeRun({ id: 'run-b', session_id: 'session-b' });

    vi.mocked(window.electronAPI.workflowRun.getRunBySession).mockImplementation(async (sessionId) => {
      if (sessionId === 'session-a') {
        return new Promise<WorkflowRun>((_resolve, reject) => { rejectA = reject; });
      }
      if (sessionId === 'session-b') {
        return new Promise<WorkflowRun>((resolve) => { resolveB = resolve; });
      }
      return null;
    });

    vi.mocked(window.electronAPI.workflowRun.getStageGates).mockResolvedValue([]);
    vi.mocked(window.electronAPI.workflowRun.getTasks).mockResolvedValue([]);

    const promiseA = useWorkflowRunStore.getState().loadRunForSession('session-a');
    const promiseB = useWorkflowRunStore.getState().loadRunForSession('session-b');

    // B 先完成
    resolveB(runB);
    await promiseB;
    expect(useWorkflowRunStore.getState().activeRun?.id).toBe('run-b');

    // A 最后抛错 — 应被静默忽略且不污染 activeRun 或 error
    rejectA(new Error('stale error'));
    await promiseA;

    const state = useWorkflowRunStore.getState();
    expect(state.activeRun?.id).toBe('run-b');
    expect(state.error).toBeNull();
  });

  it('clear invalidates an in-flight request', async () => {
    let resolveA!: (run: WorkflowRun) => void;

    vi.mocked(window.electronAPI.workflowRun.getRunBySession).mockImplementation(async () => {
      return new Promise<WorkflowRun>((resolve) => { resolveA = resolve; });
    });

    vi.mocked(window.electronAPI.workflowRun.getStageGates).mockResolvedValue([]);
    vi.mocked(window.electronAPI.workflowRun.getTasks).mockResolvedValue([]);

    // 先设一个已有 run
    useWorkflowRunStore.setState({
      activeRun: makeRun({ id: 'existing-run' }),
      projectionState: { ...initialProjectionState, run: { id: 'existing-run', status: 'running', currentStageIndex: 0, error: null } },
    });

    const promise = useWorkflowRunStore.getState().loadRunForSession('session-a');

    // clear 在前
    useWorkflowRunStore.getState().clear();

    // 慢请求回来后不应污染已清除的状态
    resolveA(makeRun({ id: 'stale-run', session_id: 'session-a' }));
    await promise;

    const state = useWorkflowRunStore.getState();
    expect(state.activeRun).toBeNull();
    expect(state.projectionState.run).toBeNull();
  });
  it('restores pending stage gates in projection after load', async () => {
    const run = makeRun({ id: 'run-gates', session_id: 'session-gates', current_stage_index: 1 });
    const gates: WorkflowStageGate[] = [
      {
        id: 'gate-stage-1',
        run_id: 'run-gates',
        stage_id: 'stage-1',
        stage_name: 'Stage 1',
        report: { summary: 'Accepted', acceptanceSelfCheck: [], artifacts: [] },
        status: 'approved',
        feedback: null,
        created_at: Date.now() - 1000,
        decided_at: Date.now() - 500,
      },
      {
        id: 'gate-1',
        run_id: 'run-gates',
        stage_id: 'stage-2',
        stage_name: 'Stage 2',
        report: { summary: 'Pending approval', acceptanceSelfCheck: [], artifacts: [] },
        status: 'pending',
        feedback: null,
        created_at: Date.now(),
        decided_at: null,
      },
    ];

    vi.mocked(window.electronAPI.workflowRun.getRunBySession).mockResolvedValue(run);
    vi.mocked(window.electronAPI.workflowRun.getStageGates).mockResolvedValue(gates);
    vi.mocked(window.electronAPI.workflowRun.getTasks).mockResolvedValue([]);

    await useWorkflowRunStore.getState().loadRunForSession('session-gates');

    const state = useWorkflowRunStore.getState();

    // 投影应包含 gate 记录，而非仅运行时状态
    expect(state.projectionState.gates['gate-1']).toBeDefined();
    expect(state.projectionState.gates['gate-1'].status).toBe('pending');
    expect(state.projectionState.gates['gate-1'].stage_id).toBe('stage-2');

    // 对应 stage 应为 waiting_gate 状态以便显示审批卡片
    const stage2 = state.projectionState.stages.find((s) => s.id === 'stage-2');
    expect(stage2).toBeDefined();
    expect(stage2!.status).toBe('waiting_gate');

    // stage-1 (current_stage_index=0) 已通过
    const stage1 = state.projectionState.stages.find((s) => s.id === 'stage-1');
    expect(stage1).toBeDefined();
    expect(stage1!.status).toBe('passed');

    // timeline 可直接消费 workflowRunStore 的 pending gates
    const pendingGates = Object.values(state.projectionState.gates).filter((g) => g.status === 'pending');
    expect(pendingGates).toHaveLength(1);
    expect(useSessionStore.getState().pendingApproval).toMatchObject({
      id: 'gate-1',
      runId: 'run-gates',
      actions: [{ name: 'advance_stage' }],
    });
    expect(pendingGates[0].id).toBe('gate-1');
  });
});
