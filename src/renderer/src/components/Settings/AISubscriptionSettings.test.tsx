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
const getActiveLoginsMock = vi.fn();
const setCapabilityEnabledMock = vi.fn();
const refreshStatusMock = vi.fn();
const connectWithKeyMock = vi.fn();
const startLoginMock = vi.fn();
const pollLoginMock = vi.fn();
const cancelLoginMock = vi.fn();
const disconnectMock = vi.fn();
const openExternalUrlMock = vi.fn();

function installElectronAPI(entries: AISubscriptionEntry[]) {
  getEntriesMock.mockResolvedValue(entries);
  getActiveLoginsMock.mockResolvedValue({});
  setCapabilityEnabledMock.mockResolvedValue(entries);
  connectWithKeyMock.mockResolvedValue(entries);
  startLoginMock.mockResolvedValue({ entries, descriptor: undefined });
  pollLoginMock.mockResolvedValue({ entries, status: 'logged_out' });
  cancelLoginMock.mockResolvedValue(entries);
  disconnectMock.mockResolvedValue(entries);
  refreshStatusMock.mockResolvedValue(entries);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    aiSubscriptions: {
      getEntries: getEntriesMock,
      getActiveLogins: getActiveLoginsMock,
      setCapabilityEnabled: setCapabilityEnabledMock,
      refreshStatus: refreshStatusMock,
      connectWithKey: connectWithKeyMock,
      startLogin: startLoginMock,
      pollLogin: pollLoginMock,
      cancelLogin: cancelLoginMock,
      disconnect: disconnectMock,
    },
    shell: {
      openExternalUrl: openExternalUrlMock,
    },
  };
}

