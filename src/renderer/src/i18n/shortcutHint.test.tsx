import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

const i18nSource = fs.readFileSync(
  path.join(process.cwd(), 'src/renderer/src/i18n/index.ts'),
  'utf-8'
);

const expectedTokens = [
  '<kbd>/</kbd>',
  '<kbd>@</kbd>',
  '<kbd>Enter</kbd>',
  '<kbd>Shift+Enter</kbd>',
];

describe('shortcutHint keyboard affordances', () => {
  it('documents slash, at mention, send, and newline affordances in zh-CN', () => {
    const shortcutHint = zhCN.chat.shortcutHint;

    expectedTokens.forEach((token) => {
      expect(shortcutHint).toContain(token);
    });
  });

  it('documents slash, at mention, send, and newline affordances in en-US', () => {
    const shortcutHint = enUS.chat.shortcutHint;

    expectedTokens.forEach((token) => {
      expect(shortcutHint).toContain(token);
    });
  });

  it('keeps kbd in the Trans basic HTML node allowlist', () => {
    expect(i18nSource).toMatch(/transKeepBasicHtmlNodesFor:\s*\[[^\]]*'kbd'[^\]]*\]/s);
  });
});
