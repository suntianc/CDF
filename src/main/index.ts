import { app, BrowserWindow, protocol } from 'electron';
import db from './database';
import {
  CDF_FILE_SCHEME,
  cdfFileSchemePrivileges,
  createCdfFileResponse,
} from './cdf-file-protocol';
import { registerIpcHandlers } from './ipc-handlers';
import {
  backgroundCapabilityContinuations,
  backgroundCapabilityJobs,
  configureCapabilityJobContinuationRunner,
  startBackgroundCapabilityJobMaintenance,
} from './capabilities/background-capability-runtime';
import { runLLMChat, setConversationIdleListener } from './llm';
import { conversationRunStreams } from './conversation-run-stream-runtime';
import { createCapabilityJobContinuationRunner } from './capabilities/capability-job-continuation-runner';
import { conversationWorkingStateLifecycle } from './deepagent/conversation-working-state';
import { ConversationWorkingStateWorkerRunner } from './deepagent/conversation-working-state-worker-runner';

// Register cdf-file scheme as privileged to bypass CSP and security sandboxing for local image media.
// standard:true additionally enables Chromium's media seeking/range machinery (see cdf-file-protocol.ts).
protocol.registerSchemesAsPrivileged([
  {
    scheme: CDF_FILE_SCHEME,
    privileges: { ...cdfFileSchemePrivileges },
  }
]);
import { disconnectAllMcpServers } from './deepagent/mcp-connector';
import { watchSystemCommandsDir, stopAllWatchers } from './commands/chokidar-watcher';
import { stopFileWatcher } from './services/file-watcher';
import { configureNetworkProxy } from './network-proxy';
import store from './store';
import log from './logger';
import path from 'path';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

const workingStateReconciliationRunner = new ConversationWorkingStateWorkerRunner(
  () => path.join(__dirname, 'conversation-working-state-reconciliation-worker.js')
);

function reconcileConversationWorkingStateAtStartup() {
  return conversationWorkingStateLifecycle.reconcileOrphansAtStartup(
    () => (db.prepare('SELECT id FROM sessions').all() as Array<{ id: string }>)
      .map((session) => session.id),
    workingStateReconciliationRunner
  );
}

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
configureCapabilityJobContinuationRunner(createCapabilityJobContinuationRunner({
  db,
  streams: conversationRunStreams,
  runChat: runLLMChat,
  onMessagesChanged: (sessionId) => {
    for (const window of BrowserWindow.getAllWindows()) {
      try {
        window.webContents.send('conversation:messages-changed', { sessionId });
      } catch {
        // A closing renderer must not turn a durable continuation into a retry.
      }
    }
  },
}));
setConversationIdleListener((sessionId) => {
  backgroundCapabilityContinuations.notifyConversationIdle(sessionId);
});


app.whenReady().then(() => {
  log.info('App is ready');
  
  // Register cdf-file protocol handler. Serves local files with HTTP Range support so that
  // <audio>/<video> media is seekable (required for replay and for moov-at-end mp4s).
  protocol.handle(CDF_FILE_SCHEME, async (request) => {
    try {
      return await createCdfFileResponse({
        url: request.url,
        rangeHeader: request.headers.get('Range'),
      });
    } catch (error) {
      log.error('[cdf-file] Failed to serve local file:', error);
      return new Response('File not found', { status: 404 });
    }
  });

  configureNetworkProxy();
  registerIpcHandlers();
  const workingStateReconciliation = reconcileConversationWorkingStateAtStartup();

  // Phase 6 Plan 02: start system-scoped chokidar watcher for `~/.cdf/commands/*.md`.
  // P6.6: os.homedir() is now ready since we are inside app.whenReady.
  watchSystemCommandsDir(async () => {
    // chokidar onChange fires commands:changed via the watcher module
  });
  log.info('[commands-watcher] system watcher started: ~/.cdf/commands');

  createWindow();

  void workingStateReconciliation.then((outcome) => {
    if (isQuitting) return;
    if (outcome.ok) {
      log.info(`[working-state] Startup reconciliation removed ${outcome.deletedThreadCount} orphan thread(s).`);
    } else {
      log.error('[working-state] Startup reconciliation failed:', outcome.error);
    }
    backgroundCapabilityJobs.resumePending();
    backgroundCapabilityContinuations.resumePending();
    startBackgroundCapabilityJobMaintenance();
  });
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
