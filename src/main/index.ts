import { app, BrowserWindow } from 'electron';
import { registerIpcHandlers } from './ipc-handlers';
import { disconnectAllMcpServers } from './deepagent/mcp-connector';
import { watchSystemCommandsDir, stopAllWatchers } from './commands/chokidar-watcher';
import store from './store';
import log from './logger';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

// ===== Phase 6 Plan 02: chokidar double-watch (D-23) =====
// P6.6: os.homedir() must be ready at call time. The system watcher is started
// inside `app.whenReady`; the project watcher is started lazily on first
// `commands:list` call via `ensureProjectWatcher` (defined in chokidar-watcher
// module to avoid an import cycle with ipc-handlers.ts). Both call sites are
// inside app.whenReady or after, so os.homedir() is ready.

function createWindow() {
  const bounds = store.get('windowBounds') as { width: number; height: number; x?: number; y?: number };

  mainWindow = new BrowserWindow({
    width: bounds.width || 1200,
    height: bounds.height || 800,
    x: bounds.x,
    y: bounds.y,
    minWidth: 800,
    minHeight: 600,
    title: 'CDF',
    titleBarStyle: 'hidden',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
    if (process.env.ELECTRON_RENDERER_URL) {
      mainWindow?.webContents.openDevTools();
    }
    log.info('Main window ready and shown');
  });

  mainWindow.on('close', () => {
    if (mainWindow) {
      const bounds = mainWindow.getBounds();
      store.set('windowBounds', bounds);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile('./out/renderer/index.html');
  }

  log.info('Application starting...');
}

app.whenReady().then(() => {
  log.info('App is ready');
  registerIpcHandlers();

  // Phase 6 Plan 02: start system-scoped chokidar watcher for `~/.cdf/commands/*.md`.
  // P6.6: os.homedir() is now ready since we are inside app.whenReady.
  watchSystemCommandsDir(async () => {
    // chokidar onChange fires commands:changed via the watcher module
  });
  log.info('[commands-watcher] system watcher started: ~/.cdf/commands');

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// ===== Shutdown: clean exit so macOS dock icon disappears =====
// Bug: Right-click dock → Quit would leave the dock icon stuck because
// (a) `before-quit` was async without preventDefault, so Electron didn't
//     wait for MCP disconnects to finish.
// (b) chokidar watcher stop functions were never invoked, leaking fs
//     handles that keep the Node event loop alive.
// Fix: preventDefault → drain async cleanup → app.quit() (synchronous
// re-entry via `isQuitting` flag). Safety net: process.exit(0) after
// 1s in case app.quit() can't drain (e.g. orphaned log handles).
let isQuitting = false;
app.on('before-quit', (event) => {
  if (isQuitting) return; // second pass after our own app.quit() — let it through
  event.preventDefault();
  isQuitting = true;
  log.info('Application quitting, cleaning up...');

  Promise.all([disconnectAllMcpServers(), Promise.resolve(stopAllWatchers())])
    .catch((err) => log.error('[shutdown] cleanup error:', err))
    .finally(() => {
      app.quit();
      // Safety net: if app.quit() can't drain the event loop (e.g. orphan
      // log file descriptors from electron-log), force exit after 1s.
      setTimeout(() => process.exit(0), 1000).unref();
    });
});