describe('AISubscriptionSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installElectronAPI(buildAISubscriptionEntries());
  });

  it('renders MiniMax, Codex, and xAI Grok subscription entrypoints', async () => {
    render(<AISubscriptionSettings />);

    expect(await screen.findByText('MiniMax Token Plan')).toBeTruthy();
    expect(screen.getByText('Codex OAuth')).toBeTruthy();
    expect(screen.getByText('xAI Grok OAuth')).toBeTruthy();
    expect(screen.queryByText('Antigravity OAuth')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Login$|^登录$/ })).toHaveLength(3);
    expect(screen.queryByText(/^Image generation$|^图像生成$/)).toBeNull();

    const visibleText = document.body.textContent ?? '';
    expect(visibleText).not.toMatch(/adapter|endpoint|refresh token|subscription key|route id|model id/i);
  });

  it('starts Codex device login from its card and shows the user code', async () => {
    const entries = buildAISubscriptionEntries();
    installElectronAPI(entries);
    startLoginMock.mockResolvedValue({
      entries: buildAISubscriptionEntries({
        entries: { 'codex-oauth': { status: 'connecting' } },
      }),
      descriptor: {
        attemptId: 'attempt-1',
        flow: 'device_code',
        verificationUrl: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-1234',
        expiresAt: Date.now() + 900_000,
        pollIntervalMs: 5_000,
      },
    });

    render(<AISubscriptionSettings />);

    const card = await screen.findByRole('group', { name: 'Codex OAuth' });
    fireEvent.click(within(card).getByRole('button', { name: /^Login$|^登录$/ }));

    await waitFor(() => expect(startLoginMock).toHaveBeenCalledWith('codex-oauth'));
    await waitFor(() => expect(openExternalUrlMock).toHaveBeenCalledWith(
      'https://auth.openai.com/codex/device'
    ));
    expect(await within(card).findByText('ABCD-1234')).toBeTruthy();
    expect(within(card).getByText('https://auth.openai.com/codex/device')).toBeTruthy();
    expect(within(card).queryByLabelText(/Subscription key|订阅 Key/)).toBeNull();
  });

  it('offers direct reauthentication when an OAuth credential has expired', async () => {
    const expired = buildAISubscriptionEntries({
      entries: { 'codex-oauth': { status: 'expired' } },
    });
    installElectronAPI(expired);

    render(<AISubscriptionSettings />);

    const card = await screen.findByRole('group', { name: 'Codex OAuth' });
    fireEvent.click(within(card).getByRole('button', { name: /^Reconnect$|^重新连接$/ }));
    await waitFor(() => expect(startLoginMock).toHaveBeenCalledWith('codex-oauth'));
  });

  it('offers refresh, reconnect, and disconnect for an unavailable xAI entitlement', async () => {
    const unavailable = buildAISubscriptionEntries({
      entries: { 'xai-oauth': { status: 'unavailable' } },
    });
    installElectronAPI(unavailable);

    render(<AISubscriptionSettings />);

    const card = await screen.findByRole('group', { name: 'xAI Grok OAuth' });
    expect(within(card).getByRole('button', { name: /^Refresh$|^刷新$/ })).toBeTruthy();
    expect(within(card).getByRole('button', { name: /^Disconnect$|^断开$/ })).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: /^Reconnect$|^重新连接$/ }));
    await waitFor(() => expect(startLoginMock).toHaveBeenCalledWith('xai-oauth'));
  });

  it('automatically polls Codex login until the card becomes connected', async () => {
    const loggedOut = buildAISubscriptionEntries();
    const connecting = buildAISubscriptionEntries({
      entries: { 'codex-oauth': { status: 'connecting' } },
    });
    const connected = buildAISubscriptionEntries({
      entries: { 'codex-oauth': { status: 'connected' } },
    });
    installElectronAPI(loggedOut);
    startLoginMock.mockResolvedValue({
      entries: connecting,
      descriptor: {
        attemptId: 'attempt-1',
        flow: 'device_code',
        verificationUrl: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-1234',
        expiresAt: Date.now() + 900_000,
        pollIntervalMs: 1,
      },
    });
    pollLoginMock.mockResolvedValue({ entries: connected, status: 'connected' });

    render(<AISubscriptionSettings />);
    const card = await screen.findByRole('group', { name: 'Codex OAuth' });
    fireEvent.click(within(card).getByRole('button', { name: /^Login$|^登录$/ }));

    await waitFor(() => expect(pollLoginMock).toHaveBeenCalledWith('codex-oauth', 'attempt-1'));
    expect(await within(card).findByText(/^Connected$|^已连接$/)).toBeTruthy();
    expect(within(card).queryByText('ABCD-1234')).toBeNull();
  });

  it('resumes a safe in-memory device attempt after the renderer reloads', async () => {
    const connecting = buildAISubscriptionEntries({
      entries: { 'codex-oauth': { status: 'connecting' } },
    });
    const connected = buildAISubscriptionEntries({
      entries: { 'codex-oauth': { status: 'connected' } },
    });
    installElectronAPI(connecting);
    getActiveLoginsMock.mockResolvedValue({
      'codex-oauth': {
        attemptId: 'attempt-after-reload',
        flow: 'device_code',
        verificationUrl: 'https://auth.openai.com/codex/device',
        userCode: 'RELOAD-1234',
        expiresAt: Date.now() + 900_000,
        pollIntervalMs: 1,
      },
    });
    pollLoginMock.mockResolvedValue({ entries: connected, status: 'connected' });

    render(<AISubscriptionSettings />);

    const card = await screen.findByRole('group', { name: 'Codex OAuth' });
    expect(getActiveLoginsMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(pollLoginMock).toHaveBeenCalledWith(
      'codex-oauth',
      'attempt-after-reload'
    ));
    expect(await within(card).findByText(/^Connected$|^已连接$/)).toBeTruthy();
  });

  it('cancels an in-progress Codex login when the card is disconnected', async () => {
    const loggedOut = buildAISubscriptionEntries();
    const connecting = buildAISubscriptionEntries({
      entries: { 'codex-oauth': { status: 'connecting' } },
    });
    installElectronAPI(loggedOut);
    startLoginMock.mockResolvedValue({
      entries: connecting,
      descriptor: {
        attemptId: 'attempt-1',
        flow: 'device_code',
        verificationUrl: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-1234',
        expiresAt: Date.now() + 900_000,
        pollIntervalMs: 60_000,
      },
    });

    render(<AISubscriptionSettings />);
    const card = await screen.findByRole('group', { name: 'Codex OAuth' });
    fireEvent.click(within(card).getByRole('button', { name: /^Login$|^登录$/ }));
    expect(await within(card).findByText('ABCD-1234')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: /^Refresh$|^刷新$/ })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: /^Disconnect$|^断开$/ }));

    await waitFor(() => expect(cancelLoginMock).toHaveBeenCalledWith('codex-oauth', 'attempt-1'));
    expect(within(card).queryByText('ABCD-1234')).toBeNull();
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

  it('shows separately routable media switches for Codex and Grok', async () => {
    installElectronAPI(buildAISubscriptionEntries({
      entries: {
        'codex-oauth': { status: 'connected' },
        'xai-oauth': { status: 'connected' },
      },
    }));

    render(<AISubscriptionSettings />);

    const codexCard = await screen.findByRole('group', { name: 'Codex OAuth' });
    fireEvent.click(within(codexCard).getByRole('button', { name: /Expand Codex OAuth|展开 Codex OAuth/ }));
    expect(within(codexCard).getByRole('switch', { name: /^Image generation$|^图像生成$/ })).toBeTruthy();
    expect(within(codexCard).getByRole('switch', { name: /^Image editing$|^图像编辑$/ })).toBeTruthy();
    expect(within(codexCard).queryByRole('switch', { name: /^Text chat$|^文本聊天$/ })).toBeNull();
    expect(within(codexCard).queryByRole('switch', { name: /^Quota status$|^配额状态$/ })).toBeNull();

    const grokCard = screen.getByRole('group', { name: 'xAI Grok OAuth' });
    fireEvent.click(within(grokCard).getByRole('button', { name: /Expand xAI Grok OAuth|展开 xAI Grok OAuth/ }));
    expect(within(grokCard).getByRole('switch', { name: /^Image generation$|^图像生成$/ })).toBeTruthy();
    expect(within(grokCard).getByRole('switch', { name: /^Image editing$|^图像编辑$/ })).toBeTruthy();
    expect(within(grokCard).getByRole('switch', { name: /^Video generation$|^视频生成$/ })).toBeTruthy();
    expect(within(grokCard).queryByRole('switch', { name: /^Text chat$|^文本聊天$/ })).toBeNull();
    expect(within(grokCard).queryByRole('switch', { name: /^Quota status$|^配额状态$/ })).toBeNull();
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

  it('shows real Codex usage windows without inventing a Free plan label', async () => {
    const entries = buildAISubscriptionEntries({
      entries: {
        'codex-oauth': {
          status: 'connected',
          usageSummaries: [
            { period: 'five_hour', label: '5-hour quota', used: 35, limit: 100 },
            { period: 'weekly', label: 'Weekly quota', used: 12, limit: 100 },
          ],
        },
      },
    });
    installElectronAPI(entries);

    render(<AISubscriptionSettings />);

    const card = await screen.findByRole('group', { name: 'Codex OAuth' });
    expect(within(card).getByText(/35 \/ 100/)).toBeTruthy();
    expect(within(card).getByText(/12 \/ 100/)).toBeTruthy();
    expect(within(card).queryByText('Free')).toBeNull();
  });
});
