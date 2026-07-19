import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  scripts?: Record<string, string>;
}

function readPackageScripts(): Record<string, string> {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'),
  ) as PackageJson;
  return packageJson.scripts ?? {};
}

describe('package scripts', () => {
  it('prepares the bundled Paper Search CLI before development Electron starts', () => {
    const scripts = readPackageScripts();

    for (const scriptName of ['dev', 'dev:electron']) {
      const script = scripts[scriptName] ?? '';
      const prepareIndex = script.indexOf('pnpm run build:paper-search');
      const electronViteDevIndex = script.indexOf('electron-vite dev');

      expect(prepareIndex, `${scriptName} should build the Paper Search runtime`).toBeGreaterThanOrEqual(0);
      expect(electronViteDevIndex, `${scriptName} should start electron-vite dev`).toBeGreaterThanOrEqual(0);
      expect(prepareIndex, `${scriptName} should build the Paper Search runtime before Electron starts`).toBeLessThan(electronViteDevIndex);
    }
  });
});
