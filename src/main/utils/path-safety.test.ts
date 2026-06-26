import { describe, expect, it } from 'vitest';
import { isProtectedPath, resolveProjectFile } from './path-safety';

describe('isProtectedPath', () => {
  it('blocks .env files', () => {
    expect(isProtectedPath('/project/.env')).toBe(true);
    expect(isProtectedPath('/project/.env.local')).toBe(true);
  });

  it('blocks .git directory', () => {
    expect(isProtectedPath('/project/.git/config')).toBe(true);
  });

  it('blocks node_modules', () => {
    expect(isProtectedPath('/project/node_modules/pkg/index.js')).toBe(true);
  });

  it('allows normal files', () => {
    expect(isProtectedPath('/project/src/index.ts')).toBe(false);
    expect(isProtectedPath('/project/package.json')).toBe(false);
  });
});

describe('resolveProjectFile', () => {
  const root = '/Users/test/project';

  it('accepts absolute paths within project', () => {
    const result = resolveProjectFile(root, '/Users/test/project/src/main.ts');
    expect(result).toBe('/Users/test/project/src/main.ts');
  });

  it('rejects relative paths', () => {
    expect(() => resolveProjectFile(root, 'src/main.ts')).toThrow('absolute path');
  });

  it('rejects path traversal with ..', () => {
    expect(() => resolveProjectFile(root, '/Users/test/project/../secret')).toThrow('traversal');
  });

  it('rejects tilde paths', () => {
    expect(() => resolveProjectFile(root, '~/secret')).toThrow();
  });
});
