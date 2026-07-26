import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ProjectConfinedFilesystemBackend,
  assertPathWithinRoots,
  computeAgentFileRoots,
} from './project-confined-backend';

describe('computeAgentFileRoots', () => {
  it('includes the project, ~/.cdf and the temp dir', () => {
    const roots = computeAgentFileRoots('/Users/x/proj');
    expect(roots).toContain(path.resolve('/Users/x/proj'));
    expect(roots).toContain(path.resolve(path.join(os.homedir(), '.cdf')));
    expect(roots).toContain(path.resolve(os.tmpdir()));
  });

  it('dedupes and resolves extra roots', () => {
    const roots = computeAgentFileRoots('/Users/x/proj', ['/Users/x/proj', '/data/app']);
    expect(roots.filter((r) => r === path.resolve('/Users/x/proj'))).toHaveLength(1);
    expect(roots).toContain(path.resolve('/data/app'));
  });
});

describe('assertPathWithinRoots', () => {
  const roots = [path.resolve('/Users/x/proj'), path.resolve('/Users/x/.cdf')];

  it('allows paths inside an allowed root', () => {
    expect(() => assertPathWithinRoots('/Users/x/proj/src/a.ts', roots, roots[0], 'read')).not.toThrow();
    expect(() => assertPathWithinRoots('/Users/x/.cdf/skills/s/SKILL.md', roots, roots[0], 'write')).not.toThrow();
  });

  it('resolves relative paths under the project root', () => {
    expect(() => assertPathWithinRoots('src/a.ts', roots, roots[0], 'read')).not.toThrow();
  });

  it('rejects sensitive paths outside every root', () => {
    expect(() => assertPathWithinRoots('/Users/x/.ssh/id_rsa', roots, roots[0], 'read')).toThrow('Access denied');
    expect(() => assertPathWithinRoots('/etc/passwd', roots, roots[0], 'read')).toThrow('Access denied');
  });

  it('rejects traversal escapes', () => {
    expect(() => assertPathWithinRoots('/Users/x/proj/../.ssh/id_rsa', roots, roots[0], 'read')).toThrow('Access denied');
  });

  it('does not treat a sibling prefix as inside the root', () => {
    // /Users/x/proj-secret must not count as inside /Users/x/proj
    expect(() => assertPathWithinRoots('/Users/x/proj-secret/x', roots, roots[0], 'read')).toThrow('Access denied');
  });
});

describe('ProjectConfinedFilesystemBackend', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-confined-'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  function makeBackend() {
    return new ProjectConfinedFilesystemBackend({
      rootDir: '/',
      virtualMode: false,
      allowedRoots: computeAgentFileRoots(projectDir),
      projectRoot: projectDir,
    });
  }

  it('reads a file inside the project', async () => {
    const filePath = path.join(projectDir, 'note.txt');
    fs.writeFileSync(filePath, 'hello');
    const backend = makeBackend();
    const result = await backend.read(filePath);
    expect(JSON.stringify(result)).toContain('hello');
  });

  it('refuses to read a file outside the allowed roots before hitting disk', async () => {
    const backend = makeBackend();
    await expect(backend.read('/etc/passwd')).rejects.toThrow('Access denied');
  });

  it('refuses to write outside the allowed roots', async () => {
    const backend = makeBackend();
    await expect(backend.write('/Users/somebody/.ssh/authorized_keys', 'x')).rejects.toThrow('Access denied');
  });
});
