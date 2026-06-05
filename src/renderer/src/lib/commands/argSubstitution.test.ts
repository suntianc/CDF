import { describe, expect, it } from 'vitest';
import { substituteArgs } from './argSubstitution';

describe('argSubstitution', () => {
  it('replaces $ARGUMENTS with the full args string verbatim', () => {
    expect(substituteArgs('请部署到 $ARGUMENTS', { args: 'production --force' })).toBe(
      '请部署到 production --force'
    );
  });

  it('replaces $0 with the first positional arg', () => {
    expect(substituteArgs('部署到 $0 环境', { args: 'production --force' })).toBe(
      '部署到 production 环境'
    );
  });

  it('replaces multiple $N positional placeholders', () => {
    expect(substituteArgs('env=$0 flag=$1', { args: 'prod force' })).toBe(
      'env=prod flag=force'
    );
  });

  it('leaves $N intact when out-of-range (does not throw, does not replace with empty)', () => {
    expect(substituteArgs('arg0=$0 arg1=$1 arg2=$2', { args: 'foo' })).toBe(
      'arg0=foo arg1=$1 arg2=$2'
    );
  });

  it('replaces $name via frontmatter arguments declaration', () => {
    expect(
      substituteArgs('env=$env flag=$flag', { args: 'prod force', arguments: ['env', 'flag'] })
    ).toBe('env=prod flag=force');
  });

  it('does NOT replace $name if not declared in arguments', () => {
    expect(
      substituteArgs('env=$env flag=$flag', { args: 'prod force', arguments: ['env'] })
    ).toBe('env=prod flag=$flag');
  });

  it('handles CJK args with $ARGUMENTS (verbatim, no escape)', () => {
    expect(
      substituteArgs('要求: $ARGUMENTS', { args: '顺带更新 changelog，谢谢' })
    ).toBe('要求: 顺带更新 changelog，谢谢');
  });

  it('returns body unchanged when no placeholders', () => {
    expect(substituteArgs('hello world', { args: 'x y z' })).toBe('hello world');
  });
});
