import { ipcMain, dialog, app } from 'electron';
import store from './store';
import db from './database';
import { encryptApiKey, decryptApiKey } from './security';
import { runLLMChat, fetchOllamaModels, stopLLMChat, resolveLLMApproval } from './llm';
import {
  buildAnthropicModelsUrl,
  buildOpenAIModelsUrl,
  isAnthropicCompatibleApiUrl,
  normalizeProviderApiUrl,
  shouldUseAnthropicAuthToken,
} from '../shared/provider-url';
import fs from 'fs';
import path from 'path';
import {
  listPhysicalSkills,
  savePhysicalSkill,
  deletePhysicalSkill,
} from './deepagent/skill-manager';
import { checkMcpServerHealth, disconnectMcpServer } from './deepagent/mcp-connector';
import { MCPServer } from '../shared/types';

const getProviderLabel = (type: string): string => {
  switch (type) {
    case 'openai': return 'OpenAI';
    case 'anthropic': return 'Anthropic';
    case 'deepseek': return 'DeepSeek';
    case 'zhipu': return 'GLM CN';
    case 'glm-overseas': return 'GLM EN';
    case 'minimax': return 'Minimax CN';
    case 'minimax-overseas': return 'Minimax EN';
    case 'moonshot': return 'Kimi';
    case 'qwen': return 'Qwen';
    case 'xiaomimimo': return 'Xiaomi MiMo';
    case 'ollama': return 'Ollama';
    case 'custom': return 'OpenAI Compatible';
    default: return 'OpenAI Compatible';
  }
};

