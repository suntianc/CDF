// Unit tests for the pure functions in agent-slug.ts.
// `ensureUniqueSlug` requires DB access and is exercised in
// agent-tools.integration.test.ts; here we cover the pure
// normalization + resolve helpers.

import { describe, expect, it, vi } from 'vitest';

// Stub electron + database so the helper module can be imported
// without triggering the better-sqlite3 native binding. The
// pure functions under test don't touch the database, so a
// minimal stub is sufficient.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cdf-agent-slug-unit-test' },
  ipcMain: { handle: () => {} },
}));
vi.mock('../database', () => ({
  default: { prepare: () => ({ all: () => [] }) },
}));

import { generateSlug, resolveAgentSlug } from './agent-slug';

describe('generateSlug', () => {
  it('lowercases and trims non-alphanumeric runs', () => {
    expect(generateSlug('Code Reviewer')).toBe('code-reviewer');
    expect(generateSlug('  Code   Reviewer  ')).toBe('code-reviewer');
    expect(generateSlug('Code__Reviewer')).toBe('code-reviewer');
    expect(generateSlug('Code-Reviewer')).toBe('code-reviewer');
  });

  it('returns "agent" fallback for names that slugify to empty', () => {
    // Note: callers are expected to use `name || 'agent'` themselves;
    // the bare function returns ''. Both agent-tools.ts and
    // database.ts already apply the `'agent'` fallback before calling.
    expect(generateSlug('')).toBe('');
    expect(generateSlug('   ')).toBe('');
    expect(generateSlug('---')).toBe('');
  });

  it('caps at 50 chars', () => {
    const longName = 'a'.repeat(100);
    const slug = generateSlug(longName);
    expect(slug.length).toBe(50);
    expect(slug).toBe('a'.repeat(50));
  });

  it('strips unicode and punctuation beyond the ASCII alphabet', () => {
    expect(generateSlug('Hello World! 你好')).toBe('hello-world');
    expect(generateSlug('agent@v1.0')).toBe('agent-v1-0');
  });
});

describe('resolveAgentSlug', () => {
  it('returns the persisted slug when set', () => {
    expect(resolveAgentSlug({ slug: 'custom', name: 'My Agent' })).toBe('custom');
  });

  it('falls back to generateSlug(name) when slug is null', () => {
    expect(resolveAgentSlug({ slug: null, name: 'Code Reviewer' })).toBe('code-reviewer');
  });

  it('falls back when slug is empty string', () => {
    expect(resolveAgentSlug({ slug: '', name: 'Code Reviewer' })).toBe('code-reviewer');
  });

  it('falls back when slug is undefined', () => {
    expect(resolveAgentSlug({ slug: undefined, name: 'Code Reviewer' })).toBe('code-reviewer');
  });
});
