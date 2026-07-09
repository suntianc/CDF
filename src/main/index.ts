import { app, BrowserWindow, protocol, net } from 'electron';
import { registerIpcHandlers } from './ipc-handlers';

// Register cdf-file scheme as privileged to bypass CSP and security sandboxing for local image media
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cdf-file',
    privileges: {
      bypassCSP: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    }
  }
]);
import { disconnectAllMcpServers } from './deepagent/mcp-connector';
import { watchSystemCommandsDir, stopAllWatchers } from './commands/chokidar-watcher';
import { stopFileWatcher } from './services/file-watcher';
import { configureNetworkProxy } from './network-proxy';
import store from './store';
import log from './logger';
import path from 'path';
import fs from 'node:fs';

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
  
  // Register cdf-file protocol handler to safely resolve absolute local paths to file URLs
  protocol.handle('cdf-file', async (request) => {
    try {
      const urlPath = decodeURIComponent(request.url.slice('cdf-file://'.length));
      let filePath = urlPath;
      if (process.platform === 'win32' && filePath.startsWith('/')) {
        filePath = filePath.slice(1);
      }
      const data = await fs.promises.readFile(filePath);
      return new Response(data);
    } catch (error) {
      log.error('[cdf-file] Failed to read local file:', error);
      return new Response('File not found', { status: 404 });
    }
  });

  configureNetworkProxy();
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
let isQuitting = false;
app.on('before-quit', (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  log.info('Application quitting, cleaning up...');

  const forceExit = setTimeout(() => {
    log.warn('[shutdown] cleanup timed out, forcing exit');
    process.exit(0);
  }, 1500);
  forceExit.unref();

  stopFileWatcher();
  stopAllWatchers();

  const mcpTimeout = new Promise<void>((r) => setTimeout(r, 800));
  Promise.race([disconnectAllMcpServers(), mcpTimeout])
    .catch((err) => log.error('[shutdown] MCP cleanup error:', err))
    .finally(() => {
      app.quit();
    });
});