export function registerIpcHandlers() {
  const ensureProjectForSession = (projectId: string) => {
    const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (existing) return;
    if (projectId !== 'default-project') {
      throw new Error(`Project with ID ${projectId} not found.`);
    }

    const defaultProjectPath = path.join(app.getPath('userData'), 'default-project');
    const now = Date.now();
    if (!fs.existsSync(defaultProjectPath)) {
      fs.mkdirSync(defaultProjectPath, { recursive: true });
    }
    db.prepare(`
      INSERT INTO projects (id, name, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('default-project', '默认项目', defaultProjectPath, now, now);
  };

  const ensureDefaultAgentForSession = (projectId: string): string | null => {
    const existing = db
      .prepare('SELECT id FROM agents WHERE project_id = ? AND is_default = 1 ORDER BY updated_at DESC LIMIT 1')
      .get(projectId) as { id: string } | undefined;
    if (existing) return existing.id;

    const provider = db
      .prepare('SELECT id FROM llm_providers WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1')
      .get() as { id: string } | undefined;
    const fallbackProvider = provider || (db.prepare('SELECT id FROM llm_providers ORDER BY updated_at DESC LIMIT 1').get() as { id: string } | undefined);
    const now = Date.now();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO agents (id, project_id, name, description, provider_id, system_prompt, config, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      'Master Agent',
      '项目默认 Agent',
      fallbackProvider?.id || null,
      '你是该项目的默认 Master Agent，负责综合使用 Skills、MCP 工具和项目上下文帮助用户完成开发任务。',
      null,
      1,
      now,
      now
    );

    return id;
  };

  const buildProviderHeaders = (providerType: string, apiUrl: string | undefined, decryptedKey?: string) => {
    const headers: Record<string, string> = {};
    const trimmedKey = decryptedKey?.trim();

    if (providerType === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01';
      if (trimmedKey) {
        if (shouldUseAnthropicAuthToken(apiUrl, trimmedKey)) {
          headers['authorization'] = `Bearer ${trimmedKey}`;
        } else {
          headers['x-api-key'] = trimmedKey;
        }
      }
      return headers;
    }

    if (trimmedKey) {
      headers['authorization'] = `Bearer ${trimmedKey}`;
    }
    return headers;
  };

  const getProviderWithKey = (providerId: string) => {
    const provider = db.prepare('SELECT * FROM llm_providers WHERE id = ?').get(providerId) as any;
    if (!provider) {
      throw new Error(`LLM Provider with ID ${providerId} not found.`);
    }
    const decryptedKey = provider.api_key ? decryptApiKey(provider.api_key) : undefined;
    return { provider, decryptedKey };
  };

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

  ipcMain.handle('db:renameProject', (_, id: string, name: string) => {
    const now = Date.now();
    db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id);
    return { id, name, updated_at: now };
  });

  // Database handlers: Sessions
  ipcMain.handle('db:getSessions', (_, projectId: string) => {
    return db
      .prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId);
  });

  ipcMain.handle('db:createSession', (_, projectId: string, name: string, parentSessionId?: string, summary?: string, agentId?: string) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    ensureProjectForSession(projectId);
    // 主聊天入口始终绑定项目默认 Master Agent；其它 Agent 作为 Master Agent 可调用资产。
    const finalAgentId = ensureDefaultAgentForSession(projectId) || agentId || null;
    db.prepare(`
      INSERT INTO sessions (id, project_id, name, agent_id, parent_session_id, summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, name, finalAgentId, parentSessionId || null, summary || null, now, now);
    return { id, project_id: projectId, name, agent_id: finalAgentId, parent_session_id: parentSessionId || null, summary: summary || null, created_at: now, updated_at: now };
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

  ipcMain.handle('db:deleteMessage', (_, id: string) => {
    db.prepare('DELETE FROM messages WHERE id = ?').run(id);
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
    let { id, name, provider_type, api_key, api_url, default_model, context_limit, is_active, models } = provider;
    
    // Force standard name for non-custom providers
    if (provider_type !== 'custom') {
      name = getProviderLabel(provider_type);
    }

    const now = Date.now();
    const normalizedApiUrl = normalizeProviderApiUrl(api_url);
    
    const existing = db.prepare('SELECT api_key FROM llm_providers WHERE id = ?').get(id) as any;
    
    let finalApiKey = null;
    if (api_key && api_key !== '••••••••') {
      finalApiKey = encryptApiKey(api_key);
    } else if (existing) {
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
      `).run(name, provider_type, finalApiKey, normalizedApiUrl, default_model, context_limit, is_active ? 1 : 0, modelsStr, now, id);
    } else {
      db.prepare(`
        INSERT INTO llm_providers (id, name, provider_type, api_key, api_url, default_model, context_limit, is_active, models, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, provider_type, finalApiKey, normalizedApiUrl, default_model, context_limit, is_active ? 1 : 0, modelsStr, now, now);
    }
    
    return { id, name, provider_type, api_url: normalizedApiUrl, default_model, context_limit, is_active, models, hasKey: !!finalApiKey };
  });

  ipcMain.handle('db:deleteProvider', (_, id: string) => {
    db.prepare('DELETE FROM llm_providers WHERE id = ?').run(id);
  });

  ipcMain.handle('db:setActiveProvider', (_, id: string) => {
    db.prepare('UPDATE llm_providers SET is_active = 0').run();
    db.prepare('UPDATE llm_providers SET is_active = 1 WHERE id = ?').run(id);
  });

  // LLM Streaming API Call handler (deepagents-driven)
  ipcMain.handle('llm:chat', (event, requestId: string, payload: any) => {
    void runLLMChat(event.sender, requestId, payload).catch((error) => {
      console.error('LLM chat task failed:', error);
    });
    return { ok: true };
  });

  ipcMain.handle('llm:stopChat', async (_, requestId: string) => {
    stopLLMChat(requestId);
  });

  ipcMain.handle('llm:resolveApproval', async (_, requestId: string, resolution: any) => {
    resolveLLMApproval(requestId, resolution);
  });

  ipcMain.handle('llm:testProvider', async (_, providerId: string) => {
    const { provider, decryptedKey } = getProviderWithKey(providerId);

    if (provider.provider_type === 'ollama') {
      const models = await fetchOllamaModels(provider.api_url || 'http://localhost:11434');
      return { ok: true, message: `检测到 ${models.length} 个本地模型` };
    }

    const useAnthropicUrl = provider.provider_type === 'anthropic' ||
      (provider.provider_type === 'deepseek' || provider.provider_type === 'minimax' || provider.provider_type === 'minimax-overseas') &&
      isAnthropicCompatibleApiUrl(provider.api_url);

    const url = useAnthropicUrl
      ? buildAnthropicModelsUrl(provider.api_url)
      : buildOpenAIModelsUrl(provider.api_url);

    const headers = buildProviderHeaders(provider.provider_type, provider.api_url, decryptedKey);

    const response = await fetch(url, { headers });
    if (response.status === 200) {
      const data = await response.json();
      return { ok: true, message: `连接成功，检测到 ${Array.isArray(data?.data) ? data.data.length : 0} 个模型` };
    }
    if (response.status === 401) {
      return { ok: false, message: 'API Key 无效或未授权，请重新填写。' };
    }
    const text = await response.text();
    return { ok: false, message: `HTTP ${response.status}: ${text.slice(0, 120)}` };
  });

  ipcMain.handle('llm:fetchProviderModels', async (_, providerId: string) => {
    const { provider, decryptedKey } = getProviderWithKey(providerId);

    if (provider.provider_type === 'ollama') {
      return await fetchOllamaModels(provider.api_url || 'http://localhost:11434');
    }

    const useAnthropicUrl = provider.provider_type === 'anthropic' ||
      (provider.provider_type === 'deepseek' || provider.provider_type === 'minimax' || provider.provider_type === 'minimax-overseas') &&
      isAnthropicCompatibleApiUrl(provider.api_url);

    const url = useAnthropicUrl
      ? buildAnthropicModelsUrl(provider.api_url)
      : buildOpenAIModelsUrl(provider.api_url);

    const headers = buildProviderHeaders(provider.provider_type, provider.api_url, decryptedKey);

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(response.status === 401 ? 'API Key 无效或未授权，请重新填写。' : `HTTP ${response.status}: ${text.slice(0, 120)}`);
    }

    const data = await response.json();
    return Array.isArray(data?.data) ? data.data.map((item: any) => item.id).filter(Boolean) : [];
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

  ipcMain.handle('db:selectFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Scripts', extensions: ['sh', 'py', 'js', 'txt', 'bash'] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const name = path.basename(filePath, path.extname(filePath));
    const ext = path.extname(filePath).toLowerCase();
    let script_type = 'bash';
    if (ext === '.py') script_type = 'python';
    else if (ext === '.js') script_type = 'javascript';
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { name, script_type: script_type as any, content };
    } catch (e) {
      console.error('Failed to read selected file:', e);
      return null;
    }
  });

  // ===== Phase 3: Agent Library IPC Handlers =====

  ipcMain.handle('db:getAgents', (_, projectId: string) => {
    const agents = db.prepare('SELECT * FROM agents WHERE project_id = ? ORDER BY is_default DESC, updated_at DESC').all(projectId) as any[];
    return agents.map(a => {
      const mcpServers = db.prepare('SELECT mcp_server_id FROM agent_mcp_servers WHERE agent_id = ?').all(a.id) as any[];
      const skills = db.prepare('SELECT skill_name FROM agent_skills WHERE agent_id = ?').all(a.id) as any[];
      return {
        ...a,
        config: a.config ? JSON.parse(a.config) : null,
        mcpServerIds: mcpServers.map(s => s.mcp_server_id),
        skillNames: skills.map(s => s.skill_name),
      };
    });
  });

  ipcMain.handle('db:saveAgent', (_, agent: any) => {
    const { id, project_id, name, description, provider_id, system_prompt, config, is_default, mcpServerIds, skillNames } = agent;
    const ENGLISH_NAME_REGEX = /^[A-Za-z0-9\s\-_]+$/;
    if (!name || typeof name !== 'string' || !ENGLISH_NAME_REGEX.test(name.trim())) {
      throw new Error('Agent name must contain only English characters, numbers, spaces, hyphens, or underscores.');
    }
    const now = Date.now();
    const configStr = config ? JSON.stringify(config) : null;

    const runTx = db.transaction(() => {
      if (is_default) {
        db.prepare('UPDATE agents SET is_default = 0, updated_at = ? WHERE project_id = ?').run(now, project_id);
      }
      const existing = db.prepare('SELECT id FROM agents WHERE id = ?').get(id);
      if (existing) {
        db.prepare(`
          UPDATE agents SET project_id = ?, name = ?, description = ?, provider_id = ?, system_prompt = ?, config = ?, is_default = ?, updated_at = ?
          WHERE id = ?
        `).run(project_id, name, description || null, provider_id || null, system_prompt || null, configStr, is_default ? 1 : 0, now, id);
      } else {
        db.prepare(`
          INSERT INTO agents (id, project_id, name, description, provider_id, system_prompt, config, is_default, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, project_id, name, description || null, provider_id || null, system_prompt || null, configStr, is_default ? 1 : 0, now, now);
      }

      db.prepare('DELETE FROM agent_mcp_servers WHERE agent_id = ?').run(id);
      if (Array.isArray(mcpServerIds)) {
        const insertMcp = db.prepare('INSERT INTO agent_mcp_servers (agent_id, mcp_server_id) VALUES (?, ?)');
        for (const mcpId of mcpServerIds) {
          insertMcp.run(id, mcpId);
        }
      }

      db.prepare('DELETE FROM agent_skills WHERE agent_id = ?').run(id);
      if (Array.isArray(skillNames)) {
        const insertSkill = db.prepare('INSERT INTO agent_skills (agent_id, skill_name) VALUES (?, ?)');
        for (const skillName of skillNames) {
          insertSkill.run(id, skillName);
        }
      }
    });

    runTx();

    return { 
      id, 
      project_id,
      name, 
      description, 
      provider_id, 
      system_prompt, 
      config,
      is_default: is_default ? 1 : 0,
      mcpServerIds: mcpServerIds || [],
      skillNames: skillNames || []
    };
  });

  ipcMain.handle('db:deleteAgent', (_, id: string) => {
    db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  });

  // ===== Phase 3 & Phase 4: Skills Physical IPC Handlers =====

  ipcMain.handle('db:getSkills', (_, projectId: string) => {
    const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as { path: string } | undefined;
    if (!project) {
      return [];
    }
    return listPhysicalSkills(project.path);
  });

  ipcMain.handle('db:saveSkill', (_, projectId: string, skill: any) => {
    const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as { path: string } | undefined;
    if (!project) {
      throw new Error('Project not found');
    }

    const scope = skill.scope === 'global' ? 'global' : 'project';
    return savePhysicalSkill(project.path, scope, skill);
  });

  ipcMain.handle('db:deleteSkill', (_, projectId: string, id: string) => {
    const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as { path: string } | undefined;
    if (!project) {
      throw new Error('Project not found');
    }

    const scopePrefix: 'project' | 'global' = id.includes(':') ? (id.split(':', 2)[0] as 'project' | 'global') : 'project';
    const skillName = id.includes(':') ? id.split(':', 2)[1] : id;
    deletePhysicalSkill(project.path, scopePrefix, skillName);
  });

  ipcMain.handle('db:getSkillVersions', () => {
    // 物理文件系统下不另行留存数据库版本表，返回空数组保持向前兼容
    return [];
  });

  ipcMain.handle('db:getAgentRuns', (_, sessionId: string) => {
    return db.prepare('SELECT * FROM agent_runs WHERE session_id = ? ORDER BY started_at DESC LIMIT 20').all(sessionId);
  });

  ipcMain.handle('db:getAgentToolCalls', (_, runId: string) => {
    return db.prepare('SELECT * FROM agent_tool_calls WHERE run_id = ? ORDER BY started_at ASC').all(runId);
  });

  // ===== Phase 3: MCP Server IPC Handlers =====

  ipcMain.handle('db:getMcpServers', () => {
    const servers = db.prepare('SELECT * FROM mcp_servers ORDER BY updated_at DESC').all() as any[];
    return servers.map(s => ({
      ...s,
      config: s.config ? JSON.parse(s.config) : null,
      is_connected: !!s.is_connected,
    }));
  });

  ipcMain.handle('db:saveMcpServer', (_, server: any) => {
    const { id, name, server_type, config } = server;
    const now = Date.now();
    const configStr = config ? JSON.stringify(config) : null;

    const existing = db.prepare('SELECT id FROM mcp_servers WHERE id = ?').get(id);
    if (existing) {
      db.prepare(`
        UPDATE mcp_servers SET name = ?, server_type = ?, config = ?, updated_at = ?
        WHERE id = ?
      `).run(name, server_type, configStr, now, id);
    } else {
      db.prepare(`
        INSERT INTO mcp_servers (id, name, server_type, config, is_connected, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `).run(id, name, server_type, configStr, now, now);
    }
    return { id, name, server_type, config, is_connected: false };
  });

  ipcMain.handle('db:deleteMcpServer', (_, id: string) => {
    db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
  });

  ipcMain.handle('db:toggleMcpConnection', async (_, id: string, connected: boolean) => {
    db.prepare('UPDATE mcp_servers SET is_connected = ?, updated_at = ? WHERE id = ?').run(connected ? 1 : 0, Date.now(), id);
    // 断开时清理实际连接
    if (!connected) {
      await disconnectMcpServer(id);
    }
  });

  // ===== Phase 4: Tool Configs IPC Handlers =====

  ipcMain.handle('db:getToolConfigs', () => {
    const configs = db.prepare('SELECT * FROM tool_configs ORDER BY updated_at DESC').all() as any[];
    return configs.map(c => ({
      ...c,
      config: c.config ? JSON.parse(c.config) : null,
      is_enabled: !!c.is_enabled,
      is_default: !!c.is_default,
      hasKey: !!c.api_key,
      api_key: c.api_key ? '••••••••' : '',
    }));
  });

  ipcMain.handle('db:saveToolConfig', (_, config: any) => {
    const { id, tool_type, name, api_key, config: configData, is_enabled, is_default } = config;
    const now = Date.now();

    let finalApiKey: string | null = null;
    const existing = db.prepare('SELECT api_key FROM tool_configs WHERE id = ?').get(id) as any;
    if (api_key && api_key !== '••••••••') {
      finalApiKey = encryptApiKey(api_key);
    } else if (existing) {
      finalApiKey = existing.api_key;
    }

    const configStr = configData ? JSON.stringify(configData) : null;

    if (is_default) {
      db.prepare('UPDATE tool_configs SET is_default = 0 WHERE tool_type = ?').run(tool_type);
    }

    if (existing) {
      db.prepare(`
        UPDATE tool_configs SET tool_type = ?, name = ?, api_key = ?, config = ?, is_enabled = ?, is_default = ?, updated_at = ?
        WHERE id = ?
      `).run(tool_type, name, finalApiKey, configStr, is_enabled ? 1 : 0, is_default ? 1 : 0, now, id);
    } else {
      db.prepare(`
        INSERT INTO tool_configs (id, tool_type, name, api_key, config, is_enabled, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, tool_type, name, finalApiKey, configStr, is_enabled ? 1 : 0, is_default ? 1 : 0, now, now);
    }

    return {
      id, tool_type, name, config: configData, is_enabled: !!is_enabled, is_default: !!is_default, hasKey: !!finalApiKey
    };
  });

  ipcMain.handle('db:deleteToolConfig', (_, id: string) => {
    db.prepare('DELETE FROM tool_configs WHERE id = ?').run(id);
  });

  ipcMain.handle('db:checkMcpHealth', async (_, id: string) => {
    const server = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as any;
    if (!server) {
      return { ok: false, message: 'MCP server not found' };
    }

    const mcpServer: MCPServer = {
      ...server,
      config: server.config ? JSON.parse(server.config) : {},
      is_connected: !!server.is_connected,
    };

    const result = await checkMcpServerHealth(mcpServer);
    db.prepare('UPDATE mcp_servers SET last_health_check = ?, is_connected = ? WHERE id = ?')
      .run(Date.now(), result.ok ? 1 : 0, id);
    return result;
  });

  // ===== Phase 3 & Phase 4: deepagents Runtime IPC Handlers =====

  // Store for deepagent instances (managed per session)
  const agentInstances = new Map<string, any>();

  ipcMain.handle('deepagents:createAgent', async (_, config: { providerId: string; model: string; systemPrompt?: string; tools?: string[] }) => {
    const agentId = crypto.randomUUID();
    agentInstances.set(agentId, { config });
    return { agentId };
  });
}
