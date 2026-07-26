import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  PAPER_SEARCH_CONFIG_KEYS,
  type PaperSearchConfigEntry,
  type PaperSearchConfigKey,
  type PaperSearchConfigSettings,
} from '../shared/types';

interface PaperSearchConfigOptions {
  configPath?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  homeDir?: string;
}

const PAPER_SEARCH_CONFIG_KEY_SET = new Set<string>(PAPER_SEARCH_CONFIG_KEYS);

export function resolvePaperSearchConfigPath(options: PaperSearchConfigOptions = {}): string {
  const env = options.env ?? process.env;
  if (env.PAPER_SEARCH_CONFIG_FILE) {
    return env.PAPER_SEARCH_CONFIG_FILE;
  }
  const configDir = env.PAPER_SEARCH_CONFIG_DIR
    ?? path.join(options.homeDir ?? os.homedir(), '.config', 'paper-search-cli');
  return path.join(configDir, 'config.json');
}

function getConfigPath(options: PaperSearchConfigOptions): string {
  return options.configPath ?? resolvePaperSearchConfigPath(options);
}

function readConfig(configPath: string): Record<string, string> {
  if (!fs.existsSync(configPath)) return {};
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid paper-search config file: ${configPath}`);
  }
  return Object.fromEntries(
    Object.entries(parsed)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  );
}

function writeConfig(configPath: string, config: Record<string, string>): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(configPath, 0o600);
}

export function isPaperSearchConfigKey(key: string): key is PaperSearchConfigKey {
  return PAPER_SEARCH_CONFIG_KEY_SET.has(key);
}

function assertPaperSearchConfigKey(key: string): asserts key is PaperSearchConfigKey {
  if (!isPaperSearchConfigKey(key)) {
    throw new Error(`Unsupported paper-search config key: ${key}`);
  }
}

export function isPaperSearchSecretConfigKey(key: PaperSearchConfigKey): boolean {
  return key.includes('API_KEY')
    || key.includes('KEY')
    || key.includes('TOKEN');
}

function getConfigEntry(
  key: PaperSearchConfigKey,
  config: Record<string, string>,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): PaperSearchConfigEntry {
  const envValue = env[key] ?? '';
  const fileValue = config[key] ?? '';
  const value = envValue || fileValue;
  const secret = isPaperSearchSecretConfigKey(key);
  return {
    key,
    configured: value.length > 0,
    // Never send secret values across the IPC boundary. A compromised renderer could read
    // every stored API key at once. The UI relies on `configured` + a placeholder instead;
    // secrets are write-only from the renderer's perspective.
    value: secret ? '' : value,
    source: value ? (envValue ? 'environment' : 'user_config') : 'missing',
    secret,
  };
}

export function getPaperSearchConfigSettings(
  options: PaperSearchConfigOptions = {},
): PaperSearchConfigSettings {
  const env = options.env ?? process.env;
  const configPath = getConfigPath(options);
  const config = readConfig(configPath);
  const entries = PAPER_SEARCH_CONFIG_KEYS.map((key) => getConfigEntry(key, config, env));
  return {
    configPath,
    entries,
    configuredCount: entries.filter((entry) => entry.configured).length,
    totalCount: entries.length,
  };
}

export function setPaperSearchConfigValue(
  key: string,
  value: string,
  options: PaperSearchConfigOptions = {},
): PaperSearchConfigSettings {
  assertPaperSearchConfigKey(key);
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${key} cannot be empty`);
  }

  const configPath = getConfigPath(options);
  const config = readConfig(configPath);
  config[key] = trimmed;
  writeConfig(configPath, config);

  return getPaperSearchConfigSettings(options);
}

export function unsetPaperSearchConfigValue(
  key: string,
  options: PaperSearchConfigOptions = {},
): PaperSearchConfigSettings {
  assertPaperSearchConfigKey(key);
  const configPath = getConfigPath(options);
  const config = readConfig(configPath);
  delete config[key];
  writeConfig(configPath, config);

  return getPaperSearchConfigSettings(options);
}
