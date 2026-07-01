import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildCdfSkillsRuntime } from './cdf-skills-runtime';
import { invalidateSkillSourceCaches } from './skill-sources';

describe('buildCdfSkillsRuntime', () => {
  const tempProjectPath = path.join(os.tmpdir(), `cdf-skills-runtime-test-${Math.random().toString(36).slice(2)}`);

  beforeEach(() => {
    invalidateSkillSourceCaches();
    fs.rmSync(tempProjectPath, { recursive: true, force: true });
    fs.mkdirSync(path.join(tempProjectPath, '.cdf', 'skills', 'secret-review'), { recursive: true });
    fs.writeFileSync(
      path.join(tempProjectPath, '.cdf', 'skills', 'secret-review', 'SKILL.md'),
      [
        '---',
        'name: secret-review',
        'description: Sensitive trigger text',
        '---',
        '',
        '# Secret Review',
        '',
        'Full secret review instructions',
      ].join('\n'),
      'utf-8'
    );
  });

  afterEach(() => {
    fs.rmSync(tempProjectPath, { recursive: true, force: true });
  });

  it('builds a CDF-owned skills prompt from resolved catalog metadata', () => {
    const runtime = buildCdfSkillsRuntime(tempProjectPath, {
      agentOverrides: {
        'secret-review': 'name-only',
      },
      preloadSkillNames: ['secret-review'],
    });

    expect(runtime.skills).toHaveLength(1);
    expect(runtime.prompt).toContain('secret-review');
    expect(runtime.prompt).toContain('name-only');
    expect(runtime.prompt).not.toContain('Sensitive trigger text');
    expect(runtime.prompt).not.toContain('Full secret review instructions');
    expect(runtime.warnings).toEqual([]);
  });

  it('orders nested Project Skills before root Skills when path context matches', () => {
    const rootSkillDir = path.join(tempProjectPath, '.cdf', 'skills', 'deploy');
    const nestedSkillDir = path.join(tempProjectPath, 'apps', 'web', '.cdf', 'skills', 'deploy');
    fs.mkdirSync(rootSkillDir, { recursive: true });
    fs.mkdirSync(nestedSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(rootSkillDir, 'SKILL.md'),
      [
        '---',
        'name: deploy',
        'description: Deploy the whole project',
        '---',
        '',
        '# Deploy',
      ].join('\n'),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(nestedSkillDir, 'SKILL.md'),
      [
        '---',
        'name: deploy',
        'description: Deploy the web app',
        '---',
        '',
        '# Web Deploy',
      ].join('\n'),
      'utf-8'
    );

    const runtime = buildCdfSkillsRuntime(tempProjectPath, {
      pathContext: ['apps/web/src/App.tsx'],
    });

    expect(runtime.skills.map((skill) => skill.qualifiedName)).toEqual([
      'apps/web:deploy',
      'deploy',
      'secret-review',
    ]);
    expect(runtime.prompt.indexOf('**apps/web:deploy**')).toBeLessThan(
      runtime.prompt.indexOf('**deploy**')
    );
  });
});
