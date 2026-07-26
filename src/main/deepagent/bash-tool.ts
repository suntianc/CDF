import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import { tool } from '@langchain/core/tools';

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
  shell?: string;
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

function truncateOutput(text: string, maxOutputBytes: number, label: string): string {
  return text.length > maxOutputBytes
    ? text.slice(0, maxOutputBytes) + `\n... ${label} truncated (size limit)`
    : text;
}

/**
 * Run a command in its own process group so a timeout kills the whole subtree, not just
 * the shell. `exec`'s timeout only SIGTERMs the direct child, leaking any long-running
 * descendants the shell spawned.
 */
function runInDetachedShell(
  command: string,
  opts: { cwd: string; shell: string; timeoutMs: number; maxOutputBytes: number },
): Promise<BashResult> {
  const { cwd, shell, timeoutMs, maxOutputBytes } = opts;
  const posix = process.platform !== 'win32';
  return new Promise<BashResult>((resolve) => {
    const child = spawn(command, [], {
      cwd,
      env: process.env,
      shell,
      windowsHide: true,
      detached: posix, // new process group on POSIX so we can signal the whole tree
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const killTree = (signal: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        // Negative pid targets the whole process group (POSIX). On Windows fall back to
        // killing the child; spawned descendants there are best-effort.
        if (posix) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // Process/group already gone.
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree('SIGTERM');
      const escalate = setTimeout(() => killTree('SIGKILL'), 2000);
      escalate.unref?.();
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      if (stdout.length <= maxOutputBytes) stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      if (stderr.length <= maxOutputBytes) stderr += String(chunk);
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: '', stderr: error.message, exitCode: -3, success: false, error: error.message });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const outT = truncateOutput(stdout, maxOutputBytes, 'output');
      const errT = truncateOutput(stderr, maxOutputBytes, 'error');
      if (timedOut) {
        resolve({
          stdout: outT,
          stderr: errT || `Command timed out after ${timeoutMs}ms`,
          exitCode: -2,
          success: false,
          error: 'Timeout',
        });
      } else if (code === 0) {
        resolve({ stdout: outT, stderr: errT, exitCode: 0, success: true });
      } else {
        resolve({
          stdout: outT,
          stderr: errT,
          exitCode: code ?? -3,
          success: false,
          error: `Command failed: ${command}`,
        });
      }
    });
  });
}

export function createBashTool(options: BashToolOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutputBytes = options.maxOutputBytes ?? 100 * 1024;
  const workingDir = options.workingDir ?? os.tmpdir();
  const allowedCommands = options.allowedCommands;
  const shell = options.shell ?? process.env.SHELL ?? (process.platform === 'win32' ? 'bash.exe' : '/bin/bash');

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

    if (!fs.existsSync(workingDir) || !fs.statSync(workingDir).isDirectory()) {
      const msg = `Working directory does not exist: ${workingDir}`;
      return {
        stdout: '',
        stderr: msg,
        exitCode: -4,
        success: false,
        error: msg,
      };
    }

    return runInDetachedShell(command, { cwd: workingDir, shell, timeoutMs, maxOutputBytes });
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
