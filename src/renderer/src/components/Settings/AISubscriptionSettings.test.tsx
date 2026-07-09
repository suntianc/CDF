import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '../../i18n';
import {
  buildAISubscriptionEntries,
  setAISubscriptionCapabilityEnabled,
  type AISubscriptionEntry,
  type PersistedAISubscriptionState,
} from '@shared/ai-subscriptions';
import { AISubscriptionSettings } from './AISubscriptionSettings';

const getEntriesMock = vi.fn<() => Promise<AISubscriptionEntry[]>>();
const setCapabilityEnabledMock = vi.fn();
const refreshStatusMock = vi.fn();
const connectWithKeyMock = vi.fn();
const disconnectMock = vi.fn();

function installElectronAPI(entries: AISubscriptionEntry[]) {
  getEntriesMock.mockResolvedValue(entries);
  setCapabilityEnabledMock.mockResolvedValue(entries);
  connectWithKeyMock.mockResolvedValue(entries);
  disconnectMock.mockResolvedValue(entries);
  refreshStatusMock.mockResolvedValue(entries);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    aiSubscriptions: {
      getEntries: getEntriesMock,
      setCapabilityEnabled: setCapabilityEnabledMock,
      refreshStatus: refreshStatusMock,
      connectWithKey: connectWithKeyMock,
      disconnect: disconnectMock,
    },
  };
}

