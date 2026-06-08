import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createBashTool } from './bash-tool';

function parseToolResult(result: unknown) {
  return JSON.parse(String(result));
}

describe('createBashTool', () => {
  let workingDir: string;
  let binDir: string;
  let originalHome: string | undefined;
  let originalPath: string | undefined;

  beforeEach(() => {
    workingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-bash-tool-'));
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-bash-tool-bin-'));
    originalHome = process.env.HOME;
    originalPath = process.env.PATH;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    fs.rmSync(workingDir, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it('inherits HOME from the parent process environment', async () => {
    process.env.HOME = path.join(workingDir, 'home');
    const bash = createBashTool({ workingDir });

    const result = parseToolResult(await (bash as any).invoke({ command: 'printf "%s" "$HOME"' }));

    expect(result).toMatchObject({
      success: true,
      exitCode: 0,
      stdout: process.env.HOME,
    });
  });

  it('uses the parent PATH instead of a hard-coded minimal PATH', async () => {
    const commandPath = path.join(binDir, 'cdf-path-probe');
    fs.writeFileSync(commandPath, '#!/bin/sh\nprintf "found-on-path"\n', 'utf-8');
    fs.chmodSync(commandPath, 0o755);
    process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ''}`;
    const bash = createBashTool({ workingDir });

    const result = parseToolResult(await (bash as any).invoke({ command: 'cdf-path-probe' }));

    expect(result).toMatchObject({
      success: true,
      exitCode: 0,
      stdout: 'found-on-path',
    });
  });

  it('returns a structured error when the working directory is missing', async () => {
    const missingDir = path.join(workingDir, 'missing');
    const bash = createBashTool({ workingDir: missingDir });

    const result = parseToolResult(await (bash as any).invoke({ command: 'pwd' }));

    expect(result).toMatchObject({
      success: false,
      stdout: '',
      stderr: `Working directory does not exist: ${missingDir}`,
      exitCode: -4,
      error: `Working directory does not exist: ${missingDir}`,
    });
  });

  it('keeps existing empty command validation', async () => {
    const bash = createBashTool({ workingDir });

    const result = parseToolResult(await (bash as any).invoke({ command: '   ' }));

    expect(result).toMatchObject({
      success: false,
      stderr: 'Empty command',
      exitCode: -1,
      error: 'Empty command',
    });
  });

  it('keeps existing dangerous command validation', async () => {
    const bash = createBashTool({ workingDir });

    const result = parseToolResult(await (bash as any).invoke({ command: 'rm -rf /' }));

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(-1);
    expect(result.error).toContain('Dangerous pattern detected');
  });

  it('keeps existing failed command reporting', async () => {
    const bash = createBashTool({ workingDir });

    const result = parseToolResult(await (bash as any).invoke({ command: 'printf "nope" >&2; exit 7' }));

    expect(result.success).toBe(false);
    expect(result.stderr).toBe('nope');
    expect(result.exitCode).toBe(7);
    expect(result.error).toContain('Command failed');
  });
});
