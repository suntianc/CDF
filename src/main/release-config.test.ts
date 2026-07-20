import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface PackageJson {
  build?: {
    artifactName?: string;
    mac?: { target?: string[] };
    win?: { target?: string[] };
    linux?: { target?: string[] };
  };
}

interface ReleaseMatrixEntry {
  name: string;
  runner: string;
  artifact_name: string;
  builder_args: string;
  artifact_path: string;
}

interface ReleaseWorkflow {
  on?: Record<string, unknown>;
  jobs?: {
    'verify-version'?: unknown;
    package?: {
      needs?: string;
      strategy?: {
        matrix?: {
          include?: ReleaseMatrixEntry[];
        };
      };
    };
    publish?: {
      needs?: string;
      if?: string;
    };
  };
}

function readPackageJson(): PackageJson {
  return JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'),
  ) as PackageJson;
}

function readReleaseWorkflow(): ReleaseWorkflow {
  return parse(
    fs.readFileSync(path.resolve(process.cwd(), '.github/workflows/release.yml'), 'utf-8'),
  ) as ReleaseWorkflow;
}

describe('release packaging', () => {
  it('matches the Nezha platform, architecture, and installer target set', () => {
    const build = readPackageJson().build;

    expect(build?.artifactName).toBe('${productName}-${version}-${os}-${arch}.${ext}');
    expect(build?.mac?.target).toEqual(['dmg']);
    expect(build?.win?.target).toEqual(['nsis', 'msi']);
    expect(build?.linux?.target).toEqual(['deb', 'rpm']);
  });

  it('builds each release architecture on an explicit runner', () => {
    const workflow = readReleaseWorkflow();
    const packageJob = workflow.jobs?.package;
    const matrix = packageJob?.strategy?.matrix?.include ?? [];

    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(workflow.jobs?.['verify-version']).toBeDefined();
    expect(packageJob?.needs).toBe('verify-version');
    expect(workflow.jobs?.publish?.needs).toBe('package');
    expect(workflow.jobs?.publish?.if).toBe("startsWith(github.ref, 'refs/tags/v')");
    expect(matrix.map(({ name, runner, artifact_name, builder_args }) => ({
      name,
      runner,
      artifact_name,
      builder_args,
    }))).toEqual([
      {
        name: 'Windows x86_64',
        runner: 'windows-latest',
        artifact_name: 'CDF-windows-x86_64',
        builder_args: '--win --x64',
      },
      {
        name: 'Windows ARM64',
        runner: 'windows-11-arm',
        artifact_name: 'CDF-windows-arm64',
        builder_args: '--win --arm64',
      },
      {
        name: 'macOS x86_64',
        runner: 'macos-15-intel',
        artifact_name: 'CDF-macos-x86_64',
        builder_args: '--mac --x64',
      },
      {
        name: 'macOS ARM64',
        runner: 'macos-15',
        artifact_name: 'CDF-macos-arm64',
        builder_args: '--mac --arm64',
      },
      {
        name: 'Linux x86_64',
        runner: 'ubuntu-22.04',
        artifact_name: 'CDF-linux-x86_64',
        builder_args: '--linux --x64',
      },
    ]);

    expect(matrix.find(({ name }) => name === 'Windows x86_64')?.artifact_path)
      .toContain('dist/*.msi');
    expect(matrix.find(({ name }) => name === 'Windows ARM64')?.artifact_path)
      .toContain('dist/*.msi');
    expect(matrix.find(({ name }) => name === 'Linux x86_64')?.artifact_path)
      .toContain('dist/*.deb');
    expect(matrix.find(({ name }) => name === 'Linux x86_64')?.artifact_path)
      .toContain('dist/*.rpm');
  });
});