describe('AISubscriptionSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installElectronAPI(buildAISubscriptionEntries());
  });

  it('renders the MiniMax Token Plan card as the only subscription entry', async () => {
    render(<AISubscriptionSettings />);

    expect(await screen.findByText('MiniMax Token Plan')).toBeTruthy();
    expect(screen.queryByText('Codex OAuth')).toBeNull();
    expect(screen.queryByText('xAI OAuth')).toBeNull();
    expect(screen.queryByText('Antigravity OAuth')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Login$|^登录$/ })).toHaveLength(1);
    expect(screen.queryByText(/^Image generation$|^图像生成$/)).toBeNull();

    const visibleText = document.body.textContent ?? '';
    expect(visibleText).not.toMatch(/adapter|endpoint|refresh token|subscription key|route id|model id/i);
  });

  it('previews disabled capability switches when a logged-out card expands', async () => {
    render(<AISubscriptionSettings />);

    fireEvent.click(await screen.findByRole('button', { name: /Expand MiniMax Token Plan|展开 MiniMax Token Plan/ }));

    const imageSwitch = screen.getByRole('switch', { name: /^Image generation$|^图像生成$/ }) as HTMLInputElement;
    expect(imageSwitch.disabled).toBe(true);
    expect(imageSwitch.checked).toBe(true);
    expect((screen.getByRole('switch', { name: /^Speech generation$|^语音生成$/ }) as HTMLInputElement).disabled).toBe(true);
  });

  it('renders localized fallback errors when the read path fails', async () => {
    getEntriesMock.mockRejectedValue(new Error(''));

    render(<AISubscriptionSettings />);

    expect(await screen.findByText('加载 AI 订阅失败')).toBeTruthy();
    expect(document.body.textContent ?? '').not.toContain('Failed to load AI subscriptions');
  });

  it('persists one connected subscription capability switch without disabling siblings', async () => {
    const connected: PersistedAISubscriptionState = {
      entries: {
        'minimax-token-plan': { status: 'connected' },
      },
    };
    const initialEntries = buildAISubscriptionEntries(connected);
    const persistedOff = setAISubscriptionCapabilityEnabled(
      connected,
      'minimax-token-plan',
      'image.generate',
      false
    );
    installElectronAPI(initialEntries);
    setCapabilityEnabledMock.mockResolvedValue(buildAISubscriptionEntries(persistedOff));

    render(<AISubscriptionSettings />);

    fireEvent.click(await screen.findByRole('button', { name: /Expand MiniMax Token Plan|展开 MiniMax Token Plan/ }));

    const card = screen.getByRole('group', { name: 'MiniMax Token Plan' });
    const imageSwitch = within(card).getByRole('switch', { name: /^Image generation$|^图像生成$/ }) as HTMLInputElement;
    const musicSwitch = within(card).getByRole('switch', { name: /^Music generation$|^音乐生成$/ }) as HTMLInputElement;
    expect(imageSwitch.disabled).toBe(false);
    expect(imageSwitch.checked).toBe(true);
    expect(musicSwitch.checked).toBe(true);
    // Always-on capabilities are not exposed as switches
    expect(within(card).queryByRole('switch', { name: /^Text chat$|^文本聊天$/ })).toBeNull();
    expect(within(card).queryByRole('switch', { name: /^Quota status$|^配额状态$/ })).toBeNull();

    fireEvent.click(imageSwitch);

    await waitFor(() => expect(setCapabilityEnabledMock).toHaveBeenCalledWith(
      'minimax-token-plan',
      'image.generate',
      false
    ));
    expect((await within(card).findByRole('switch', { name: /^Image generation$|^图像生成$/ }) as HTMLInputElement).checked).toBe(false);
    expect((within(card).getByRole('switch', { name: /^Music generation$|^音乐生成$/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('refreshes connection status from a connected MiniMax card', async () => {
    const connected = buildAISubscriptionEntries({
      entries: {
        'minimax-token-plan': { status: 'connected' },
      },
    });
    installElectronAPI(connected);
    refreshStatusMock.mockResolvedValue(connected);

    render(<AISubscriptionSettings />);

    const card = await screen.findByRole('group', { name: 'MiniMax Token Plan' });
    fireEvent.click(within(card).getByRole('button', { name: /^Refresh$|^刷新$/ }));

    await waitFor(() => expect(refreshStatusMock).toHaveBeenCalledWith('minimax-token-plan'));
  });

  it('connects MiniMax with a subscription key entered on its card', async () => {
    render(<AISubscriptionSettings />);

    const card = await screen.findByRole('group', { name: 'MiniMax Token Plan' });
    fireEvent.click(within(card).getByRole('button', { name: /^Login$|^登录$/ }));

    const input = within(card).getByLabelText(/Subscription key|订阅 Key/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'sk-my-key' } });
    fireEvent.click(within(card).getByRole('button', { name: /^Connect$|^连接$/ }));

    await waitFor(() => expect(connectWithKeyMock).toHaveBeenCalledWith('minimax-token-plan', 'sk-my-key'));
  });

  it('disconnects a connected MiniMax subscription from its card', async () => {
    const connected = buildAISubscriptionEntries({
      entries: { 'minimax-token-plan': { status: 'connected' } },
    });
    installElectronAPI(connected);
    disconnectMock.mockResolvedValue(buildAISubscriptionEntries());

    render(<AISubscriptionSettings />);

    const card = await screen.findByRole('group', { name: 'MiniMax Token Plan' });
    fireEvent.click(within(card).getByRole('button', { name: /^Disconnect$|^断开$/ }));

    await waitFor(() => expect(disconnectMock).toHaveBeenCalledWith('minimax-token-plan'));
  });

  it('shows MiniMax quota summary values when the route reports them', async () => {
    const entries = buildAISubscriptionEntries({
      entries: {
        'minimax-token-plan': {
          status: 'connected',
          usageSummaries: [
            { period: 'weekly', label: 'Weekly quota', used: 128_000, limit: 500_000 },
            { period: 'five_hour', label: '5-hour quota', used: 18_000, limit: 100_000 },
          ],
        },
      },
    });
    installElectronAPI(entries);

    render(<AISubscriptionSettings />);

    const card = await screen.findByRole('group', { name: 'MiniMax Token Plan' });
    expect(within(card).getByText(/128,000|128\.000/)).toBeTruthy();
    expect(within(card).getByText(/500,000|500\.000/)).toBeTruthy();
  });
});
