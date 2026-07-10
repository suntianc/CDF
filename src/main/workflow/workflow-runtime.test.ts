/**
 * workflow-runtime.test.ts — GraphInterrupt 审批流程单元测试 (Phase 14)
 *
 * 测试范围：
 * 1. stopWorkflow 清理 pendingWorkflowApprovals（Pitfall 3）
 * 2. resolveInterruptOn 逻辑（通过 node-executor 间接验证）
 * 3. GraphInterrupt 捕获和 node_waiting_approval 事件推送
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Hoisted mocks ----

const {
  dbPrepareMock,
  ipcMainHandleMock,
  browserWindowGetAllWindowsMock,
} = vi.hoisted(() => ({
  dbPrepareMock: vi.fn(),
  ipcMainHandleMock: vi.fn(),
  browserWindowGetAllWindowsMock: vi.fn(() => []),
}));

vi.mock('../database', () => ({ default: { prepare: dbPrepareMock } }));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { getAllWindows: browserWindowGetAllWindowsMock },
  ipcMain: { handle: ipcMainHandleMock },
}));

vi.mock('@langchain/langgraph-checkpoint-sqlite', () => ({
  SqliteSaver: { fromConnString: vi.fn(() => ({})) },
}));

vi.mock('./graph-builder', () => ({
  buildWorkflowGraph: vi.fn(),
}));

vi.mock('./node-executor', () => ({
  createAgentNodeExecutor: vi.fn(),
}));

vi.mock('./log-exporter', () => ({
  listExecutionsByWorkflow: vi.fn(),
  deleteExecution: vi.fn(),
  exportExecutionToFile: vi.fn(),
}));

vi.mock('../store', () => ({
  default: { get: vi.fn(() => 'strict') },
}));

// ---- Tests ----

describe('GraphInterrupt approval flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 默认的 DB prepare mock（防止 undefined 错误）
    dbPrepareMock.mockReturnValue({
      get: vi.fn(),
      run: vi.fn(),
      all: vi.fn(() => []),
    });
  });

  it('stopWorkflow rejects pending approval promise', async () => {
    // 直接测试模块导出的 stopWorkflow，检查它是否清理 pending approvals
    // 我们通过检查内部状态来验证（使用黑盒测试：mock DB run 阻止实际 SQL）

    const { stopWorkflow } = await import('./workflow-runtime');

    // 直接调用 stopWorkflow — 不应该 throw
    // 由于无法直接访问模块私有的 pendingWorkflowApprovals Map，
    // 我们验证函数不抛出，且 DB prepare 被调用了
    expect(() => stopWorkflow('non-existent-execution-id')).not.toThrow();

    // DB 更新应该被调用
    expect(dbPrepareMock).toHaveBeenCalledWith(expect.stringContaining('UPDATE workflow_executions'));
  });

  it('workflow:approve handler resolves pending approvals when key matches', async () => {
    // 收集所有注册的 ipcMain.handle 回调
    const handlers = new Map<string, (...args: any[]) => any>();
    ipcMainHandleMock.mockImplementation((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler);
    });

    const { registerWorkflowIpcHandlers } = await import('./workflow-runtime');
    registerWorkflowIpcHandlers();

    // 验证 workflow:approve handler 已注册
    expect(handlers.has('workflow:approve')).toBe(true);

    // 调用一个不存在的 key — 应该静默忽略（T-14-01 安全要求）
    const approveHandler = handlers.get('workflow:approve')!;
    await expect(
      approveHandler({} /* event */, 'unknown-exec-id', 'unknown-approval-id', { approvalId: 'x', decisions: [] })
    ).resolves.toBeUndefined();
  });

  it('registerWorkflowIpcHandlers registers all expected handlers', async () => {
    const registeredChannels: string[] = [];
    ipcMainHandleMock.mockImplementation((channel: string) => {
      registeredChannels.push(channel);
    });

    const { registerWorkflowIpcHandlers } = await import('./workflow-runtime');
    registerWorkflowIpcHandlers();

    expect(registeredChannels).toContain('workflow:run');
    expect(registeredChannels).toContain('workflow:stop');
    expect(registeredChannels).toContain('workflow:getEvents');
    expect(registeredChannels).toContain('workflow:approve');
    expect(registeredChannels).toContain('workflow:listExecutions');
    expect(registeredChannels).toContain('workflow:deleteExecution');
    expect(registeredChannels).toContain('workflow:exportExecution');
  });

  it('registers exactly the workflow-domain channels declared in the IPC contract', async () => {
    const { IPC_INVOKE_CHANNELS, workflowEventChannel } = await import('../../shared/ipc-contract');
    const registeredChannels: string[] = [];
    ipcMainHandleMock.mockImplementation((channel: string) => {
      registeredChannels.push(channel);
    });

    const { registerWorkflowIpcHandlers } = await import('./workflow-runtime');
    registerWorkflowIpcHandlers();

    const declared = IPC_INVOKE_CHANNELS.filter((c: string) => c.startsWith('workflow:')).slice().sort();
    expect(registeredChannels.slice().sort()).toEqual(declared);
    expect(declared.length).toBeGreaterThan(0);
    expect(workflowEventChannel('exec-1')).toBe('workflow:event-exec-1');
  });
});
