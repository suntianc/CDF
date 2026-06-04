import { BrowserWindow } from 'electron';
import chokidar from 'chokidar';
import os from 'os';
import path from 'path';
import log from '../logger';

// P6.6: os.homedir() must be called from app.whenReady — see src/main/index.ts init site.

/**
 * Module-private debounce helper. Coalesces multiple chokidar events into a
 * single invocation (P6.3: chokidar event storm protection).
 */
function debounce<T extends (...args: any[]) => any>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  }) as T;
}

/**
 * D-23 + D-24: Watch `~/.cdf/commands/*.md` for changes. Fires `onChange`
 * (after a 100ms debounce + 200ms awaitWriteFinish coalesce) and pushes a
 * `commands:changed` event to all renderer windows. Errors are logged via
 * electron-log only (D-24: NO toast, deferred to Phase 8 polish).
 *
 * Returns a sync stop function. Caller is responsible for invoking it on
 * app teardown if needed.
 *
 * P6.6: `os.homedir()` must be ready at call time. Call site must be inside
 * `app.whenReady` in `src/main/index.ts`.
 */
export function watchSystemCommandsDir(onChange: () => Promise<void>): () => void {
  const systemDir = path.join(os.homedir(), '.cdf', 'commands');
  return startWatcher(systemDir, onChange);
}

/**
 * D-23: Watch `<projectPath>/.cdf/commands/*.md` for changes. Same semantics
 * as `watchSystemCommandsDir` but for a project-scoped directory.
 */
export function watchProjectCommandsDir(
  projectPath: string,
  onChange: () => Promise<void>
): () => void {
  const projectDir = path.join(projectPath, '.cdf', 'commands');
  return startWatcher(projectDir, onChange);
}

// Module-scope state for the lazy project watcher. When the user switches
// projects (rare in a session lifecycle), we stop the old watcher and start
// a new one.
let projectWatcherStop: (() => void) | null = null;
let currentProjectPath: string | null = null;

/**
 * Idempotently start (or re-start) the project-scoped chokidar watcher.
 * Called from the `commands:list` IPC handler after resolving `project.path`.
 * P6.6: this is called AFTER `app.whenReady` (the IPC handler is registered
 * there), so `os.homedir()` is ready.
 */
export function ensureProjectWatcher(projectPath: string): void {
  if (currentProjectPath === projectPath && projectWatcherStop) {
    return;
  }
  if (projectWatcherStop) {
    projectWatcherStop();
    projectWatcherStop = null;
  }
  projectWatcherStop = watchProjectCommandsDir(projectPath, async () => {
    // chokidar onChange fires commands:changed via the watcher module
  });
  currentProjectPath = projectPath;
  log.info(`[commands-watcher] project watcher started: ${projectPath}/.cdf/commands`);
}

function startWatcher(dir: string, onChange: () => Promise<void>): () => void {
  const handle = chokidar.watch(dir, {
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    ignoreInitial: true,
    depth: 0,
    usePolling: false,
  });

  const fire = debounce(async () => {
    try {
      await onChange();
    } catch (err) {
      log.error('[commands-watcher] onChange callback failed:', err);
    }
    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.send('commands:changed', { source: 'chokidar' });
    });
  }, 100);

  ['add', 'change', 'unlink'].forEach((evt) => {
    handle.on(evt, () => {
      void fire();
    });
  });

  handle.on('error', (err) => {
    log.error('[commands-watcher] chokidar error:', err);
  });

  return () => {
    void handle.close();
  };
}
