import { beforeAll, describe, expect, it } from 'vitest';
import i18n from './index';

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await new Promise<void>((resolve) => {
      i18n.on('initialized', () => resolve());
    });
  }
});

describe('i18n init', () => {
  it('has zh-CN and en-US resources registered', () => {
    expect(i18n.hasResourceBundle('zh-CN', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('en-US', 'translation')).toBe(true);
  });

  it('returns zh-CN string by default for sidebar.newChat', () => {
    expect(i18n.t('sidebar.newChat')).toBe('新对话');
  });

  it('returns en-US string after switching language', async () => {
    await i18n.changeLanguage('en-US');
    expect(i18n.t('sidebar.newChat')).toBe('New Chat');
    await i18n.changeLanguage('zh-CN');
  });
});
