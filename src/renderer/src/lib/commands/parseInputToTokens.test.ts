import { describe, expect, it } from 'vitest';
import type { SlashCommand } from '../../../../shared/types';
import { parseInputToTokens } from './parseInputToTokens';

const goalCmd: SlashCommand = {
  name: 'goal',
  description: '设置 session 目标',
  source: 'system',
  target: 'goal',
  sourceLabel: 'system',
  badge: '[system]',
};

describe('parseInputToTokens (Phase 08.1 D-03 / SPEC R7)', () => {
  it('1. leading known command with args preserves leading space in tail (SPEC R7)', () => {
    const result = parseInputToTokens('/goal fix login', [goalCmd]);
    expect(result.token).toEqual({ name: 'goal', source: 'system' });
    expect(result.text).toBe(' fix login');
  });

  it('2. leading known command with trailing space only — text becomes "" (no crash)', () => {
    const result = parseInputToTokens('/goal ', [goalCmd]);
    expect(result.token).toEqual({ name: 'goal', source: 'system' });
    expect(result.text).toBe('');
  });

  it('3. leading known command, no args, no trailing space — text becomes ""', () => {
    const result = parseInputToTokens('/goal', [goalCmd]);
    expect(result.token).toEqual({ name: 'goal', source: 'system' });
    expect(result.text).toBe('');
  });

  it('4. unknown command at start — no token key, text passed through unchanged', () => {
    const result = parseInputToTokens('/unknown abc', [goalCmd]);
    expect(result.token).toBeUndefined();
    expect(result.text).toBe('/unknown abc');
  });

  it('5. non-slash text — no token key, text passed through unchanged', () => {
    const result = parseInputToTokens('hello world', [goalCmd]);
    expect(result.token).toBeUndefined();
    expect(result.text).toBe('hello world');
  });

  it('6. empty string — no token key, text passed through unchanged', () => {
    const result = parseInputToTokens('', [goalCmd]);
    expect(result.token).toBeUndefined();
    expect(result.text).toBe('');
  });

  it('7. multiple slashes — only first parses (D-03 / SPEC R6: 1 token per input max)', () => {
    const result = parseInputToTokens('/goal /foo bar', [goalCmd]);
    expect(result.token).toEqual({ name: 'goal', source: 'system' });
    expect(result.text).toBe(' /foo bar');
  });

  it('partial command name does NOT match (mirrors dispatcher matcher)', () => {
    // `/goals` is not `/goal` + anything — the matcher requires the
    // command name to end at position `len('/goal')` OR be followed
    // by a single space. `/goals` has 's' in that position, no match.
    const result = parseInputToTokens('/goals', [goalCmd]);
    expect(result.token).toBeUndefined();
    expect(result.text).toBe('/goals');
  });

  it('multiple commands in registry — first match wins, registry order is authoritative', () => {
    const otherCmd: SlashCommand = {
      name: 'plan',
      description: '进入 plan 模式',
      source: 'system',
      target: 'plan',
      sourceLabel: 'system',
      badge: '[system]',
    };
    // goalCmd is registered first, so `/goal` matches goal first.
    const result = parseInputToTokens('/goal', [goalCmd, otherCmd]);
    expect(result.token).toEqual({ name: 'goal', source: 'system' });
  });

  it('empty registry — no token, text passed through', () => {
    const result = parseInputToTokens('/goal fix login', []);
    expect(result.token).toBeUndefined();
    expect(result.text).toBe('/goal fix login');
  });

  it('preserves non-ASCII args (Chinese characters) in the tail', () => {
    const result = parseInputToTokens('/goal 修复登录', [goalCmd]);
    expect(result.token).toEqual({ name: 'goal', source: 'system' });
    expect(result.text).toBe(' 修复登录');
  });
});
