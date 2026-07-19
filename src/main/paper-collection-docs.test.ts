import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');

describe('paper collection docs', () => {
  it('describes the search cache as a project-local disk cache', () => {
    const context = fs.readFileSync(path.join(repoRoot, 'CONTEXT.md'), 'utf-8');
    const adr = fs.readFileSync(
      path.join(repoRoot, 'docs/adr/0046-paper-collection-drives-bundled-paper-search-cli.md'),
      'utf-8',
    );
    const adrText = adr.replace(/\s+/g, ' ');

    expect(context).toContain('<projectPath>/.cdf/paper-collection-cache/latest.json');
    expect(context).toContain('<projectPath>/.cdf/paper-collection-cache/archive/');
    expect(context).not.toContain('writes `/paper-collection-cache');
    expect(context).not.toContain('from `/paper-collection-cache');

    expect(adrText).toContain('project-local disk cache under `<projectPath>/.cdf/paper-collection-cache/`');
    expect(adrText).toContain('persists across Conversation sessions');
    expect(adr).not.toContain('StateBackend virtual file');
    expect(adr).not.toContain('"/paper-collection-cache');
  });
});
