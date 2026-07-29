import { BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { typedSend } from '../typed-ipc';
import chokidar from 'chokidar';
import log from '../logger';
import type { FlowDiagramDocumentChangeEvent } from '../../shared/flow-diagrams';
import { hashBytes } from '../flow-diagram/flow-diagram-document-store';

const watchers = new Map<string, ReturnType<typeof chokidar.watch>>();
let currentRootPath: string | null = null;

const IGNORED = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/out/**',
  '**/.next/**',
  '**/.cache/**',
];

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingEvents = new Map<string, string>();

export function notifyFlowDiagramDocumentChange(
  event: FlowDiagramDocumentChangeEvent,
): void {
  const windows = typeof BrowserWindow?.getAllWindows === 'function'
    ? BrowserWindow.getAllWindows()
    : [];
  windows.forEach((window) => {
    typedSend(window.webContents, 'flow-diagram:document-change', event);
  });
}

function flushEvents() {
  for (const [filePath, type] of pendingEvents) {
    const windows = typeof BrowserWindow?.getAllWindows === 'function'
      ? BrowserWindow.getAllWindows()
      : [];
    windows.forEach((w) => {
      typedSend(w.webContents, 'fs:directoryChange', { type, path: filePath });
    });
    if (path.extname(filePath).toLowerCase() === '.excalidraw') {
      let version: FlowDiagramDocumentChangeEvent['version'] = null;
      try {
        version = hashBytes(fs.readFileSync(filePath));
      } catch {
        version = null;
      }
      notifyFlowDiagramDocumentChange({ filePath, version });
    }
  }
  pendingEvents.clear();
  debounceTimer = null;
}

function debouncedBroadcast(type: string, filePath: string) {
  pendingEvents.set(filePath, type);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushEvents, 150);
}

/** Notify renderer surfaces after an internal Agent tool changes a Project file. */
export function notifyFileChange(filePath: string, type = 'change'): void {
  debouncedBroadcast(type, filePath);
}

function addWatcher(dirPath: string): void {
  if (watchers.has(dirPath)) return;

  try {
    const w = chokidar.watch(dirPath, {
      ignoreInitial: true,
      ignored: IGNORED,
      depth: 0,
      usePolling: false,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    });

    w.on('add', (p) => debouncedBroadcast('add', p));
    w.on('change', (p) => debouncedBroadcast('change', p));
    w.on('unlink', (p) => debouncedBroadcast('unlink', p));
    w.on('addDir', (p) => debouncedBroadcast('addDir', p));
    w.on('unlinkDir', (p) => debouncedBroadcast('unlinkDir', p));
    w.on('error', (err) => log.error(`[file-watcher] error on ${dirPath}:`, err));

    watchers.set(dirPath, w);
  } catch (err) {
    log.error(`[file-watcher] failed to watch ${dirPath}:`, err);
  }
}

export function ensureFileWatcher(rootPath: string): void {
  if (currentRootPath !== rootPath) {
    stopFileWatcher();
    currentRootPath = rootPath;
  }
  watchDirectory(rootPath);
}

export function watchDirectory(dirPath: string): void {
  addWatcher(dirPath);
}

export function unwatchDirectory(dirPath: string): void {
  const w = watchers.get(dirPath);
  if (w) {
    w.close();
    watchers.delete(dirPath);
  }
}

export function stopFileWatcher(): void {
  for (const [dir, w] of watchers) {
    w.close();
    watchers.delete(dir);
  }
  if (currentRootPath) {
    log.info(`[file-watcher] stopped all watchers for: ${currentRootPath}`);
  }
  currentRootPath = null;
}
