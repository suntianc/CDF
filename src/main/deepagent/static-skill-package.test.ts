import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

function runMaterializer(runnerPath: string, bundlePath: string, inputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runnerPath, bundlePath, inputPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`materializer child exited ${code}: ${stderr}`));
    });
  });
}

describe('static Skill package materialization', () => {
  it('atomically publishes one immutable package under concurrent processes', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-static-skill-package-'));
    cleanupPaths.push(tempDir);
    const builtInSkillsRoot = path.join(tempDir, 'built-ins');
    const packageRoot = path.join(builtInSkillsRoot, 'review-skill');
    fs.mkdirSync(path.join(packageRoot, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'scripts', 'stale.js'), 'unsafe stale script', 'utf-8');

    const bundlePath = path.join(tempDir, 'static-skill-package.cjs');
    execFileSync(path.join(process.cwd(), 'node_modules', '.bin', 'esbuild'), [
      'src/main/deepagent/static-skill-package.ts',
      '--bundle',
      '--platform=node',
      '--format=cjs',
      `--outfile=${bundlePath}`,
    ], { cwd: process.cwd(), encoding: 'utf-8' });

    const runnerPath = path.join(tempDir, 'run-materializer.cjs');
    fs.writeFileSync(runnerPath, [
      "const fs = require('node:fs');",
      'const { materializeStaticSkillPackage } = require(process.argv[2]);',
      "const input = JSON.parse(fs.readFileSync(process.argv[3], 'utf-8'));",
      'process.stdout.write(materializeStaticSkillPackage(input.root, input.skillPackage));',
    ].join('\n'), 'utf-8');
    const inputPath = path.join(tempDir, 'input.json');
    fs.writeFileSync(inputPath, JSON.stringify({
      root: builtInSkillsRoot,
      skillPackage: {
        name: 'review-skill',
        markdown: '---\nname: review-skill\ndescription: Review safely\n---\n',
        resources: [
          { relativePath: 'PROVENANCE.md', content: 'Pinned upstream\n' },
          { relativePath: 'references/contract.md', content: 'Offline only\n' },
        ],
      },
    }), 'utf-8');

    const [firstDir, secondDir] = await Promise.all([
      runMaterializer(runnerPath, bundlePath, inputPath),
      runMaterializer(runnerPath, bundlePath, inputPath),
    ]);

    expect(firstDir).toBe(secondDir);
    expect(path.basename(firstDir)).toBe('review-skill');
    expect(path.basename(path.dirname(path.dirname(firstDir)))).toBe('review-skill');
    expect(fs.readFileSync(path.join(firstDir, 'SKILL.md'), 'utf-8')).toContain('Review safely');
    expect(fs.readFileSync(path.join(firstDir, 'PROVENANCE.md'), 'utf-8')).toBe('Pinned upstream\n');
    expect(fs.readFileSync(path.join(firstDir, 'references', 'contract.md'), 'utf-8')).toBe('Offline only\n');
    expect(fs.existsSync(path.join(firstDir, 'scripts'))).toBe(false);
    expect(fs.readdirSync(packageRoot).filter((entry) => entry.startsWith('.staging-'))).toEqual([]);
  });
});
