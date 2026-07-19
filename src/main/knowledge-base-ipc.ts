import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { BrowserWindow } from 'electron';
import db from './database';
import { typedHandle } from './typed-ipc';
import {
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  listKnowledgeEntries,
  readKnowledgeEntry,
  resolvePaperPdfResourcePath,
  searchKnowledgeEntries,
  updateKnowledgeEntry,
} from './knowledge-base';
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
  typedHandle('knowledge:list', async (_event, projectId, options) => {
    return listKnowledgeEntries(getProjectPath(projectId), options);
  });

  typedHandle('knowledge:search', async (_event, projectId, options = {}) => {
    return searchKnowledgeEntries(getProjectPath(projectId), options);
  });

  typedHandle('knowledge:create', async (_event, projectId, input) => {
    return createKnowledgeEntry(getProjectPath(projectId), input);
  });

  typedHandle('knowledge:read', async (_event, projectId, relativePath) => {
    return readKnowledgeEntry(getProjectPath(projectId), relativePath);
  });

  typedHandle('knowledge:update', async (_event, projectId, relativePath, input) => {
    return updateKnowledgeEntry(getProjectPath(projectId), relativePath, input);
  });

  typedHandle('knowledge:delete', async (_event, projectId, relativePath) => {
    return deleteKnowledgeEntry(getProjectPath(projectId), relativePath);
  });

  typedHandle('paper-library:openPdf', async (_event, projectId, resource) => {
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
