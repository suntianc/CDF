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

describe('ChatArea welcome ambient glow', () => {
  it('keeps the default radial glow as ambient decoration', () => {
    expect(ruleBody('.center-bg-glow')).toContain('radial-gradient');
  });

  it('adds a standalone high-contrast media query after reduced-motion rules', () => {
    const reducedMotionIndex = globalsCss.indexOf('@media (prefers-reduced-motion: reduce)');
    const contrastIndex = globalsCss.indexOf('@media (prefers-contrast: more)');

    expect(reducedMotionIndex).toBeGreaterThanOrEqual(0);
    expect(contrastIndex).toBeGreaterThan(reducedMotionIndex);
  });

  it('hides the ambient glow for high-contrast users', () => {
    expect(globalsCss).toMatch(
      /@media\s*\(prefers-contrast:\s*more\)\s*\{\s*\.center-bg-glow\s*\{[^}]*display:\s*none;[^}]*\}\s*\}/s
    );
  });
});
