import { describe, expect, it } from 'vitest';
import type { CommandSource, SlashCommand } from '../../shared/types';
import { detectConflicts } from './conflict-detector';

function cmd(name: string, source: CommandSource): SlashCommand {
  return { name, description: '', source, target: name, sourceLabel: source, badge: `[${source}]` };
}

describe('conflict-detector', () => {
  it('returns [] for distinct names (no conflicts)', () => {
    const result = detectConflicts([
      cmd('goal', 'system'),
      cmd('arxiv', 'mcp'),
      cmd('review', 'workflow'),
    ]);
    expect(result).toEqual([]);
  });

  it('case 1: system /goal + workflow /goal → 1 error with 2 entries', () => {
    const result = detectConflicts([cmd('goal', 'system'), cmd('goal', 'workflow')]);
    expect(result).toHaveLength(1);
    expect(result[0].commandName).toBe('goal');
    expect(result[0].conflicts).toEqual([
      { source: 'system', badge: '[system]' },
      { source: 'workflow', badge: '[workflow]' },
    ]);
  });

  it('case 2: skill:global /simplify + cmd:system /simplify → 1 error with 2 entries', () => {
    const result = detectConflicts([cmd('simplify', 'skill:global'), cmd('simplify', 'cmd:system')]);
    expect(result).toHaveLength(1);
    expect(result[0].conflicts.map((c) => c.source)).toEqual(['skill:global', 'cmd:system']);
  });

  it('case 3: mcp /arxiv_search + skill:project /arxiv_search → 1 error with 2 entries', () => {
    const result = detectConflicts([cmd('arxiv_search', 'mcp'), cmd('arxiv_search', 'skill:project')]);
    expect(result).toHaveLength(1);
    expect(result[0].conflicts.map((c) => c.source)).toEqual(['mcp', 'skill:project']);
  });

  it('case 4: 3 sources same name → 1 error with 3 entries', () => {
    const result = detectConflicts([
      cmd('multi', 'system'),
      cmd('multi', 'mcp'),
      cmd('multi', 'workflow'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].conflicts).toHaveLength(3);
  });

  it('case 5: CJK collision: skill /上下文 + workflow /上下文 (NFKC normalized equal) → 1 error', () => {
    const result = detectConflicts([cmd('上下文', 'skill:project'), cmd('上下文', 'workflow')]);
    expect(result).toHaveLength(1);
    expect(result[0].conflicts).toHaveLength(2);
  });

  it('treats CJK with different Unicode normalization as conflict (NFKC grouping)', () => {
    // "上下文" with composed form should collide with decomposed form
    const result = detectConflicts([
      cmd('上下文', 'skill:project'),
      cmd('上下文', 'workflow'),
    ]);
    expect(result).toHaveLength(1);
  });

  it('does not throw on conflict (D-07 lock) — returns array', () => {
    expect(() => detectConflicts([cmd('x', 'system'), cmd('x', 'mcp')])).not.toThrow();
  });

  it('produces CommandConflictError instance with proper message', () => {
    const result = detectConflicts([cmd('y', 'system'), cmd('y', 'mcp')]);
    expect(result[0]).toBeInstanceOf(Error);
    expect(result[0].name).toBe('CommandConflictError');
    expect(result[0].message).toContain('Command conflict');
    expect(result[0].message).toContain('y');
  });

  it('handles empty input array', () => {
    expect(detectConflicts([])).toEqual([]);
  });

  it('preserves insertion order of error groups (Map iteration order)', () => {
    const result = detectConflicts([
      cmd('a', 'system'),
      cmd('a', 'mcp'),
      cmd('b', 'workflow'),
      cmd('b', 'skill:global'),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].commandName).toBe('a');
    expect(result[1].commandName).toBe('b');
  });
});
