import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { BrowserWindow, ipcMain } from 'electron';
import db from './database';
import {
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  listKnowledgeEntries,
  readKnowledgeEntry,
  resolvePaperPdfResourcePath,
  searchKnowledgeEntries,
  updateKnowledgeEntry,
} from './knowledge-base';
import type {
  KnowledgeEntryCreateInput,
  KnowledgeEntrySearchOptions,
  KnowledgeEntryUpdateInput,
} from '../shared/types';

function getProjectPath(projectId: string): string {
  const project = db
    .prepare('SELECT path FROM projects WHERE id = ?')
    .get(projectId) as { path: string } | undefined;
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  return project.path;
}

export function registerKnowledgeBaseHandlers(): void {
  ipcMain.handle('knowledge:list', async (_event, projectId: string, options?: KnowledgeEntrySearchOptions) => {
    return listKnowledgeEntries(getProjectPath(projectId), options);
  });

  ipcMain.handle('knowledge:search', async (_event, projectId: string, options: KnowledgeEntrySearchOptions = {}) => {
    return searchKnowledgeEntries(getProjectPath(projectId), options);
  });

  ipcMain.handle('knowledge:create', async (_event, projectId: string, input: KnowledgeEntryCreateInput) => {
    return createKnowledgeEntry(getProjectPath(projectId), input);
  });

  ipcMain.handle('knowledge:read', async (_event, projectId: string, relativePath: string) => {
    return readKnowledgeEntry(getProjectPath(projectId), relativePath);
  });

  ipcMain.handle('knowledge:update', async (_event, projectId: string, relativePath: string, input: KnowledgeEntryUpdateInput) => {
    return updateKnowledgeEntry(getProjectPath(projectId), relativePath, input);
  });

  ipcMain.handle('knowledge:delete', async (_event, projectId: string, relativePath: string) => {
    return deleteKnowledgeEntry(getProjectPath(projectId), relativePath);
  });

  ipcMain.handle('paper-library:openPdf', async (_event, projectId: string, resource: string) => {
    const pdfPath = resolvePaperPdfResourcePath(getProjectPath(projectId), resource);
    const window = new BrowserWindow({
      width: 960,
      height: 720,
      title: path.basename(pdfPath),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        plugins: true,
        sandbox: true,
      },
    });
    await window.loadURL(pathToFileURL(pdfPath).toString());
    return { success: true };
  });
}
