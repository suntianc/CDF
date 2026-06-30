import { ipcMain } from 'electron';
import db from './database';
import {
  listKnowledgeEntries,
  searchKnowledgeEntries,
} from './knowledge-base';
import type { KnowledgeEntrySearchOptions } from '../shared/types';

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
}
