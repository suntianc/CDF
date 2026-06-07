import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

i18next
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': { translation: zhCN },
      'en-US': { translation: enUS },
    },
    lng: 'zh-CN',
    fallbackLng: 'zh-CN',
    interpolation: {
      escapeValue: false,
    },
    // Allow <span>, <kbd>, etc. in translation strings (used with <Trans>
    // component which handles markup safely via React elements instead of
    // dangerouslySetInnerHTML).
    ...({
      transSupportBasicHtmlNodes: true,
      transKeepBasicHtmlNodesFor: ['span', 'kbd', 'br', 'strong', 'em', 'b', 'i', 'u'],
    } as Record<string, unknown>),
    react: {
      useSuspense: false,
    },
  });

export default i18next;
