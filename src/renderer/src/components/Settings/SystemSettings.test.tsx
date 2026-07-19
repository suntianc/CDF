import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '../../i18n';
import type { ConversationWorkingStateStorageStatus } from '@shared/conversation-working-state';
import { SystemSettings } from './SystemSettings';

const getStorageStatusMock = vi.fn<() => Promise<ConversationWorkingStateStorageStatus>>();
const optimizeStorageMock = vi.fn<() => Promise<ConversationWorkingStateStorageStatus>>();
const storeGetMock = vi.fn(async () => false);
const storeSetMock = vi.fn(async () => undefined);

function installElectronAPI() {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    store: { get: storeGetMock, set: storeSetMock },
    workingState: {
      getStorageStatus: getStorageStatusMock,
      optimizeStorage: optimizeStorageMock,
    },
  };
}

function normalStatus(overrides: Partial<ConversationWorkingStateStorageStatus> = {}): ConversationWorkingStateStorageStatus {
  return {
    phase: 'normal',
    maintenancePhase: null,
    physicalBytes: 1_572_864,
    estimatedReclaimableBytes: 524_288,
    blockedReason: null,
    failureReason: null,
    ...overrides,
  };
}

describe('SystemSettings Conversation Working State storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installElectronAPI();
    getStorageStatusMock.mockResolvedValue(normalStatus());
    optimizeStorageMock.mockResolvedValue(normalStatus());
  });

  it('shows formatted current and estimated reclaimable usage without technical internals', async () => {
    render(<SystemSettings />);

    const panel = await screen.findByRole('group', { name: /Conversation storage|会话存储/ });
    expect(within(panel).getByText('1.5 MB')).toBeTruthy();
    expect(within(panel).getByText('512 KB')).toBeTruthy();
    expect(within(panel).getByText(/Ready|正常/)).toBeTruthy();

    const visibleText = panel.textContent ?? '';
    expect(visibleText).not.toMatch(/thread|checkpoint|page count|freelist|database|sqlite|数据库|检查点|页数|线程/i);
    expect(screen.queryByText(/More advanced settings|更多高级设置/)).toBeNull();
  });

  it('provides an accessible loading state and refreshes the startup analysis result', async () => {
    let resolveStatus!: (status: ConversationWorkingStateStorageStatus) => void;
    getStorageStatusMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveStatus = resolve;
    }));

    render(<SystemSettings />);

    expect(screen.getByRole('status', { name: /Loading storage status|正在加载存储状态/ })).toBeTruthy();
    resolveStatus(normalStatus({ phase: 'analyzing', maintenancePhase: 'reconciling' }));
    expect(await screen.findByText(/Analyzing|正在分析/)).toBeTruthy();

    getStorageStatusMock.mockResolvedValueOnce(normalStatus());
    fireEvent.click(screen.getByRole('button', { name: /Refresh storage status|刷新存储状态/ }));
    await waitFor(() => expect(getStorageStatusMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Ready|正常/)).toBeTruthy();
  });

  it('shows lifecycle failure and IPC failure states without leaking error details', async () => {
    getStorageStatusMock.mockResolvedValueOnce(normalStatus({
      phase: 'failed',
      failureReason: 'STARTUP_RECONCILIATION_FAILED',
    }));
    const { unmount } = render(<SystemSettings />);

    expect(await screen.findByText(/Startup storage check failed|启动存储检查失败/)).toBeTruthy();
    unmount();

    getStorageStatusMock.mockRejectedValueOnce(new Error('SQLITE_CANTOPEN /Users/private/checkpoints.db'));
    render(<SystemSettings />);

    expect(await screen.findByText(/Storage status unavailable|无法获取存储状态/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('/Users/private/checkpoints.db');
  });

  it.each([
    ['ACTIVE_AGENT_RUN', /active work|当前任务/],
    ['ACTIVE_DELEGATED_AGENT_RUN', /delegated work|委派任务/],
    ['ACTIVE_CAPABILITY_JOB', /background work|后台任务/],
  ] as const)('disables optimization for %s and gives an accessible reason', async (blockedReason, reason) => {
    getStorageStatusMock.mockResolvedValueOnce(normalStatus({ blockedReason }));
    render(<SystemSettings />);

    const optimizeButton = await screen.findByRole('button', { name: /Optimize storage|优化存储/ });
    expect((optimizeButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(reason)).toBeTruthy();
  });

  it('requires confirmation with the duration and do-not-close warning', async () => {
    render(<SystemSettings />);
    const optimizeButton = await screen.findByRole('button', { name: /Optimize storage|优化存储/ });

    fireEvent.click(optimizeButton);

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/may take some time|可能需要一些时间/i)).toBeTruthy();
    expect(screen.getByText(/do not close CDF|请勿关闭 CDF/i)).toBeTruthy();
    expect(optimizeStorageMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Cancel|取消/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(optimizeStorageMock).not.toHaveBeenCalled();
  });

  it('stays responsive while pending, displays a real phase, and provides no cancellation control', async () => {
    let resolveOptimization!: (status: ConversationWorkingStateStorageStatus) => void;
    optimizeStorageMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveOptimization = resolve;
    }));
    getStorageStatusMock
      .mockResolvedValueOnce(normalStatus())
      .mockResolvedValueOnce(normalStatus({ phase: 'optimizing', maintenancePhase: 'rebuilding' }))
      .mockResolvedValue(normalStatus({ physicalBytes: 1_048_576, estimatedReclaimableBytes: 0 }));
    render(<SystemSettings />);

    fireEvent.click(await screen.findByRole('button', { name: /Optimize storage|优化存储/ }));
    fireEvent.click(screen.getByRole('button', { name: /Optimize now|立即优化/ }));

    expect(await screen.findByText(/Rebuilding storage|正在重建存储/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /Optimizing storage|正在优化存储/ }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(screen.queryByRole('button', { name: /Cancel optimization|取消优化/ })).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Refresh storage status|刷新存储状态/ }));
    expect(document.body.textContent).toMatch(/Rebuilding storage|正在重建存储/);

    resolveOptimization(normalStatus({ physicalBytes: 1_048_576, estimatedReclaimableBytes: 0 }));
    expect(await screen.findByText(/Optimization complete|优化完成/)).toBeTruthy();
  });

  it('stops maintenance status polling when the Electron window starts unloading', async () => {
    optimizeStorageMock.mockReturnValueOnce(new Promise(() => undefined));
    getStorageStatusMock
      .mockResolvedValueOnce(normalStatus())
      .mockResolvedValue(normalStatus({ phase: 'optimizing', maintenancePhase: 'rebuilding' }));
    render(<SystemSettings />);

    fireEvent.click(await screen.findByRole('button', { name: /Optimize storage|优化存储/ }));
    fireEvent.click(screen.getByRole('button', { name: /Optimize now|立即优化/ }));
    await waitFor(() => expect(getStorageStatusMock.mock.calls.length).toBeGreaterThanOrEqual(2));

    window.dispatchEvent(new Event('beforeunload'));
    const callsWhenUnloadStarted = getStorageStatusMock.mock.calls.length;
    await new Promise((resolve) => window.setTimeout(resolve, 350));

    expect(getStorageStatusMock).toHaveBeenCalledTimes(callsWhenUnloadStarted);
  });

  it('refreshes usage after success', async () => {
    getStorageStatusMock
      .mockResolvedValueOnce(normalStatus())
      .mockResolvedValueOnce(normalStatus({ phase: 'optimizing', maintenancePhase: 'validating' }))
      .mockResolvedValueOnce(normalStatus({ physicalBytes: 1_048_576, estimatedReclaimableBytes: 0 }));
    optimizeStorageMock.mockResolvedValueOnce(normalStatus({
      physicalBytes: 1_048_576,
      estimatedReclaimableBytes: 0,
    }));
    render(<SystemSettings />);

    fireEvent.click(await screen.findByRole('button', { name: /Optimize storage|优化存储/ }));
    fireEvent.click(screen.getByRole('button', { name: /Optimize now|立即优化/ }));

    expect(await screen.findByText(/Optimization complete|优化完成/)).toBeTruthy();
    expect(screen.getByText('1 MB')).toBeTruthy();
    expect(screen.getByText('0 B')).toBeTruthy();
    expect(getStorageStatusMock).toHaveBeenCalledTimes(3);
  });

  it('keeps prior usage on failure and allows a later retry', async () => {
    optimizeStorageMock
      .mockResolvedValueOnce(normalStatus({
        phase: 'failed',
        failureReason: 'INTEGRITY_CHECK_FAILED',
      }))
      .mockResolvedValueOnce(normalStatus({
        physicalBytes: 1_048_576,
        estimatedReclaimableBytes: 0,
      }));
    getStorageStatusMock
      .mockResolvedValueOnce(normalStatus())
      .mockResolvedValueOnce(normalStatus({ phase: 'optimizing', maintenancePhase: 'validating' }))
      .mockResolvedValueOnce(normalStatus({ phase: 'optimizing', maintenancePhase: 'replacing' }))
      .mockResolvedValueOnce(normalStatus({ physicalBytes: 1_048_576, estimatedReclaimableBytes: 0 }));
    render(<SystemSettings />);

    fireEvent.click(await screen.findByRole('button', { name: /Optimize storage|优化存储/ }));
    fireEvent.click(screen.getByRole('button', { name: /Optimize now|立即优化/ }));

    expect(await screen.findByText(/Storage validation failed|存储验证失败/)).toBeTruthy();
    expect(screen.getByText('1.5 MB')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Retry optimization|重试优化/ }));
    fireEvent.click(screen.getByRole('button', { name: /Optimize now|立即优化/ }));

    expect(await screen.findByText(/Optimization complete|优化完成/)).toBeTruthy();
    expect(optimizeStorageMock).toHaveBeenCalledTimes(2);
  });
});
