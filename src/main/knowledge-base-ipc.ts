import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { BrowserWindow, ipcMain } from 'electron';
import db from './database';
import {
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  getKnowledgeBaseRoot,
  listKnowledgeEntries,
  readKnowledgeEntry,
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

function resolvePaperPdfPath(projectPath: string, resource: string): string {
  const root = getKnowledgeBaseRoot(projectPath);
  const normalized = resource.split('\\').join('/').trim();
  if (!normalized || path.isAbsolute(normalized)) {
    throw new Error('Paper PDF resource must be a relative path inside the Knowledge Base.');
  }
  if (!normalized.toLowerCase().endsWith('.pdf')) {
    throw new Error('Paper PDF resource must point to a PDF file.');
  }
  if (normalized.split('/').some((part) => part === '..' || part === '' || part.startsWith('.'))) {
    throw new Error('Paper PDF resource must stay inside the Knowledge Base.');
  }

  const target = path.resolve(root, normalized);
  const relativeToRoot = path.relative(root, target);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new Error('Paper PDF resource must stay inside the Knowledge Base.');
  }
  if (!fs.existsSync(target)) {
    throw new Error(`Paper PDF resource not found: ${normalized}`);
  }
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('Paper PDF resource must be a regular file inside the Knowledge Base.');
  }

  return target;
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
    const pdfPath = resolvePaperPdfPath(getProjectPath(projectId), resource);
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
