import { describe, expect, it } from 'vitest';
import { createObscuraBrowserTool, createObscuraCliRunner, resolveObscuraExecutablePath } from './obscura-tool';

function parseToolResult(result: unknown) {
  return JSON.parse(String(result));
}

describe('createObscuraBrowserTool', () => {
  it('returns rendered page content as structured JSON', async () => {
    const obscuraBrowse = createObscuraBrowserTool({
      runner: {
        browse: async () => ({
          content: '# Example Domain\n\nThis domain is for use in illustrative examples.',
          title: 'Example Domain',
          stderr: '',
          exitCode: 0,
        }),
      },
    });

    const result = parseToolResult(await (obscuraBrowse as any).invoke({
      url: 'https://example.com',
      format: 'markdown',
    }));

    expect(result).toEqual({
      success: true,
      url: 'https://example.com',
      format: 'markdown',
      content: '# Example Domain\n\nThis domain is for use in illustrative examples.',
      metadata: {
        title: 'Example Domain',
        contentLength: 66,
      },
    });
  });

  it('returns a structured error for non-web URLs', async () => {
    const obscuraBrowse = createObscuraBrowserTool({
      runner: {
        browse: async () => {
          throw new Error('runner should not be called for invalid URLs');
        },
      },
    });

    const result = parseToolResult(await (obscuraBrowse as any).invoke({
      url: 'file:///Users/suntc/project/CDF/index.html',
    }));

    expect(result).toMatchObject({
      success: false,
      url: 'file:///Users/suntc/project/CDF/index.html',
      error: 'obscura_browse only supports http and https URLs.',
    });
  });

  it('returns a structured error when Obscura fails', async () => {
    const obscuraBrowse = createObscuraBrowserTool({
      runner: {
        browse: async () => {
          const error = new Error('Obscura timed out after 12000ms') as Error & {
            exitCode?: number;
            stderr?: string;
          };
          error.exitCode = -2;
          error.stderr = 'navigation timeout';
          throw error;
        },
      },
    });

    const result = parseToolResult(await (obscuraBrowse as any).invoke({
      url: 'https://example.com/slow',
      timeoutMs: 12000,
    }));

    expect(result).toEqual({
      success: false,
      url: 'https://example.com/slow',
      error: 'Obscura timed out after 12000ms',
      exitCode: -2,
      stderr: 'navigation timeout',
    });
  });
});

describe('createObscuraCliRunner', () => {
  it('runs Obscura fetch and returns rendered content', async () => {
    const calls: Array<{ command: string; args: string[]; timeoutMs: number }> = [];
    const runner = createObscuraCliRunner({
      executablePath: '/Applications/CDF.app/Contents/Resources/obscura/darwin-arm64/obscura',
      runCommand: async (command, args, options) => {
        calls.push({ command, args, timeoutMs: options.timeoutMs });
        return {
          stdout: '# Rendered page\n\nReady.',
          stderr: '',
          exitCode: 0,
        };
      },
    });

    const result = await runner.browse({
      url: 'https://example.com',
      format: 'markdown',
      waitUntil: 'networkidle',
      selector: '#content',
      timeoutMs: 15000,
      stealth: true,
      userAgent: 'CDF Test',
      proxy: 'http://127.0.0.1:8080',
    });

    expect(result).toEqual({
      content: '# Rendered page\n\nReady.',
      stderr: '',
      exitCode: 0,
    });
    expect(calls).toEqual([
      {
        command: '/Applications/CDF.app/Contents/Resources/obscura/darwin-arm64/obscura',
        args: [
          'fetch',
          'https://example.com',
          '--dump',
          'markdown',
          '--wait-until',
          'networkidle',
          '--selector',
          '#content',
          '--timeout',
          '15',
          '--stealth',
          '--user-agent',
          'CDF Test',
          '--proxy',
          'http://127.0.0.1:8080',
          '--quiet',
        ],
        timeoutMs: 15000,
      },
    ]);
  });
});

describe('resolveObscuraExecutablePath', () => {
  it('resolves bundled Obscura executables by platform and architecture', () => {
    expect(resolveObscuraExecutablePath('darwin', 'arm64', '/app/resources')).toBe(
      '/app/resources/obscura/darwin-arm64/obscura',
    );
    expect(resolveObscuraExecutablePath('darwin', 'x64', '/app/resources')).toBe(
      '/app/resources/obscura/darwin-x64/obscura',
    );
    expect(resolveObscuraExecutablePath('win32', 'x64', 'C:\\CDF\\resources')).toBe(
      'C:\\CDF\\resources/obscura/win32-x64/obscura.exe',
    );
    expect(() => resolveObscuraExecutablePath('linux', 'x64', '/app/resources')).toThrow(
      'Obscura is not bundled for linux-x64.',
    );
  });
});
