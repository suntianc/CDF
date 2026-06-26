import { BrowserWindow } from 'electron';
import chokidar from 'chokidar';
import log from '../logger';

let watcher: ReturnType<typeof chokidar.watch> | null = null;
let currentRootPath: string | null = null;

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

function broadcast(type: string, filePath: string) {
  BrowserWindow.getAllWindows().forEach((w) => {
    w.webContents.send('fs:directoryChange', { type, path: filePath });
  });
}

export function ensureFileWatcher(rootPath: string): void {
  if (currentRootPath === rootPath && watcher) return;

  stopFileWatcher();

  try {
    watcher = chokidar.watch(rootPath, {
      ignoreInitial: true,
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/out/**',
        '**/.next/**',
        '**/.cache/**',
      ],
      depth: 10,
      usePolling: false,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    });

    const fire = debounce((type: string, filePath: string) => {
      broadcast(type, filePath);
    }, 150);

    watcher.on('add', (p) => fire('add', p));
    watcher.on('change', (p) => fire('change', p));
    watcher.on('unlink', (p) => fire('unlink', p));
    watcher.on('addDir', (p) => fire('addDir', p));
    watcher.on('unlinkDir', (p) => fire('unlinkDir', p));

    watcher.on('error', (err) => {
      log.error('[file-watcher] chokidar error:', err);
    });

    currentRootPath = rootPath;
    log.info(`[file-watcher] started: ${rootPath}`);
  } catch (err) {
    log.error('[file-watcher] failed to start:', err);
    watcher = null;
  }
}

export function stopFileWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
    log.info(`[file-watcher] stopped: ${currentRootPath}`);
  }
  currentRootPath = null;
}
