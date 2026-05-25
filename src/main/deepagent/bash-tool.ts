import { exec } from 'child_process';
import { promisify } from 'util';
import { tool } from '@langchain/core/tools';

const execAsync = promisify(exec);

interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
  error?: string;
}

interface BashToolOptions {
  allowedCommands?: Set<string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
  workingDir?: string;
}

const DANGEROUS_PATTERNS: RegExp[] = [
  /rm\s+(-rf?|--recursive)?\s+\//,
  /mkfs/,
  /dd\s+if=/,
  /:\(\)\s*\{\s*:\s*\|\s*:&\s*\};:/,
  />\s*\/dev\/sd[a-z]/,
  /chmod\s+777\s+\//,
  /curl.*\|\s*sh/,
  /wget.*\|\s*bash/,
];

export function createBashTool(options: BashToolOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutputBytes = options.maxOutputBytes ?? 100 * 1024;
  const workingDir = options.workingDir ?? '/tmp';
  const allowedCommands = options.allowedCommands;

  async function executeCommand(command: string): Promise<BashResult> {
    if (!command.trim()) {
      return {
        stdout: '',
        stderr: 'Empty command',
        exitCode: -1,
        success: false,
        error: 'Empty command',
      };
    }

    const firstWord = command.trim().split(/\s+/)[0];
    if (allowedCommands && allowedCommands.size > 0 && !allowedCommands.has(firstWord)) {
      const msg = `Command '${firstWord}' is not in allowed list: ${[...allowedCommands].join(', ')}`;
      return {
        stdout: '',
        stderr: msg,
        exitCode: -1,
        success: false,
        error: msg,
      };
    }

    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        const msg = `Dangerous pattern detected: ${pattern.source}`;
        return {
          stdout: '',
          stderr: msg,
          exitCode: -1,
          success: false,
          error: msg,
        };
      }
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: timeoutMs,
        maxBuffer: maxOutputBytes,
        cwd: workingDir,
        env: { PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' },
      } as any);

      let truncatedStdout = stdout;
      let truncatedStderr = stderr;
      if (stdout.length > maxOutputBytes) {
        truncatedStdout = stdout.slice(0, maxOutputBytes) + '\n... output truncated (size limit)';
      }
      if (stderr.length > maxOutputBytes) {
        truncatedStderr = stderr.slice(0, maxOutputBytes) + '\n... error truncated (size limit)';
      }

      return {
        stdout: truncatedStdout,
        stderr: truncatedStderr,
        exitCode: 0,
        success: true,
      };
    } catch (error: any) {
      if (error.killed && error.signal === 'SIGTERM') {
        return {
          stdout: error.stdout ?? '',
          stderr: error.stderr ?? `Command timed out after ${timeoutMs}ms`,
          exitCode: -2,
          success: false,
          error: 'Timeout',
        };
      }
      if (error.stdout !== undefined || error.stderr !== undefined) {
        return {
          stdout: typeof error.stdout === 'string' ? error.stdout : String(error.stdout),
          stderr: typeof error.stderr === 'string' ? error.stderr : String(error.stderr),
          exitCode: error.code ?? 1,
          success: false,
          error: error.message,
        };
      }
      return {
        stdout: '',
        stderr: error.message,
        exitCode: -3,
        success: false,
        error: error.message,
      };
    }
  }

  return tool(
    async (input: { command: string }) => {
      const result = await executeCommand(input.command);

      if (result.success) {
        return JSON.stringify({
          success: true,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        });
      } else {
        return JSON.stringify({
          success: false,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          error: result.error,
        });
      }
    },
    {
      name: 'bash',
      description: 'Execute a bash command. Returns stdout, stderr, and exit code. Use this to run system commands, scripts, or interact with the file system. Only use for tasks that require shell commands.',
      schema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The bash command to execute',
          },
        },
        required: ['command'],
        additionalProperties: false,
      },
    }
  );
}
