import { app, BrowserWindow } from 'electron';
import { registerIpcHandlers } from './ipc-handlers';
import store from './store';
import log from './logger';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

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
    mainWindow.loadFile('./dist-renderer/index.html');
  }

  log.info('Application starting...');
}

app.whenReady().then(() => {
  log.info('App is ready');
  registerIpcHandlers();
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
