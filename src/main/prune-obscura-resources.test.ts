import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

interface AfterPackContext {
  electronPlatformName: string;
  arch: number;
  appOutDir: string;
  packager: {
    appInfo: {
      productFilename: string;
    };
  };
}

type PruneObscuraResources = (context: AfterPackContext) => Promise<void>;

async function loadPruner(): Promise<PruneObscuraResources> {
  const scriptUrl = pathToFileURL(
    path.resolve(process.cwd(), 'scripts/prune-obscura-resources.mjs'),
  ).href;
  const script = await import(scriptUrl) as { default: PruneObscuraResources };
  return script.default;
}

async function createObscuraFixture(platform: string): Promise<{
  appOutDir: string;
  obscuraDir: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cdf-obscura-prune-'));
  const appOutDir = path.join(root, 'app-out');
  const obscuraDir = platform === 'darwin'
    ? path.join(appOutDir, 'CDF.app', 'Contents', 'Resources', 'obscura')
    : path.join(appOutDir, 'resources', 'obscura');

  await mkdir(obscuraDir, { recursive: true });
  await writeFile(path.join(obscuraDir, 'VERSION.md'), 'test');
  for (const directory of ['darwin-arm64', 'darwin-x64', 'win32-x64']) {
    const platformDir = path.join(obscuraDir, directory);
    await mkdir(platformDir, { recursive: true });
    await writeFile(path.join(platformDir, 'obscura'), 'test');
  }

  return {
    appOutDir,
    obscuraDir,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function retainedEntries(platform: string, arch: number): Promise<string[]> {
  const fixture = await createObscuraFixture(platform);
  try {
    const pruneObscuraResources = await loadPruner();
    await pruneObscuraResources({
      electronPlatformName: platform,
      arch,
      appOutDir: fixture.appOutDir,
      packager: { appInfo: { productFilename: 'CDF' } },
    });
    return (await readdir(fixture.obscuraDir)).sort();
  } finally {
    await fixture.cleanup();
  }
}

describe('pruneObscuraResources', () => {
  it.each([
    ['macOS x64', 'darwin', 1, ['VERSION.md', 'darwin-x64']],
    ['macOS ARM64', 'darwin', 3, ['VERSION.md', 'darwin-arm64']],
    ['Windows x64', 'win32', 1, ['VERSION.md', 'win32-x64']],
    ['Windows ARM64 without a bundled binary', 'win32', 3, ['VERSION.md']],
  ])('retains only the resources for %s', async (_name, platform, arch, expected) => {
    await expect(retainedEntries(platform as string, arch as number))
      .resolves.toEqual(expected);
  });
});
