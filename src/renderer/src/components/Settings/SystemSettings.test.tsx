import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '../../i18n';
import type { ConversationWorkingStateStorageStatus } from '@shared/conversation-working-state';
import { SystemSettings } from './SystemSettings';

const getStorageStatusMock = vi.fn<() => Promise<ConversationWorkingStateStorageStatus>>();
const storeGetMock = vi.fn(async () => false);
const storeSetMock = vi.fn(async () => undefined);

function installElectronAPI() {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    store: { get: storeGetMock, set: storeSetMock },
    workingState: { getStorageStatus: getStorageStatusMock },
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
});
