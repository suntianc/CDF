import { BrowserWindow } from 'electron';
import chokidar from 'chokidar';
import fs from 'fs';
import os from 'os';
import path from 'path';
import log from '../logger';

// P6.6: os.homedir() must be called from app.whenReady — see src/main/index.ts init site.
// Phase 8 — D-16..D-19: chokidar failure degradation. When chokidar.watch() throws
// OR emits 'error', we degrade gracefully: do a one-shot readdir() of the target
// directory, push a `commands:fallback` IPC event to renderer, and stop trying
// to re-init chokidar (D-19: first-error-wins via `degraded` flag).

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

// Phase 8 — D-19: first-error-wins degraded flag. Module-scope so any
// subsequent chokidar.watch() in the same session reuses the same flag
// (prevents re-init storms if the FS is briefly readonly during startup).
let degraded = false;

function emitFallbackEvent(scope: 'system' | 'project', dir: string, error: string): void {
  try {
    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.send('commands:fallback', { scope, dir, error });
    });
  } catch (emitErr) {
    log.error('[commands-watcher] emit commands:fallback failed:', emitErr);
  }
}

function readdirFallback(dir: string, scope: 'system' | 'project'): void {
  // D-16: best-effort readdir as a static snapshot. Errors here are logged
  // but do NOT trigger toast (the chokidar failure toast already fired).
  try {
    const files = fs.readdirSync(dir);
    log.info(`[commands-watcher] readdir fallback for ${scope} dir=${dir}: ${files.length} entries`);
  } catch (readErr) {
    log.error(`[commands-watcher] readdir fallback also failed for ${scope} dir=${dir}:`, readErr);
  }
}

function degradeAndFallback(scope: 'system' | 'project', dir: string, err: unknown): void {
  if (degraded) return; // D-19: first-error-wins; no retry storm
  degraded = true;
  const msg = err instanceof Error ? err.message : String(err);
  log.error(`[commands-watcher] chokidar degraded for ${scope} dir=${dir}:`, err);
  readdirFallback(dir, scope);
  emitFallbackEvent(scope, dir, msg);
}

/**
 * Test-only: reset the module-scope `degraded` flag so each test in the
 * fallback describe block can exercise the D-16 first-fail and D-19
 * first-error-wins behavior in isolation. Not part of the public API.
 */
export function __resetDegradedForTests(): void {
  degraded = false;
  projectWatcherStop = null;
  currentProjectPath = null;
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
  return startWatcher(systemDir, onChange, 'system');
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
  return startWatcher(projectDir, onChange, 'project');
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

function startWatcher(dir: string, onChange: () => Promise<void>, scope: 'system' | 'project' = 'system'): () => void {
  let handle: ReturnType<typeof chokidar.watch>;
  try {
    handle = chokidar.watch(dir, {
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
      ignoreInitial: true,
      depth: 0,
      usePolling: false,
    });
  } catch (err) {
    // D-16: synchronous failure (e.g. EPERM, ENOENT at construct time)
    degradeAndFallback(scope, dir, err);
    return () => {}; // no-op stop function
  }

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

  // D-16 + D-19: async 'error' event triggers degrade-and-fallback.
  // The `degraded` flag inside degradeAndFallback prevents re-entry storm.
  handle.on('error', (err) => {
    degradeAndFallback(scope, dir, err);
  });

  handle.on('error', (err) => {
    log.error('[commands-watcher] chokidar error:', err);
  });

  return () => {
    void handle.close();
  };
}
