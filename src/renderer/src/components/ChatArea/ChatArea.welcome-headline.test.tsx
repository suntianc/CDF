import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const globalsCss = fs.readFileSync(
  path.join(process.cwd(), 'src/renderer/src/styles/globals.css'),
  'utf-8'
);

const ruleBody = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = globalsCss.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, 's'));
  return match?.groups?.body ?? '';
};

describe('ChatArea welcome headline treatment', () => {
  const headlineRule = ruleBody('.center-headline');
  const headlineAccentRule = ruleBody('.center-headline span');

  it('keeps the welcome headline type scale stable', () => {
    expect(headlineRule).toContain('font-size: 28px');
    expect(headlineRule).toContain('font-weight: 700');
  });

  it('uses a single theme-aware accent color for the highlighted text', () => {
    expect(headlineAccentRule).toContain('color: var(--accent);');
  });

  it('does not use gradient text on semantic headline copy', () => {
    expect(headlineAccentRule).not.toContain('linear-gradient');
    expect(headlineAccentRule).not.toContain('-webkit-background-clip');
    expect(headlineAccentRule).not.toContain('-webkit-text-fill-color');
    expect(headlineAccentRule).not.toContain('background-clip: text');
  });
});
