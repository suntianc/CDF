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

  it('uses the compact workbench headline scale', () => {
    expect(headlineRule).toContain('font-size: 24px');
    expect(headlineRule).toContain('font-weight: 650');
  });

  it('keeps highlighted text in the primary ink hierarchy', () => {
    expect(headlineAccentRule).toContain('color: inherit;');
  });

  it('does not use gradient text on semantic headline copy', () => {
    expect(headlineAccentRule).not.toContain('linear-gradient');
    expect(headlineAccentRule).not.toContain('-webkit-background-clip');
    expect(headlineAccentRule).not.toContain('-webkit-text-fill-color');
    expect(headlineAccentRule).not.toContain('background-clip: text');
  });
});
