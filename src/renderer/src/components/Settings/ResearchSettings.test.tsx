import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '../../i18n';
import { PAPER_SEARCH_CONFIG_KEYS, type PaperSearchConfigKey, type PaperSearchConfigSettings } from '@shared/types';
import { ResearchSettings } from './ResearchSettings';

const getSettingsMock = vi.fn();
const saveConfigValueMock = vi.fn();
const clearConfigValueMock = vi.fn();
const openExternalUrlMock = vi.fn();

const isSecret = (key: PaperSearchConfigKey) =>
  key.includes('API_KEY')
  || key.includes('KEY')
  || key.includes('TOKEN');

const makeSettings = (
  configured: Partial<Record<PaperSearchConfigKey, { value: string; source?: 'user_config' | 'environment' }>> = {},
): PaperSearchConfigSettings => {
  const entries = PAPER_SEARCH_CONFIG_KEYS.map((key) => {
    const entry = configured[key];
    return {
      key,
      configured: Boolean(entry),
      value: entry?.value ?? '',
      source: (entry?.source ?? (entry ? 'user_config' : 'missing')) as import('@shared/types').PaperSearchConfigSource,
      secret: isSecret(key),
    };
  });
  return {
    configPath: '/tmp/paper-search/config.json',
    entries,
    configuredCount: entries.filter((entry) => entry.configured).length,
    totalCount: entries.length,
  };
};

