import { ipcMain, dialog } from 'electron';
import store from './store';
import db from './database';
import { encryptApiKey, decryptApiKey } from './security';
import { runLLMChat, fetchOllamaModels } from './llm';
import fs from 'fs';
import path from 'path';

export function registerIpcHandlers() {
  // electron-store handlers
  ipcMain.handle('store:get', (_, key: string) => store.get(key));
  ipcMain.handle('store:set', (_, key: string, value: unknown) => store.set(key, value));

  // Database handlers: Projects
  ipcMain.handle('db:getProjects', () => {
    const projects = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as any[];
    return projects.map((p) => {
      const isGit = p.path ? fs.existsSync(path.join(p.path, '.git')) : false;
      return { ...p, isGit };
    });
  });

  ipcMain.handle('db:createProject', (_, name: string, projectPath: string) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    db.prepare(
      'INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, name, projectPath, now, now);
    const isGit = projectPath ? fs.existsSync(path.join(projectPath, '.git')) : false;
    return { id, name, path: projectPath, created_at: now, updated_at: now, isGit };
  });

  ipcMain.handle('db:deleteProject', (_, id: string) => {
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  });

  // Database handlers: Sessions
  ipcMain.handle('db:getSessions', (_, projectId: string) => {
    return db
      .prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId);
  });

  ipcMain.handle('db:createSession', (_, projectId: string, name: string, parentSessionId?: string, summary?: string) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    db.prepare(`
      INSERT INTO sessions (id, project_id, name, parent_session_id, summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, name, parentSessionId || null, summary || null, now, now);
    return { id, project_id: projectId, name, parent_session_id: parentSessionId || null, summary: summary || null, created_at: now, updated_at: now };
  });

  ipcMain.handle('db:deleteSession', (_, sessionId: string) => {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  });

  // Database handlers: Messages
  ipcMain.handle('db:getMessages', (_, sessionId: string) => {
    return db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC').all(sessionId);
  });

  ipcMain.handle('db:saveMessage', (_, message: any) => {
    const { id, session_id, role, content, tokens } = message;
    const now = Date.now();
    
    const existing = db.prepare('SELECT id FROM messages WHERE id = ?').get(id);
    if (existing) {
      db.prepare(`
        UPDATE messages SET content = ?, tokens = ? WHERE id = ?
      `).run(content, tokens || null, id);
    } else {
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at, tokens)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, session_id, role, content, now, tokens || null);
    }
    // Update the session's updated_at timestamp
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, session_id);
    return { id, session_id, role, content, created_at: now, tokens };
  });

  // Database handlers: LLM Providers
  ipcMain.handle('db:getProviders', () => {
    const providers = db.prepare('SELECT * FROM llm_providers ORDER BY created_at DESC').all() as any[];
    // Security: mask API key so renderer never sees it
    return providers.map(p => {
      let modelsList = [];
      try {
        modelsList = p.models ? JSON.parse(p.models) : [];
      } catch (err) {
        console.error('Failed to parse models for provider:', p.id, err);
      }
      return {
        ...p,
        hasKey: !!p.api_key,
        api_key: p.api_key ? '••••••••' : '',
        models: modelsList
      };
    });
  });

  ipcMain.handle('db:saveProvider', (_, provider: any) => {
    const { id, name, provider_type, api_key, api_url, default_model, context_limit, is_active, models } = provider;
    const now = Date.now();
    
    const existing = db.prepare('SELECT api_key FROM llm_providers WHERE id = ?').get(id) as any;
    
    let finalApiKey = null;
    if (api_key && api_key !== '••••••••') {
      finalApiKey = encryptApiKey(api_key);
    } else if (api_key === '••••••••' && existing) {
      finalApiKey = existing.api_key; // preserve existing
    }
    
    const modelsStr = models ? JSON.stringify(models) : null;
    
    if (is_active) {
      db.prepare('UPDATE llm_providers SET is_active = 0').run();
    }
    
    if (existing) {
      db.prepare(`
        UPDATE llm_providers 
        SET name = ?, provider_type = ?, api_key = ?, api_url = ?, default_model = ?, context_limit = ?, is_active = ?, models = ?, updated_at = ?
        WHERE id = ?
      `).run(name, provider_type, finalApiKey, api_url, default_model, context_limit, is_active ? 1 : 0, modelsStr, now, id);
    } else {
      db.prepare(`
        INSERT INTO llm_providers (id, name, provider_type, api_key, api_url, default_model, context_limit, is_active, models, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, provider_type, finalApiKey, api_url, default_model, context_limit, is_active ? 1 : 0, modelsStr, now, now);
    }
    
    return { id, name, provider_type, api_url, default_model, context_limit, is_active, models, hasKey: !!finalApiKey };
  });

  ipcMain.handle('db:deleteProvider', (_, id: string) => {
    db.prepare('DELETE FROM llm_providers WHERE id = ?').run(id);
  });

  ipcMain.handle('db:setActiveProvider', (_, id: string) => {
    db.prepare('UPDATE llm_providers SET is_active = 0').run();
    db.prepare('UPDATE llm_providers SET is_active = 1 WHERE id = ?').run(id);
  });

  // LLM Streaming API Call handler
  ipcMain.handle('llm:chat', async (event, requestId: string, payload: any) => {
    const { providerId, model, messages } = payload;
    const provider = db.prepare('SELECT * FROM llm_providers WHERE id = ?').get(providerId) as any;
    if (!provider) {
      throw new Error(`LLM Provider with ID ${providerId} not found.`);
    }

    let decryptedKey = undefined;
    if (provider.api_key) {
      decryptedKey = decryptApiKey(provider.api_key);
    }

    await runLLMChat(event.sender, requestId, {
      messages,
      apiKey: decryptedKey,
      apiUrl: provider.api_url,
      model: model || provider.default_model,
      providerType: provider.provider_type as any
    });
  });

  ipcMain.handle('llm:fetchOllamaModels', async (_, apiUrl: string) => {
    return await fetchOllamaModels(apiUrl);
  });

  ipcMain.handle('db:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
}
