import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { tool } from '@langchain/core/tools';

type ObscuraOutputFormat = 'markdown' | 'text' | 'html';

export interface ObscuraBrowseInput {
  url: string;
  format?: ObscuraOutputFormat;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  selector?: string;
  timeoutMs?: number;
  stealth?: boolean;
  userAgent?: string;
  proxy?: string;
}

export interface ObscuraRunnerResult {
  content: string;
  title?: string;
  stderr?: string;
  exitCode?: number;
}

export interface ObscuraRunner {
  browse(input: Required<Pick<ObscuraBrowseInput, 'url' | 'format'>> & Omit<ObscuraBrowseInput, 'url' | 'format'>): Promise<ObscuraRunnerResult>;
}

export interface CreateObscuraBrowserToolOptions {
  runner: ObscuraRunner;
}

export interface ObscuraCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ObscuraCommandOptions {
  timeoutMs: number;
}

export type ObscuraCommandRunner = (
  command: string,
  args: string[],
  options: ObscuraCommandOptions,
) => Promise<ObscuraCommandResult>;

export interface CreateObscuraCliRunnerOptions {
  executablePath?: string;
  runCommand?: ObscuraCommandRunner;
}

const OBSCURA_BROWSE_SCHEMA = {
  type: 'object' as const,
  properties: {
    url: {
      type: 'string',
      description: 'The http or https URL to render with Obscura.',
    },
    format: {
      type: 'string',
      enum: ['markdown', 'text', 'html'],
      description: 'Output format. Defaults to markdown.',
      default: 'markdown',
    },
    waitUntil: {
      type: 'string',
      enum: ['load', 'domcontentloaded', 'networkidle'],
      description: 'Page readiness condition before extracting content.',
    },
    selector: {
      type: 'string',
      description: 'Optional CSS selector to wait for before extracting content.',
    },
    timeoutMs: {
      type: 'number',
      description: 'Timeout in milliseconds.',
    },
    stealth: {
      type: 'boolean',
      description: 'Enable Obscura stealth mode when supported.',
    },
    userAgent: {
      type: 'string',
      description: 'Optional User-Agent override.',
    },
    proxy: {
      type: 'string',
      description: 'Optional proxy URL.',
    },
  },
  required: ['url'],
  additionalProperties: false,
};

function normalizeFormat(format: ObscuraBrowseInput['format']): ObscuraOutputFormat {
  return format ?? 'markdown';
}

function validateWebUrl(url: string): { ok: true } | { ok: false; error: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return { ok: true };
    }
  } catch {
    return { ok: false, error: 'obscura_browse requires a valid http or https URL.' };
  }

  return { ok: false, error: 'obscura_browse only supports http and https URLs.' };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorField(error: unknown, field: 'exitCode' | 'stderr'): unknown {
  return error && typeof error === 'object' ? (error as Record<string, unknown>)[field] : undefined;
}

function getResourcesPath(): string {
  const packagedResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (packagedResourcesPath && fs.existsSync(path.join(packagedResourcesPath, 'obscura'))) {
    return packagedResourcesPath;
  }
  return path.join(process.cwd(), 'resources');
}

function getPlatformResourceName(platform: NodeJS.Platform, arch: NodeJS.Architecture): string {
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64';
  if (platform === 'win32' && arch === 'x64') return 'win32-x64';
  throw new Error(`Obscura is not bundled for ${platform}-${arch}.`);
}

export function resolveObscuraExecutablePath(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
  resourcesPath: string = getResourcesPath(),
): string {
  const resourceName = getPlatformResourceName(platform, arch);
  const executableName = platform === 'win32' ? 'obscura.exe' : 'obscura';
  return path.join(resourcesPath, 'obscura', resourceName, executableName);
}

function runCommandWithSpawn(command: string, args: string[], options: ObscuraCommandOptions): Promise<ObscuraCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let isSettled = false;
    const timer = setTimeout(() => {
      if (isSettled) return;
      isSettled = true;
      child.kill('SIGTERM');
      const error = new Error(`Obscura timed out after ${options.timeoutMs}ms`) as Error & {
        exitCode?: number;
        stderr?: string;
      };
      error.exitCode = -2;
      error.stderr = stderr;
      reject(error);
    }, options.timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (exitCode) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: exitCode ?? 0 });
    });
  });
}

export function createObscuraBrowserTool({ runner }: CreateObscuraBrowserToolOptions) {
  return tool(
    async (input: ObscuraBrowseInput) => {
      const format = normalizeFormat(input.format);
      const urlValidation = validateWebUrl(input.url);
      if (!urlValidation.ok) {
        return JSON.stringify({
          success: false,
          url: input.url,
          error: urlValidation.error,
        });
      }

      let result: ObscuraRunnerResult;
      try {
        result = await runner.browse({ ...input, format });
      } catch (error) {
        return JSON.stringify({
          success: false,
          url: input.url,
          error: errorMessage(error),
          exitCode: errorField(error, 'exitCode'),
          stderr: errorField(error, 'stderr'),
        });
      }

      return JSON.stringify({
        success: true,
        url: input.url,
        format,
        content: result.content,
        metadata: {
          title: result.title ?? '',
          contentLength: result.content.length,
        },
      });
    },
    {
      name: 'obscura_browse',
      description: 'Render a browser-backed web page with Obscura and return extracted page content. Use this for pages that need JavaScript rendering or a browser environment.',
      schema: OBSCURA_BROWSE_SCHEMA,
    },
  );
}

function buildObscuraFetchArgs(input: Required<Pick<ObscuraBrowseInput, 'url' | 'format'>> & Omit<ObscuraBrowseInput, 'url' | 'format'>): string[] {
  const args = ['fetch', input.url, '--dump', input.format];
  if (input.waitUntil) args.push('--wait-until', input.waitUntil);
  if (input.selector) args.push('--selector', input.selector);
  if (input.timeoutMs) args.push('--timeout', String(Math.max(1, Math.ceil(input.timeoutMs / 1000))));
  if (input.stealth) args.push('--stealth');
  if (input.userAgent) args.push('--user-agent', input.userAgent);
  if (input.proxy) args.push('--proxy', input.proxy);
  args.push('--quiet');
  return args;
}

export function createObscuraCliRunner(options: CreateObscuraCliRunnerOptions = {}): ObscuraRunner {
  const runCommand = options.runCommand ?? runCommandWithSpawn;

  return {
    async browse(input) {
      const executablePath = options.executablePath ?? resolveObscuraExecutablePath();
      const timeoutMs = input.timeoutMs ?? 12000;
      const result = await runCommand(executablePath, buildObscuraFetchArgs(input), { timeoutMs });
      if (result.exitCode !== 0) {
        const error = new Error(result.stderr || `Obscura exited with code ${result.exitCode}`) as Error & {
          exitCode?: number;
          stderr?: string;
        };
        error.exitCode = result.exitCode;
        error.stderr = result.stderr;
        throw error;
      }

      return {
        content: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    },
  };
}
