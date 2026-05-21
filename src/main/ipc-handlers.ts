import { ipcMain, dialog } from 'electron';
import store from './store';
import db from './database';

export function registerIpcHandlers() {
  // electron-store handlers
  ipcMain.handle('store:get', (_, key: string) => store.get(key));
  ipcMain.handle('store:set', (_, key: string, value: unknown) => store.set(key, value));

  // Database handlers
  ipcMain.handle('db:getProjects', () => {
    return db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
  });

  ipcMain.handle('db:createProject', (_, name: string, projectPath: string) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    db.prepare(
      'INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, name, projectPath, now, now);
    return { id, name, path: projectPath, created_at: now, updated_at: now };
  });

  ipcMain.handle('db:deleteProject', (_, id: string) => {
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  });

  ipcMain.handle('db:getSessions', (_, projectId: string) => {
    return db
      .prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId);
  });

  ipcMain.handle('db:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
}
