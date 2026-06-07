import { create } from 'zustand';
import i18n from '../i18n';

export type Language = 'zh-CN' | 'en-US';

interface I18nState {
  currentLanguage: Language;
  setLanguage: (lang: Language) => Promise<void>;
  initFromStore: () => Promise<void>;
}

const VALID_LANGUAGES: Language[] = ['zh-CN', 'en-US'];

function isValidLanguage(value: unknown): value is Language {
  return typeof value === 'string' && VALID_LANGUAGES.includes(value as Language);
}

function detectFromNavigator(): Language {
  try {
    const lang = navigator.language.toLowerCase();
    if (lang.startsWith('zh')) return 'zh-CN';
    return 'en-US';
  } catch {
    return 'zh-CN';
  }
}

export const useI18nStore = create<I18nState>((set) => ({
  currentLanguage: 'zh-CN',

  setLanguage: async (lang: Language) => {
    if (!isValidLanguage(lang)) {
      console.error('Invalid language:', lang);
      return;
    }
    try {
      await i18n.changeLanguage(lang);
    } catch (err) {
      console.error('Failed to change i18n language:', err);
    }
    set({ currentLanguage: lang });
    try {
      await window.electronAPI.store.set('language', lang);
    } catch (err) {
      console.error('Failed to persist language:', err);
    }
  },

  initFromStore: async () => {
    let initialLang: Language = 'zh-CN';
    try {
      const saved = await window.electronAPI.store.get('language');
      if (isValidLanguage(saved)) {
        initialLang = saved;
      } else {
        initialLang = detectFromNavigator();
      }
    } catch (err) {
      console.error('Failed to read language from store:', err);
      initialLang = detectFromNavigator();
    }
    try {
      await i18n.changeLanguage(initialLang);
    } catch (err) {
      console.error('Failed to apply initial i18n language:', err);
    }
    set({ currentLanguage: initialLang });
  },
}));
