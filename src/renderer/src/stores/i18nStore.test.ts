import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useI18nStore } from './i18nStore';

vi.mock('../i18n', () => ({
  default: {
    changeLanguage: vi.fn(async () => {}),
  },
}));

import i18nMock from '../i18n';

const setMock = vi.fn();
const getMock = vi.fn();

beforeEach(() => {
  setMock.mockReset();
  getMock.mockReset();
  (i18nMock.changeLanguage as any).mockReset();
  (i18nMock.changeLanguage as any).mockResolvedValue(undefined);
  setMock.mockResolvedValue(undefined);

  window.electronAPI = {
    store: {
      get: getMock,
      set: setMock,
    },
  } as any;

  useI18nStore.setState({ currentLanguage: 'zh-CN' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('i18nStore', () => {
  it('initial state is zh-CN', () => {
    expect(useI18nStore.getState().currentLanguage).toBe('zh-CN');
  });

  it('setLanguage updates state, calls i18n.changeLanguage, and persists to store', async () => {
    await useI18nStore.getState().setLanguage('en-US');

    const state = useI18nStore.getState();
    expect(state.currentLanguage).toBe('en-US');
    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('en-US');
    expect(setMock).toHaveBeenCalledWith('language', 'en-US');
  });

  it('initFromStore uses saved value when valid', async () => {
    getMock.mockResolvedValue('en-US');

    await useI18nStore.getState().initFromStore();

    expect(useI18nStore.getState().currentLanguage).toBe('en-US');
    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('en-US');
  });

  it('initFromStore falls back to navigator.language detection (en-GB → en-US)', async () => {
    getMock.mockResolvedValue(null);
    Object.defineProperty(navigator, 'language', { value: 'en-GB', configurable: true });

    await useI18nStore.getState().initFromStore();

    expect(useI18nStore.getState().currentLanguage).toBe('en-US');
  });

  it('initFromStore falls back to navigator.language detection (zh-TW → zh-CN)', async () => {
    getMock.mockResolvedValue(null);
    Object.defineProperty(navigator, 'language', { value: 'zh-TW', configurable: true });

    await useI18nStore.getState().initFromStore();

    expect(useI18nStore.getState().currentLanguage).toBe('zh-CN');
  });

  it('setLanguage rejects invalid input (no state change, no IPC, no i18n call)', async () => {
    useI18nStore.setState({ currentLanguage: 'zh-CN' });

    await useI18nStore.getState().setLanguage('fr-FR' as any);

    const state = useI18nStore.getState();
    expect(state.currentLanguage).toBe('zh-CN');
    expect(i18nMock.changeLanguage).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });
});
