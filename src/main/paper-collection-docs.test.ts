import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');

describe('paper collection context', () => {
  it('describes the search cache as a project-local disk cache', () => {
    const context = fs.readFileSync(path.join(repoRoot, 'CONTEXT.md'), 'utf-8');

    expect(context).toContain('<projectPath>/.cdf/paper-collection-cache/latest.json');
    expect(context).toContain('<projectPath>/.cdf/paper-collection-cache/archive/');
    expect(context).not.toContain('writes `/paper-collection-cache');
    expect(context).not.toContain('from `/paper-collection-cache');
  });
});