describe('ResearchSettings Paper Search CLI config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockResolvedValue(makeSettings());
    saveConfigValueMock.mockImplementation(async (key: PaperSearchConfigKey, value: string) => makeSettings({
      [key]: {
        value,
      },
    }));
    clearConfigValueMock.mockResolvedValue(makeSettings());

    (window as unknown as { electronAPI: unknown }).electronAPI = {
      paperSearch: {
        getSettings: getSettingsMock,
        saveConfigValue: saveConfigValueMock,
        clearConfigValue: clearConfigValueMock,
      },
      shell: {
        openExternalUrl: openExternalUrlMock,
      },
    };
  });

  it('renders every Paper Search CLI config key in the research settings page', async () => {
    render(<ResearchSettings />);

    expect(await screen.findByText(/Research Config|科研配置/)).toBeTruthy();
    for (const key of PAPER_SEARCH_CONFIG_KEYS) {
      expect(screen.getByTestId(`paper-search-config-${key}`)).toBeTruthy();
    }
    expect(screen.getByText('0/13')).toBeTruthy();
    expect(screen.queryByText('/tmp/paper-search/config.json')).toBeNull();
    expect(screen.queryByText('EASYSCHOLAR_KEY')).toBeNull();
    expect(screen.queryByText('CORE_MAX_RESULTS_CAP')).toBeNull();
    expect(screen.queryByTestId('paper-search-config-PAPER_SEARCH_UNPAYWALL_EMAIL')).toBeNull();
    expect(screen.queryByTestId('paper-search-config-CORE_MAX_RESULTS_CAP')).toBeNull();
    expect(screen.queryByTestId('paper-search-config-WOS_API_VERSION')).toBeNull();
    expect(screen.queryByTestId('paper-search-config-NCBI_EMAIL')).toBeNull();
    expect(screen.queryByTestId('paper-search-config-NCBI_TOOL')).toBeNull();
    expect(screen.queryByText(/^Docs$|^文档$/)).toBeNull();
    expect(screen.queryByText(/Source:|来源:/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Clear|清除/ })).toBeNull();
    expect(screen.getAllByRole('link', { name: /^Entry$|^申请入口$/ })).toHaveLength(13);
  });

  it('uses registration entry links from the Paper Search CLI guide', async () => {
    render(<ResearchSettings />);

    const entryLinkFor = async (key: PaperSearchConfigKey) => {
      const row = await screen.findByTestId(`paper-search-config-${key}`);
      return within(row).getByRole('link', { name: /^Entry$|^申请入口$/ });
    };

    expect((await entryLinkFor('EASYSCHOLAR_KEY')).getAttribute('href')).toBe('https://www.easyscholar.cc/console/user/open');
    expect((await entryLinkFor('WOS_API_KEY')).getAttribute('href')).toBe('https://developer.clarivate.com/apis');
    expect((await entryLinkFor('IEEE_API_KEY')).getAttribute('href')).toBe('https://developer.ieee.org/docs/read/Searching_the_IEEE_Xplore_Metadata_API');
    expect((await entryLinkFor('ELSEVIER_API_KEY')).getAttribute('href')).toBe('https://dev.elsevier.com/apikey/manage');
    expect((await entryLinkFor('OPENAIRE_API_KEY')).getAttribute('href')).toBe('https://develop.openaire.eu/');
    expect((await entryLinkFor('EASYSCHOLAR_KEY')).getAttribute('target')).toBeNull();
  });

  it('opens registration entry links through the system browser bridge', async () => {
    render(<ResearchSettings />);

    const row = await screen.findByTestId('paper-search-config-EASYSCHOLAR_KEY');
    fireEvent.click(within(row).getByRole('link', { name: /^Entry$|^申请入口$/ }));

    await waitFor(() => expect(openExternalUrlMock).toHaveBeenCalledWith('https://www.easyscholar.cc/console/user/open'));
  });

  it('saves EasyScholar through the generic paper-search bridge', async () => {
    render(<ResearchSettings />);

    const row = await screen.findByTestId('paper-search-config-EASYSCHOLAR_KEY');
    const input = within(row).getByLabelText(/EasyScholar SecretKey/);
    fireEvent.change(input, { target: { value: 'sk-easy-scholar-secret' } });
    fireEvent.click(within(row).getByRole('button', { name: /^Save$|^保存$/ }));

    await waitFor(() => expect(saveConfigValueMock).toHaveBeenCalledWith('EASYSCHOLAR_KEY', 'sk-easy-scholar-secret'));
    expect(await screen.findByDisplayValue('sk-easy-scholar-secret')).toBeTruthy();
  });

  it('saves non-secret research source values through the same bridge', async () => {
    render(<ResearchSettings />);

    const row = await screen.findByTestId('paper-search-config-UNPAYWALL_EMAIL');
    const input = within(row).getByLabelText(/Unpaywall email|Unpaywall 邮箱/);
    fireEvent.change(input, { target: { value: 'research@example.com' } });
    fireEvent.click(within(row).getByRole('button', { name: /^Save$|^保存$/ }));

    await waitFor(() => expect(saveConfigValueMock).toHaveBeenCalledWith('UNPAYWALL_EMAIL', 'research@example.com'));
    expect(await screen.findByDisplayValue('research@example.com')).toBeTruthy();
  });

  it('echoes configured secrets in password inputs and emails as plain values', async () => {
    getSettingsMock.mockResolvedValue(makeSettings({
      EASYSCHOLAR_KEY: { value: 'sk-easy-scholar-secret' },
      UNPAYWALL_EMAIL: { value: 'research@example.com' },
      CROSSREF_MAILTO: { value: 'cdf@example.com' },
    }));

    render(<ResearchSettings />);

    const secretRow = await screen.findByTestId('paper-search-config-EASYSCHOLAR_KEY');
    const secretInput = within(secretRow).getByLabelText(/EasyScholar SecretKey/) as HTMLInputElement;
    expect(secretInput.value).toBe('sk-easy-scholar-secret');
    expect(secretInput.type).toBe('password');

    fireEvent.click(within(secretRow).getByRole('button', { name: /Show secret|显示密钥/ }));
    expect((within(secretRow).getByLabelText(/EasyScholar SecretKey/) as HTMLInputElement).type).toBe('text');

    const unpaywallRow = await screen.findByTestId('paper-search-config-UNPAYWALL_EMAIL');
    const unpaywallInput = within(unpaywallRow).getByLabelText(/Unpaywall email|Unpaywall 邮箱/) as HTMLInputElement;
    expect(unpaywallInput.value).toBe('research@example.com');
    expect(unpaywallInput.type).toBe('email');
    expect(within(unpaywallRow).queryByRole('button', { name: /Show secret|显示密钥/ })).toBeNull();

    const crossrefRow = await screen.findByTestId('paper-search-config-CROSSREF_MAILTO');
    const crossrefInput = within(crossrefRow).getByLabelText(/Crossref contact email|Crossref 联系邮箱/) as HTMLInputElement;
    expect(crossrefInput.value).toBe('cdf@example.com');
    expect(crossrefInput.type).toBe('email');
  });

  it('does not render runtime or network config keys', async () => {
    render(<ResearchSettings />);

    await screen.findByText(/Research Config|科研配置/);
    expect(screen.queryByTestId('paper-search-config-LOG_LEVEL')).toBeNull();
    expect(screen.queryByTestId('paper-search-config-DEFAULT_DOWNLOAD_PATH')).toBeNull();
    expect(screen.queryByTestId('paper-search-config-RATE_LIMIT_BURST')).toBeNull();
    expect(screen.queryByTestId('paper-search-config-HTTP_PROXY')).toBeNull();
    expect(screen.queryByTestId('paper-search-config-HTTPS_PROXY')).toBeNull();
  });

  it('does not expose a clear action on configured values', async () => {
    getSettingsMock.mockResolvedValue(makeSettings({
      EASYSCHOLAR_KEY: { value: 'sk-easy-scholar-secret' },
    }));

    render(<ResearchSettings />);

    await screen.findByTestId('paper-search-config-EASYSCHOLAR_KEY');
    expect(screen.queryByRole('button', { name: /Clear|清除/ })).toBeNull();
    expect(clearConfigValueMock).not.toHaveBeenCalled();
  });
});
