import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getPaperSearchConfigSettings,
  resolvePaperSearchConfigPath,
  setPaperSearchConfigValue,
  unsetPaperSearchConfigValue,
} from './paper-search-config';
import { PAPER_SEARCH_CONFIG_KEYS } from '../shared/types';

function expectOwnerOnlyMode(filePath: string): void {
  if (process.platform !== 'win32') {
    expect((fs.statSync(filePath).mode & 0o777).toString(8)).toBe('600');
  }
}

describe('paper-search config sync', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-paper-search-config-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves the same config file shape as paper-search-cli', () => {
    expect(resolvePaperSearchConfigPath({
      env: { PAPER_SEARCH_CONFIG_FILE: path.join(tempDir, 'custom.json') },
      homeDir: '/unused',
    })).toBe(path.join(tempDir, 'custom.json'));

    expect(resolvePaperSearchConfigPath({
      env: { PAPER_SEARCH_CONFIG_DIR: path.join(tempDir, 'paper-config') },
      homeDir: '/unused',
    })).toBe(path.join(tempDir, 'paper-config', 'config.json'));

    expect(resolvePaperSearchConfigPath({
      env: {},
      homeDir: tempDir,
    })).toBe(path.join(tempDir, '.config', 'paper-search-cli', 'config.json'));
  });

  it('reports every supported paper-search-cli config key', () => {
    const settings = getPaperSearchConfigSettings({
      configPath: path.join(tempDir, 'config.json'),
      env: {},
    });

    expect(settings.entries.map((entry) => entry.key)).toEqual([...PAPER_SEARCH_CONFIG_KEYS]);
    expect(settings.totalCount).toBe(PAPER_SEARCH_CONFIG_KEYS.length);
    expect(settings.configuredCount).toBe(0);
  });

  it('writes supported config values into paper-search-cli config without exporting env vars', () => {
    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      CROSSREF_MAILTO: 'cdf@example.com',
      HTTP_PROXY: 'http://127.0.0.1:7890',
    }, null, 2));

    const settings = setPaperSearchConfigValue('EASYSCHOLAR_KEY', 'sk-easy-scholar-secret', {
      configPath,
      env: {},
    });

    // Secret is persisted to disk but never echoed back across IPC (value blanked).
    expect(settings.entries.find((entry) => entry.key === 'EASYSCHOLAR_KEY')).toEqual({
      key: 'EASYSCHOLAR_KEY',
      configured: true,
      value: '',
      source: 'user_config',
      secret: true,
    });
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual({
      CROSSREF_MAILTO: 'cdf@example.com',
      HTTP_PROXY: 'http://127.0.0.1:7890',
      EASYSCHOLAR_KEY: 'sk-easy-scholar-secret',
    });
    expectOwnerOnlyMode(configPath);
    expect(process.env.EASYSCHOLAR_KEY).toBeUndefined();
  });

  it('removes only the requested key and preserves the rest of paper-search config', () => {
    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      CROSSREF_MAILTO: 'cdf@example.com',
      EASYSCHOLAR_KEY: 'sk-easy-scholar-secret',
    }, null, 2));

    const settings = unsetPaperSearchConfigValue('EASYSCHOLAR_KEY', { configPath, env: {} });

    expect(settings.entries.find((entry) => entry.key === 'EASYSCHOLAR_KEY')).toEqual({
      key: 'EASYSCHOLAR_KEY',
      configured: false,
      value: '',
      source: 'missing',
      secret: true,
    });
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual({
      CROSSREF_MAILTO: 'cdf@example.com',
    });
    expectOwnerOnlyMode(configPath);
  });

  it('echoes non-secret values but never exposes secrets across the IPC boundary', () => {
    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      EASYSCHOLAR_KEY: 'sk-easy-scholar-secret',
      UNPAYWALL_EMAIL: 'research@example.com',
      CROSSREF_MAILTO: 'cdf@example.com',
    }, null, 2));

    const settings = getPaperSearchConfigSettings({ configPath, env: {} });

    // Secret: configured is reported, but the value is blanked (write-only).
    expect(settings.entries.find((entry) => entry.key === 'EASYSCHOLAR_KEY')).toMatchObject({
      value: '',
      configured: true,
      secret: true,
    });
    // No secret value must leak anywhere in the serialized settings payload.
    expect(JSON.stringify(settings)).not.toContain('sk-easy-scholar-secret');
    // Non-secrets are still echoed so the UI can display/edit them.
    expect(settings.entries.find((entry) => entry.key === 'CROSSREF_MAILTO')).toMatchObject({
      value: 'cdf@example.com',
      secret: false,
    });
    expect(settings.entries.find((entry) => entry.key === 'UNPAYWALL_EMAIL')).toMatchObject({
      value: 'research@example.com',
      secret: false,
    });
  });

  it('reports environment values as configured without writing them into the config file', () => {
    const configPath = path.join(tempDir, 'config.json');
    const settings = getPaperSearchConfigSettings({
      configPath,
      env: { WOS_API_KEY: 'wos-secret-key' },
    });

    // Secret from the environment: reported as configured, value blanked, never echoed.
    expect(settings.entries.find((entry) => entry.key === 'WOS_API_KEY')).toEqual({
      key: 'WOS_API_KEY',
      configured: true,
      value: '',
      source: 'environment',
      secret: true,
    });
    expect(JSON.stringify(settings)).not.toContain('wos-secret-key');
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('rejects unsupported paper-search config keys', () => {
    expect(() => setPaperSearchConfigValue('UNKNOWN_KEY', 'value', {
      configPath: path.join(tempDir, 'config.json'),
      env: {},
    })).toThrow('Unsupported paper-search config key');
  });

  it('does not let CDF manage runtime or network config keys', () => {
    expect(() => setPaperSearchConfigValue('LOG_LEVEL', 'debug', {
      configPath: path.join(tempDir, 'config.json'),
      env: {},
    })).toThrow('Unsupported paper-search config key');

    expect(() => setPaperSearchConfigValue('HTTP_PROXY', 'http://127.0.0.1:7890', {
      configPath: path.join(tempDir, 'config.json'),
      env: {},
    })).toThrow('Unsupported paper-search config key');
  });

  it('does not let CDF manage hidden optional aliases or defaults', () => {
    expect(() => setPaperSearchConfigValue('PAPER_SEARCH_UNPAYWALL_EMAIL', 'cdf@example.com', {
      configPath: path.join(tempDir, 'config.json'),
      env: {},
    })).toThrow('Unsupported paper-search config key');

    expect(() => setPaperSearchConfigValue('CORE_MAX_RESULTS_CAP', '25', {
      configPath: path.join(tempDir, 'config.json'),
      env: {},
    })).toThrow('Unsupported paper-search config key');
  });
});
