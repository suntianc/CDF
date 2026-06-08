import { execFileSync } from 'child_process';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import log from './logger';

const PROXY_ENV_KEYS = [
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'all_proxy',
  'no_proxy',
] as const;

type ProxyEnvKey = (typeof PROXY_ENV_KEYS)[number];

const DEFAULT_NO_PROXY = [
  'localhost',
  '127.0.0.1',
  '::1',
  '<local>',
  '*.local',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
].join(',');

function hasProxyEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.HTTPS_PROXY ||
      env.HTTP_PROXY ||
      env.ALL_PROXY ||
      env.https_proxy ||
      env.http_proxy ||
      env.all_proxy
  );
}

function redactProxyValue(value: string | undefined): string {
  if (!value) return '';
  return value.replace(/\/\/([^/@]+)@/, '//***@');
}

function parseEnvLines(output: string): Partial<Record<ProxyEnvKey, string>> {
  const parsed: Partial<Record<ProxyEnvKey, string>> = {};
  for (const line of output.split('\n')) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator) as ProxyEnvKey;
    if (!PROXY_ENV_KEYS.includes(key)) continue;
    const value = line.slice(separator + 1).trim();
    if (value) parsed[key] = value;
  }
  return parsed;
}

function readLaunchctlProxyEnv(): Partial<Record<ProxyEnvKey, string>> {
  if (process.platform !== 'darwin') return {};

  const values: Partial<Record<ProxyEnvKey, string>> = {};
  for (const key of PROXY_ENV_KEYS) {
    try {
      const value = execFileSync('/bin/launchctl', ['getenv', key], {
        encoding: 'utf8',
        timeout: 500,
      }).trim();
      if (value) values[key] = value;
    } catch {
      // launchctl returns a non-zero exit code when a key is not set.
    }
  }
  return values;
}

function readLoginShellProxyEnv(): Partial<Record<ProxyEnvKey, string>> {
  if (process.platform !== 'darwin') return {};

  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const output = execFileSync(
      shell,
      [
        '-lc',
        'for key in HTTPS_PROXY HTTP_PROXY ALL_PROXY NO_PROXY https_proxy http_proxy all_proxy no_proxy; do eval "value=\\${$key-}"; [ -n "$value" ] && printf "%s=%s\\n" "$key" "$value"; done',
      ],
      {
        encoding: 'utf8',
        timeout: 1500,
      }
    );
    return parseEnvLines(output);
  } catch (error) {
    log.warn('[network-proxy] Failed to read login shell proxy env:', error);
    return {};
  }
}

function parseScutilProxy(output: string): Partial<Record<ProxyEnvKey, string>> {
  const values = new Map<string, string>();
  for (const line of output.split('\n')) {
    const match = line.match(/^\s*([A-Za-z0-9]+)\s+:\s+(.+?)\s*$/);
    if (match) {
      values.set(match[1], match[2]);
    }
  }

  const parsed: Partial<Record<ProxyEnvKey, string>> = {};
  const httpHost = values.get('HTTPProxy');
  const httpPort = values.get('HTTPPort');
  if (values.get('HTTPEnable') === '1' && httpHost && httpPort) {
    parsed.HTTP_PROXY = `http://${httpHost}:${httpPort}`;
  }

  const httpsHost = values.get('HTTPSProxy');
  const httpsPort = values.get('HTTPSPort');
  if (values.get('HTTPSEnable') === '1' && httpsHost && httpsPort) {
    parsed.HTTPS_PROXY = `http://${httpsHost}:${httpsPort}`;
  }

  const socksHost = values.get('SOCKSProxy');
  const socksPort = values.get('SOCKSPort');
  if (!parsed.HTTP_PROXY && !parsed.HTTPS_PROXY && values.get('SOCKSEnable') === '1' && socksHost && socksPort) {
    parsed.ALL_PROXY = `socks://${socksHost}:${socksPort}`;
  }

  const exceptions = Array.from(output.matchAll(/^\s*\d+\s+:\s+(.+?)\s*$/gm))
    .map((match) => match[1])
    .filter(Boolean);
  if (exceptions.length > 0) {
    parsed.NO_PROXY = exceptions.join(',');
  }

  return parsed;
}

function readMacSystemProxyEnv(): Partial<Record<ProxyEnvKey, string>> {
  if (process.platform !== 'darwin') return {};

  try {
    const output = execFileSync('/usr/sbin/scutil', ['--proxy'], {
      encoding: 'utf8',
      timeout: 800,
    });
    return parseScutilProxy(output);
  } catch (error) {
    log.warn('[network-proxy] Failed to read macOS system proxy:', error);
    return {};
  }
}

function discoverProxyEnv(): Partial<Record<ProxyEnvKey, string>> {
  if (hasProxyEnv()) {
    return readMacSystemProxyEnv();
  }

  return {
    ...readLaunchctlProxyEnv(),
    ...readMacSystemProxyEnv(),
    ...readLoginShellProxyEnv(),
  };
}

function hydrateProxyEnv(): void {
  const discovered = discoverProxyEnv();
  for (const key of PROXY_ENV_KEYS) {
    if (!process.env[key] && discovered[key]) {
      process.env[key] = discovered[key];
    }
  }

  if (!process.env.NO_PROXY && !process.env.no_proxy) {
    process.env.NO_PROXY = discovered.NO_PROXY || discovered.no_proxy || DEFAULT_NO_PROXY;
  }
}

export function configureNetworkProxy(): void {
  hydrateProxyEnv();

  if (!hasProxyEnv()) {
    log.info('[network-proxy] No HTTP proxy environment detected');
    return;
  }

  setGlobalDispatcher(new EnvHttpProxyAgent());
  log.info('[network-proxy] Enabled HTTP proxy env for main-process requests', {
    HTTPS_PROXY: redactProxyValue(process.env.HTTPS_PROXY || process.env.https_proxy),
    HTTP_PROXY: redactProxyValue(process.env.HTTP_PROXY || process.env.http_proxy),
    ALL_PROXY: redactProxyValue(process.env.ALL_PROXY || process.env.all_proxy),
    NO_PROXY: process.env.NO_PROXY || process.env.no_proxy || '',
  });
}
