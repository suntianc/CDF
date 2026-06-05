import { describe, expect, it } from 'vitest';
import { formatTokenLabel } from './formatTokenLabel';

describe('formatTokenLabel (Phase 08.1 R3 / D-05)', () => {
  it('Title-Cases gsd-fast → Gsd-Fast (SPEC R3 acceptance)', () => {
    expect(formatTokenLabel('gsd-fast')).toBe('Gsd-Fast');
  });

  it('Title-Cases single word goal → Goal', () => {
    expect(formatTokenLabel('goal')).toBe('Goal');
  });

  it('Title-Cases two-segment code-review → Code-Review', () => {
    expect(formatTokenLabel('code-review')).toBe('Code-Review');
  });

  it('Title-Cases multi-hyphen run-skill-generator → Run-Skill-Generator', () => {
    expect(formatTokenLabel('run-skill-generator')).toBe('Run-Skill-Generator');
  });

  it('preserves empty string (does not throw)', () => {
    expect(formatTokenLabel('')).toBe('');
  });

  it('preserves trailing hyphen — empty trailing segment passes through', () => {
    expect(formatTokenLabel('foo-')).toBe('Foo-');
  });

  it('preserves leading hyphen — empty leading segment passes through', () => {
    // Defensive: registry names never start with `-`, but the helper must
    // not crash on a malformed input.
    expect(formatTokenLabel('-foo')).toBe('-Foo');
  });

  it('preserves single-letter segments — e.g., a-b-c → A-B-C', () => {
    expect(formatTokenLabel('a-b-c')).toBe('A-B-C');
  });

  it('does NOT mutate the rest of the segment (casing-preserving rule)', () => {
    // SPEC: only the first letter is uppercased; the rest is unchanged.
    // Names in the registry are lowercase, so this is a no-op for valid
    // inputs, but a mixed-case segment should NOT be re-cased.
    expect(formatTokenLabel('fooBar-baz')).toBe('FooBar-Baz');
  });
});
