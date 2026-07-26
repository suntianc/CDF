import { ipcMain, dialog, app, shell } from 'electron';
import { typedHandle } from './typed-ipc';
import { typedCrud } from './typed-crud';
import { llmChunkChannel } from '../shared/ipc-contract';
import { conversationAssistantSegmentMessageId } from '../shared/conversations';
import log from './logger';
import store from './store';
import db from './database';
import { encryptApiKey, decryptApiKey } from './security';
import { runLLMChat, runLLMJudge, fetchOllamaModels, stopLLMChat, resolveLLMApproval } from './llm';
import {
  buildAnthropicModelsUrl,
  buildOpenAIModelsUrl,
  isAnthropicCompatibleApiUrl,
  normalizeProviderApiUrl,
  shouldUseAnthropicAuthToken,
} from '../shared/provider-url';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readDirectory, readFile, getFileInfo, writeFile, createFile, createDirectory, renameEntry, trashEntry, resolveProjectFile } from './services/file-system';
import { ensureFileWatcher, notifyFileChange, watchDirectory, unwatchDirectory } from './services/file-watcher';
import {
  listPhysicalSkills,
  listResolvedSkillViews,
  listGlobalSkillViews,
  savePhysicalSkill,
  deletePhysicalSkill,
  importPhysicalSkillDirectory,
  getBuiltInSkillRegistrations,
} from './deepagent/skill-manager';
import type { GlobalSkillReference, SceneSkillExposureInput } from '../shared/skills';
import { isRegisteredSceneId, SCENE_REGISTRY } from '../shared/scenes';
import { createSceneSkillExposureService } from './scene-skill-exposure';
import { createGlobalSkillSceneExposureFilter } from './global-skill-scene-exposure';
import { normalizeWorkflowStages, validateWorkflowStages } from '../shared/workflow-routing';
import { checkMcpServerHealth, disconnectMcpServer } from './deepagent/mcp-connector';
import type {
  AgentRun,
  AgentToolCall,
  LLMProvider,
  LLMStreamEvent,
  MCPServer,
  PaperSearchConfigKey,
  PaperSearchConfigSettings,
  ProjectScene,
  Session,
  Skill,
} from '../shared/types';
import { registerWorkflowRunIpcHandlers } from './workflow-run';
import { collectAllCommands } from './commands/command-registry';
import { listProjectCommands } from './commands/project-commands';
import { ensureProjectWatcher } from './commands/chokidar-watcher';
import { aggregateCurrentSessionContext } from './deepagent/context-aggregator';
import { registerAtMentionHandlers } from './at-mention/at-mention-handler';
import { registerKnowledgeBaseHandlers } from './knowledge-base-ipc';
import {
  cancelAISubscriptionLogin,
  connectAISubscriptionWithKey,
  disconnectAISubscription,
  getActiveAISubscriptionLoginDescriptors,
  getAISubscriptionCapabilityRoutes,
  getAISubscriptionEntries,
  pollAISubscriptionLogin,
  refreshAISubscriptionStatus,
  saveAISubscriptionCapabilityState,
  startAISubscriptionLogin,
} from './ai-subscription-store';
import {
  getPaperSearchConfigSettings,
  setPaperSearchConfigValue,
  unsetPaperSearchConfigValue,
} from './paper-search-config';
import { initializeScenePreset } from './scene-presets';
import {
  captureConversationSystemContextSnapshot,
  getOrCaptureConversationSystemContextSnapshot,
} from './conversation-system-context-snapshot';
import type {
  AISubscriptionEntryId,
  CapabilityId,
} from '../shared/ai-subscriptions';
import { backgroundCapabilityJobs } from './capabilities/background-capability-runtime';
import { conversationRunStreams } from './conversation-run-stream-runtime';
import { deleteConversation, deleteProject } from './conversation-deletion';
import { conversationWorkingStateLifecycle } from './deepagent/conversation-working-state';
import { registerFlowDiagramExportResponseHandler } from './flow-diagram/flow-diagram-export-adapter';
import {
  compactConversationWorkingState,
  getConversationWorkingStateStorageStatus,
} from './deepagent/conversation-working-state-maintenance';
import { DelegatedAgentRunRepository } from './deepagent/delegated-agent-run-repository';
import { createAgentCatalog, type CatalogAgent } from './agent-catalog';

function resolveSceneSkillExposureInput(skill: GlobalSkillReference): SceneSkillExposureInput {
  if (!skill || (skill.sourceKind !== 'built-in' && skill.sourceKind !== 'user')
    || typeof skill.name !== 'string' || !skill.name.trim()) {
    throw new Error('Invalid Global Skill reference');
  }

  if (skill.sourceKind === 'user') return { sourceKind: 'user', name: skill.name };

  const registration = getBuiltInSkillRegistrations().find(({ name }) => name === skill.name);
  if (!registration) {
    throw new Error(`Unknown Built-in Skill: ${skill.name}`);
  }
  return {
    sourceKind: 'built-in',
    name: registration.name,
    defaultSceneIds: registration.defaultSceneIds,
  };
}

function collectAssistantSegments(
  requestId: string,
  events: readonly LLMStreamEvent[],
): Array<{ id: string; content: string }> {
  const segments: Array<{ id: string; content: string }> = [];
  let segmentIndex = 0;
  let content = '';

  const flush = () => {
    if (!content.trim()) return;
    segments.push({
      id: conversationAssistantSegmentMessageId(requestId, segmentIndex),
      content,
    });
  };

  for (const event of events) {
    if (event.type === 'message_chunk') {
      content += event.text;
      continue;
    }
    if (event.type === 'tool_start') {
      flush();
      content = '';
      segmentIndex += 1;
    }
  }
  flush();
  return segments;
}

function stripMarkdownFrontmatter(content: string): string {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---', 4);
  if (end === -1) return content;
  const bodyStart = end + '\n---'.length;
  return content.slice(content[bodyStart] === '\n' ? bodyStart + 1 : bodyStart);
}

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

const normalizeProjectScene = (scene: unknown): ProjectScene => (
  isRegisteredSceneId(scene) ? scene : 'general'
);

function normalizeExternalHttpUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('External URL must be a string');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('External URL is invalid');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('External URL must use http or https');
  }

  return parsed.toString();
}

const RENDERER_STORE_KEYS = new Set([
  'theme',
  'currentProjectId',
  'sidebarWidth',
  'sidebarCollapsed',
  'windowBounds',
  'language',
  'approvalMode',
  'autoSave',
]);

function assertRendererStoreKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || !RENDERER_STORE_KEYS.has(key)) {
    throw new Error('Store key is not renderer-accessible');
  }
}

const PAPER_SEARCH_EASYSCHOLAR_CONFIG_ID = 'paper-search-easyscholar';

function readStoredEasyScholarKey(): string | null {
  const row = db.prepare('SELECT api_key FROM tool_configs WHERE id = ?')
    .get(PAPER_SEARCH_EASYSCHOLAR_CONFIG_ID) as { api_key?: string | null } | undefined;
  if (!row?.api_key) return null;
  return decryptApiKey(row.api_key);
}

function clearStoredEasyScholarKey(): void {
  db.prepare('DELETE FROM tool_configs WHERE id = ?').run(PAPER_SEARCH_EASYSCHOLAR_CONFIG_ID);
}

function migrateLegacyEasyScholarKey(): void {
  const storedKey = readStoredEasyScholarKey();
  if (storedKey) {
    setPaperSearchConfigValue('EASYSCHOLAR_KEY', storedKey);
    clearStoredEasyScholarKey();
  }
}

function getSyncedPaperSearchSettings(): PaperSearchConfigSettings {
  migrateLegacyEasyScholarKey();
  return getPaperSearchConfigSettings();
}

// fs:* handlers confine access via resolveProjectFile(rootPath, …), but rootPath itself
// arrives from the renderer. Without this guard a compromised renderer could pass
// rootPath='/' and read/write anywhere (e.g. ~/.ssh). Require it to be a registered
// project root; the renderer only ever passes currentProject.path.
function normalizeRootForCompare(p: string): string {
  try {
    return fs.realpathSync(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}

function isRegisteredProjectRoot(rootPath: string): boolean {
  if (!rootPath) return false;
  const target = normalizeRootForCompare(rootPath);
  const rows = db.prepare('SELECT path FROM projects').all() as { path: string }[];
  return rows.some((r) => r.path && normalizeRootForCompare(r.path) === target);
}

export function registerIpcHandlers() {
  registerFlowDiagramExportResponseHandler();
  const sceneSkillExposureService = createSceneSkillExposureService({
    storage: {
      get: () => store.get('sceneSkillExposures'),
      set: (_key, value) => { store.set('sceneSkillExposures', value); },
    },
  });

  typedHandle('capability-jobs:list', (_event, projectId) =>
    backgroundCapabilityJobs.list(projectId)
  );
  typedHandle('capability-jobs:command', (_event, projectId, jobId, action) => {
    switch (action) {
      case 'cancel':
        return backgroundCapabilityJobs.cancel(projectId, jobId);
      case 'stop_tracking':
        return backgroundCapabilityJobs.stopTracking(projectId, jobId);
      case 'resume_tracking':
        return backgroundCapabilityJobs.resumeTracking(projectId, jobId);
      case 'resubmit':
        return backgroundCapabilityJobs.resubmit(projectId, jobId);
    }
  });
  typedHandle('conversation:get-active-run', (_event, sessionId) =>
    conversationRunStreams.getActive(sessionId)
  );
  typedHandle('working-state:get-storage-status', () =>
    getConversationWorkingStateStorageStatus()
  );
  typedHandle('working-state:optimize-storage', async () => {
    await compactConversationWorkingState();
    return getConversationWorkingStateStorageStatus();
  });
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
      INSERT INTO projects (id, name, path, scene, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('default-project', '默认项目', defaultProjectPath, 'general', now, now);
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

  typedHandle('shell:openExternalUrl', async (_, url) => {
    await shell.openExternal(normalizeExternalHttpUrl(url));
    return { ok: true };
  });

  // electron-store handlers
  typedHandle('store:get', (_, key) => {
    assertRendererStoreKey(key);
    return store.get(key);
  });
  typedHandle('store:set', (_, key, value) => {
    assertRendererStoreKey(key);
    return store.set(key, value);
  });

  typedHandle('aiSubscriptions:getEntries', () => getAISubscriptionEntries());
  typedHandle(
    'aiSubscriptions:getActiveLogins',
    () => getActiveAISubscriptionLoginDescriptors()
  );
  typedHandle(
    'aiSubscriptions:setCapabilityEnabled',
    (_, entryId, capabilityId, enabled) =>
      saveAISubscriptionCapabilityState(entryId, capabilityId, Boolean(enabled))
  );
  typedHandle(
    'aiSubscriptions:connectWithKey',
    (_, entryId, subscriptionKey) =>
      connectAISubscriptionWithKey(entryId, String(subscriptionKey))
  );
  typedHandle(
    'aiSubscriptions:startLogin',
    async (_, entryId) => {
      if (entryId !== 'codex-oauth' && entryId !== 'xai-oauth') {
        throw new Error(`OAuth login is not supported for ${String(entryId)}`);
      }
      const result = await startAISubscriptionLogin(entryId);
      try {
        await shell.openExternal(normalizeExternalHttpUrl(result.descriptor.verificationUrl));
      } catch (error) {
        log.warn('[ai-subscriptions] Failed to open OAuth verification URL', error);
      }
      return result;
    }
  );
  typedHandle(
    'aiSubscriptions:pollLogin',
    (_, entryId, attemptId) => {
      if (entryId !== 'codex-oauth' && entryId !== 'xai-oauth') {
        throw new Error(`OAuth login is not supported for ${String(entryId)}`);
      }
      if (typeof attemptId !== 'string' || !attemptId) {
        throw new Error('OAuth login attempt id is required');
      }
      return pollAISubscriptionLogin(entryId, attemptId);
    }
  );
  typedHandle(
    'aiSubscriptions:cancelLogin',
    (_, entryId, attemptId) => {
      if (entryId !== 'codex-oauth' && entryId !== 'xai-oauth') {
        throw new Error(`OAuth login is not supported for ${String(entryId)}`);
      }
      if (typeof attemptId !== 'string' || !attemptId) {
        throw new Error('OAuth login attempt id is required');
      }
      return cancelAISubscriptionLogin(entryId, attemptId);
    }
  );
  typedHandle(
    'aiSubscriptions:disconnect',
    (_, entryId) => disconnectAISubscription(entryId)
  );
  typedHandle(
    'aiSubscriptions:getCapabilityRoutes',
    (_, capabilityId) => getAISubscriptionCapabilityRoutes(capabilityId)
  );
  typedHandle(
    'aiSubscriptions:refreshStatus',
    (_, entryId) =>
      refreshAISubscriptionStatus(entryId)
  );

  // Database handlers: Projects
  typedHandle('db:getProjects', () => {
    const projects = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as any[];
    return projects.map((p) => {
      const isGit = p.path ? fs.existsSync(path.join(p.path, '.git')) : false;
      return { ...p, isGit };
    });
  });

  typedHandle('db:createProject', (_, name, projectPath, scene) => {
    const projectScene = normalizeProjectScene(scene);
    const id = crypto.randomUUID();
    const now = Date.now();
    db.transaction(() => {
      db.prepare(
        'INSERT INTO projects (id, name, path, scene, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, name, projectPath, projectScene, now, now);
    })();
    initializeScenePreset({ projectId: id, projectPath, scene: projectScene });
    const isGit = projectPath ? fs.existsSync(path.join(projectPath, '.git')) : false;
    return { id, name, path: projectPath, scene: projectScene, created_at: now, updated_at: now, isGit };
  });

  typedHandle('db:deleteProject', (_, projectId) =>
    deleteProject(db, projectId, conversationWorkingStateLifecycle)
  );

  // 写后合成返回行（write-then-return），按 ADR-0052 排除清单保留手写。
  typedHandle('db:renameProject', (_, id, name) => {
    const now = Date.now();
    db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id);
    return { id, name, updated_at: now };
  });

  // Database handlers: Sessions
  typedCrud({
    channel: 'db:getSessions',
    read: (projectId) => {
      return db
        .prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC')
        .all(projectId) as Session[];
    },
  });

  typedHandle('db:createSession', (_, projectId, name, parentSessionId, summary) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    ensureProjectForSession(projectId);
    // 普通 Conversation 的根始终是受保护的 Master；caller 提供的 Agent 只可作为委派目标。
    const project = db.prepare('SELECT path, scene FROM projects WHERE id = ?').get(projectId) as
      | { path: string; scene: ProjectScene }
      | undefined;
    if (!project) throw new Error(`Project with ID ${projectId} not found.`);
    const master = createAgentCatalog(db, { initializeSchema: false }).resolveMaster(project.scene);
    const finalAgentId = master.agent.id;
    const systemContext = captureConversationSystemContextSnapshot({
      projectPath: project.path,
      sceneId: project.scene,
      promptSnapshot: master.system_prompt,
    });
    const skillSnapshot = JSON.stringify(systemContext.skillSnapshot);
    db.transaction(() => {
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, agent_id, parent_session_id, summary, prompt_snapshot, skill_snapshot, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, projectId, name, finalAgentId, parentSessionId || null, summary || null, systemContext.promptSnapshot, skillSnapshot, now, now);
    })();
    return { id, project_id: projectId, name, agent_id: finalAgentId, parent_session_id: parentSessionId || null, summary: summary || null, prompt_snapshot: systemContext.promptSnapshot, skill_snapshot: skillSnapshot, created_at: now, updated_at: now };
  });

  typedHandle('db:deleteSession', (_, sessionId) =>
    deleteConversation(db, sessionId, conversationWorkingStateLifecycle)
  );

  // Database handlers: Messages
  typedHandle('db:getMessages', (_, sessionId) => {
    const rows = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as any[];
    return rows.map((row) => {
      if (row.image_data) {
        try { row.imageBase64 = JSON.parse(row.image_data); } catch { /* ignore */ }
      }
      return row;
    });
  });

  typedHandle('db:saveMessage', (_, message) => {
    const { id, session_id, role, content, tokens, think_duration_seconds, imageBase64 } = message;
    const now = Date.now();

    let validatedImages: string[] | undefined;
    if (Array.isArray(imageBase64) && imageBase64.length > 0) {
      const MAX_IMAGES = 5;
      const MAX_BYTES = 7 * 1024 * 1024; // ~5MB raw after base64 overhead
      validatedImages = imageBase64
        .slice(0, MAX_IMAGES)
        .filter((item: unknown): item is string =>
          typeof item === 'string' && item.startsWith('data:image/') && item.length <= MAX_BYTES
        );
    }
    const imageData = validatedImages?.length ? JSON.stringify(validatedImages) : null;

    const existing = db.prepare('SELECT id FROM messages WHERE id = ?').get(id);
    if (existing) {
      db.prepare(`
        UPDATE messages SET content = ?, tokens = ?, image_data = COALESCE(?, image_data) WHERE id = ?
      `).run(content, tokens || null, imageData, id);
    } else {
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, created_at, tokens, think_duration_seconds, image_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, session_id, role, content, now, tokens || null, think_duration_seconds || null, imageData);
    }
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, session_id);
    return { id, session_id, role, content, created_at: now, tokens, imageBase64 };
  });

  typedCrud({
    channel: 'db:updateMessageThinkDuration',
    write: (id, seconds) => {
      db.prepare('UPDATE messages SET think_duration_seconds = ? WHERE id = ?').run(seconds, id);
    },
  });

  typedCrud({
    channel: 'db:deleteMessage',
    remove: (id) => {
      db.prepare('DELETE FROM messages WHERE id = ?').run(id);
    },
  });

  // Database handlers: LLM Providers
  typedHandle('db:getProviders', () => {
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

  typedHandle('db:saveProvider', (_, provider) => {
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

  typedCrud({
    channel: 'db:deleteProvider',
    remove: (id) => {
      db.prepare('DELETE FROM llm_providers WHERE id = ?').run(id);
    },
  });

  typedHandle('db:setActiveProvider', (_, id) => {
    db.prepare('UPDATE llm_providers SET is_active = 0').run();
    db.prepare('UPDATE llm_providers SET is_active = 1 WHERE id = ?').run(id);
  });

  // LLM Streaming API Call handler (deepagents-driven)
  typedHandle('llm:chat', (event, requestId, payload) => {
    const stream = conversationRunStreams.begin({
      sessionId: payload.sessionId,
      requestId,
      messageId: requestId,
      origin: 'foreground-message',
    });
    const chunkChannel = llmChunkChannel(requestId);
    const sender = {
      send: (channel: string, data: unknown) => {
        // A renderer reload must not terminate work that remains live in main.
        try {
          event.sender.send(channel, data);
        } catch {
          // The durable stream below remains available to the replacement renderer.
        }
        if (channel === chunkChannel) stream.sender.send(channel, data);
      },
    };

    void runLLMChat(sender, requestId, payload).then(() => {
      const snapshot = conversationRunStreams.getActive(payload.sessionId);
      const segments = collectAssistantSegments(requestId, snapshot?.events ?? []);
      if (segments.length > 0) {
        const persistMessage = db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at)
          VALUES (?, ?, 'assistant', ?, ?)
          ON CONFLICT(id) DO UPDATE SET content = excluded.content`);
        const completedAt = Date.now();
        db.transaction(() => {
          for (const segment of segments) {
            persistMessage.run(segment.id, payload.sessionId, segment.content, completedAt);
          }
        })();
      }
      stream.commit();
      try {
        event.sender.send('conversation:messages-changed', { sessionId: payload.sessionId });
      } catch {
        // A future renderer load will read the durable message directly.
      }
    }).catch((error) => {
      stream.fail();
      console.error('LLM chat task failed:', error);
    });
    return { ok: true };
  });

  typedHandle('llm:judge', async (_, payload) => {
    return runLLMJudge(payload);
  });

  typedHandle('llm:stopChat', async (_, requestId) => {
    stopLLMChat(requestId);
  });

  typedHandle('llm:resolveApproval', async (_, requestId, resolution) => {
    resolveLLMApproval(requestId, resolution);
  });

  typedHandle('llm:testProvider', async (_, providerId) => {
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

  typedHandle('llm:fetchProviderModels', async (_, providerId) => {
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

  typedHandle('llm:fetchOllamaModels', async (_, apiUrl) => {
    return await fetchOllamaModels(apiUrl);
  });

  typedHandle('db:selectDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  typedHandle('db:selectFile', async () => {
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

  // ===== Global Agent Library IPC Handlers =====

  const createGlobalAgentCatalog = (createId?: () => string) => createAgentCatalog(db, {
    createId,
    initializeSchema: false,
    listGlobalSkillIds: () => listGlobalSkillViews().map((skill) => skill.id),
  });
  const toAgentTransport = (agent: CatalogAgent) => ({
    ...agent,
    description: agent.description ?? undefined,
    provider_id: agent.provider_id ?? undefined,
    system_prompt: agent.system_prompt ?? undefined,
    config: agent.config ?? undefined,
  });

  typedHandle('db:getAgents', () => createGlobalAgentCatalog().list().map(toAgentTransport));

  typedHandle('db:createCustomAgent', (_, agent) => toAgentTransport(
    createGlobalAgentCatalog(() => agent.id).createCustom({
      name: agent.name,
      description: agent.description,
      provider_id: agent.provider_id,
      system_prompt: agent.system_prompt,
      config: agent.config,
      mcpServerExclusionIds: agent.mcpServerExclusionIds,
      skillNames: agent.skillNames,
    }),
  ));

  typedHandle('db:updateCustomAgent', (_, id, agent) => toAgentTransport(
    createGlobalAgentCatalog().updateCustom(id, agent),
  ));

  typedHandle('db:updateGeneralPurposeAgent', (_, agent) => toAgentTransport(
    createGlobalAgentCatalog().updateGeneralPurpose(agent),
  ));

  typedCrud({ channel: 'db:deleteCustomAgent', remove: (id) => createGlobalAgentCatalog().deleteCustom(id) });

  typedHandle('db:getMasterScenePrompts', () => {
    const catalog = createGlobalAgentCatalog();
    return SCENE_REGISTRY.map((scene) => ({
      scene: scene.id,
      systemPrompt: catalog.getMasterPrompt(scene.id),
      defaultSystemPrompt: catalog.getSceneDefaultPrompt(scene.id),
    }));
  });

  typedHandle('db:saveMasterScenePrompts', (_, changes) => {
    const catalog = createGlobalAgentCatalog();
    catalog.saveMasterPrompts(changes);
    return SCENE_REGISTRY.map((scene) => ({
      scene: scene.id,
      systemPrompt: catalog.getMasterPrompt(scene.id),
      defaultSystemPrompt: catalog.getSceneDefaultPrompt(scene.id),
    }));
  });

  // ===== Phase 3 & Phase 4: Skills Physical IPC Handlers =====

  typedHandle('db:getSkills', (_, projectId) => {
    const project = db.prepare('SELECT path, scene FROM projects WHERE id = ?').get(projectId) as
      | { path: string; scene?: ProjectScene }
      | undefined;
    if (!project) {
      return [];
    }
    const isGlobalSkillExposed = createGlobalSkillSceneExposureFilter(project.scene ?? 'general');
    return listResolvedSkillViews(project.path, {
      includeNestedProjectSkills: true,
      includeSkill: (source, name) => (
        source.kind !== 'built-in' && source.kind !== 'user'
      ) || isGlobalSkillExposed({ sourceKind: source.kind, name }),
    }) as Skill[];
  });

  typedHandle('db:getGlobalSkills', () => {
    // Product settings bypass Project resolution, so a Project Skill with the
    // same name can never shadow a Built-in or user-global Skill.
    return listGlobalSkillViews() as Skill[];
  });

  typedHandle('db:saveSkill', (_, projectId, skill) => {
    const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as { path: string } | undefined;
    if (!project) {
      throw new Error('Project not found');
    }

    const scope = skill.scope === 'global' ? 'global' : 'project';
    return savePhysicalSkill(project.path, scope, skill) as Skill;
  });

  typedHandle('db:deleteSkill', (_, projectId, id) => {
    const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as { path: string } | undefined;
    if (!project) {
      throw new Error('Project not found');
    }

    const scopePrefix: 'project' | 'global' = id.includes(':') ? (id.split(':', 2)[0] as 'project' | 'global') : 'project';
    const skillName = id.includes(':') ? id.split(':', 2)[1] : id;
    deletePhysicalSkill(project.path, scopePrefix, skillName);
  });

  typedHandle('db:importSkillDirectory', (_, sourceDir) => {
    return importPhysicalSkillDirectory(sourceDir) as Skill;
  });

  typedHandle('skills:getGlobalSceneExposure', (_, skill) => {
    return sceneSkillExposureService.get(resolveSceneSkillExposureInput(skill));
  });

  typedHandle('skills:setGlobalSceneExposure', (_, skill, sceneId, exposed) => {
    return sceneSkillExposureService.set(
      resolveSceneSkillExposureInput(skill),
      sceneId,
      exposed,
    );
  });

  typedCrud({
    channel: 'db:getAgentRuns',
    read: (sessionId) => {
      return db.prepare('SELECT * FROM agent_runs WHERE session_id = ? ORDER BY started_at DESC LIMIT 20').all(sessionId) as AgentRun[];
    },
  });

  typedCrud({
    channel: 'db:getAgentToolCalls',
    read: (runId) => {
      return db.prepare('SELECT * FROM agent_tool_calls WHERE run_id = ? ORDER BY started_at ASC').all(runId) as AgentToolCall[];
    },
  });

  typedCrud({
    channel: 'db:getDelegatedAgentRuns',
    read: (sessionId) => {
      return new DelegatedAgentRunRepository(db).listForConversation(sessionId);
    },
  });

  typedCrud({
    channel: 'db:getDelegatedToolActions',
    read: (sessionId) => {
      return new DelegatedAgentRunRepository(db).createToolActionRepository().listForConversation(sessionId);
    },
  });

  typedCrud({
    channel: 'db:getLatestTodos',
    read: (sessionId) => {
      return db.prepare(`
        SELECT atc.* FROM agent_tool_calls atc
        JOIN agent_runs ar ON atc.run_id = ar.id
        WHERE ar.session_id = ? AND atc.tool_name = 'write_todos' AND atc.status = 'success'
        ORDER BY atc.started_at DESC LIMIT 1
      `).get(sessionId) as AgentToolCall | undefined;
    },
  });

  // ===== Phase 3: MCP Server IPC Handlers =====

  typedHandle('db:getMcpServers', () => {
    const servers = db.prepare('SELECT * FROM mcp_servers ORDER BY updated_at DESC').all() as any[];
    return servers.map(s => ({
      ...s,
      config: s.config ? JSON.parse(s.config) : null,
      is_connected: !!s.is_connected,
    }));
  });

  typedHandle('db:saveMcpServer', (_, server) => {
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

  typedCrud({
    channel: 'db:deleteMcpServer',
    remove: (id) => {
      db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
    },
  });

  typedHandle('db:toggleMcpConnection', async (_, id, connected) => {
    db.prepare('UPDATE mcp_servers SET is_connected = ?, updated_at = ? WHERE id = ?').run(connected ? 1 : 0, Date.now(), id);
    // 断开时清理实际连接
    if (!connected) {
      await disconnectMcpServer(id);
    }
  });

  // ===== Phase 4: Tool Configs IPC Handlers =====

  typedHandle('db:getToolConfigs', () => {
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

  typedHandle('db:saveToolConfig', (_, config) => {
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

  typedCrud({
    channel: 'db:deleteToolConfig',
    remove: (id) => {
      db.prepare('DELETE FROM tool_configs WHERE id = ?').run(id);
    },
  });

  typedHandle('paper-search:getSettings', () => getSyncedPaperSearchSettings());

  typedHandle('paper-search:saveConfigValue', (_, key, value) => {
    if (typeof key !== 'string' || typeof value !== 'string' || value.trim().length === 0) {
      throw new Error('Paper Search CLI config value cannot be empty');
    }
    migrateLegacyEasyScholarKey();
    return setPaperSearchConfigValue(key, value);
  });

  typedHandle('paper-search:clearConfigValue', (_, key) => {
    migrateLegacyEasyScholarKey();
    return unsetPaperSearchConfigValue(key);
  });

  typedHandle('db:checkMcpHealth', async (_, id) => {
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

  // dead seam removed (was `agentInstances` Map, only ever written, never read).
  // The deepagents:createAgent channel is the only one that referenced it.
  typedHandle('deepagents:createAgent', async (_, config) => {
    const agentId = crypto.randomUUID();
    return { agentId };
  });

  // ===== Phase 4: Workflow CRUD IPC Handlers =====

  typedHandle('db:getWorkflows', (_, projectId) => {
    const rows = db.prepare(`
      SELECT id, project_id, name, description, stages, status, created_at, updated_at
      FROM workflows WHERE project_id = ? ORDER BY updated_at DESC
    `).all(projectId) as any[];
    return rows.map((row) => ({ ...row, stages: row.stages ? JSON.parse(row.stages) : [] }));
  });

  typedHandle('db:getWorkflow', (_, id) => {
    const row = db.prepare(`
      SELECT id, project_id, name, description, stages, status, created_at, updated_at
      FROM workflows WHERE id = ?
    `).get(id) as any;
    if (!row) return undefined;
    return { ...row, stages: row.stages ? JSON.parse(row.stages) : [] };
  });

  typedHandle('db:saveWorkflow', (_, workflow) => {
    const { project_id, name, description, stages: rawStages = [], status } = workflow;
    const stages = normalizeWorkflowStages(rawStages);
    const routeErrors = validateWorkflowStages(stages);
    if (routeErrors.length > 0) {
      throw new Error(`Invalid Workflow Stage routes: ${routeErrors.join('; ')}`);
    }
    const id = workflow.id?.trim() || crypto.randomUUID();
    const now = Date.now();
    const stagesJson = JSON.stringify(stages);
    const existing = db.prepare('SELECT created_at FROM workflows WHERE id = ?').get(id) as { created_at: number } | undefined;

    if (existing) {
      db.prepare(`
        UPDATE workflows
        SET name = ?, description = ?, stages = ?, status = ?, updated_at = ?
        WHERE id = ?
      `).run(name, description || null, stagesJson, status || 'draft', now, id);
    } else {
      db.prepare(`
        INSERT INTO workflows (id, project_id, name, description, stages, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, project_id, name, description || null, stagesJson, status || 'draft', now, now);
    }

    return {
      id,
      project_id,
      name,
      description,
      stages,
      status: status || 'draft',
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
  });

  typedCrud({
    channel: 'db:deleteWorkflow',
    remove: (id) => {
      db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
    },
  });


  // Confine open/reveal to files inside the given project's root. Absolute paths outside
  // the project (or missing projectId) are rejected so the renderer can't ask the shell to
  // open arbitrary local files/executables.
  function resolveProjectOwnedPath(
    filePath: string,
    projectId: string | undefined
  ): { path: string } | { error: string } {
    if (!projectId) return { error: 'projectId is required' };
    const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as
      | { path: string }
      | undefined;
    if (!project) return { error: `Unknown project: ${projectId}` };
    try {
      const abs = path.isAbsolute(filePath) ? filePath : path.join(project.path, filePath);
      return { path: resolveProjectFile(project.path, abs) };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  typedHandle('db:openFile', async (_, filePath, projectId) => {
    const resolved = resolveProjectOwnedPath(filePath, projectId);
    if ('error' in resolved) return { success: false, error: resolved.error };
    if (!fs.existsSync(resolved.path)) {
      return { success: false, error: `File not found: ${resolved.path}` };
    }
    await shell.openPath(resolved.path);
    return { success: true };
  });

  typedHandle('db:revealFile', async (_, filePath, projectId) => {
    const resolved = resolveProjectOwnedPath(filePath, projectId);
    if ('error' in resolved) return { success: false, error: resolved.error };
    if (fs.existsSync(resolved.path)) {
      shell.showItemInFolder(resolved.path);
      return { success: true };
    }
    const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as
      | { path: string }
      | undefined;
    if (project && fs.existsSync(project.path)) {
      shell.openPath(project.path);
      return { success: true, warning: 'Opened project folder as file does not exist yet' };
    }
    return { success: false, error: `File not found: ${resolved.path}` };
  });

  // ===== File Management IPC Handlers =====
  typedHandle('fs:readDirectory', async (_, rootPath, dirPath, showHidden) => {
    if (!isRegisteredProjectRoot(rootPath)) {
      return { ok: false, error: { code: 'EACCES', message: 'rootPath is not a registered project root' } };
    }
    try {
      ensureFileWatcher(rootPath);
      return { ok: true, data: await readDirectory(rootPath, dirPath, showHidden) };
    } catch (err: any) {
      return { ok: false, error: { code: err.code || 'EUNKNOWN', message: err.message } };
    }
  });

  typedHandle('fs:readFile', async (_, rootPath, filePath) => {
    if (!isRegisteredProjectRoot(rootPath)) {
      return { ok: false, error: { code: 'EACCES', message: 'rootPath is not a registered project root' } };
    }
    try {
      return { ok: true, data: await readFile(rootPath, filePath) };
    } catch (err: any) {
      return { ok: false, error: { code: err.code || 'EUNKNOWN', message: err.message } };
    }
  });

  typedHandle('fs:getFileInfo', async (_, rootPath, filePath) => {
    if (!isRegisteredProjectRoot(rootPath)) {
      return { ok: false, error: { code: 'EACCES', message: 'rootPath is not a registered project root' } };
    }
    try {
      return { ok: true, data: await getFileInfo(rootPath, filePath) };
    } catch (err: any) {
      return { ok: false, error: { code: err.code || 'EUNKNOWN', message: err.message } };
    }
  });

  typedHandle('fs:writeFile', async (_, rootPath, filePath, content, expectedContent) => {
    if (!isRegisteredProjectRoot(rootPath)) {
      return { ok: false, error: { code: 'EACCES', message: 'rootPath is not a registered project root' } };
    }
    try {
      await writeFile(rootPath, filePath, content, expectedContent);
      notifyFileChange(filePath);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: { code: err.code || 'EUNKNOWN', message: err.message } };
    }
  });

  typedHandle('fs:createFile', async (_, rootPath, filePath) => {
    if (!isRegisteredProjectRoot(rootPath)) {
      return { ok: false, error: { code: 'EACCES', message: 'rootPath is not a registered project root' } };
    }
    try {
      await createFile(rootPath, filePath);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: { code: err.code || 'EUNKNOWN', message: err.message } };
    }
  });

  typedHandle('fs:createDirectory', async (_, rootPath, dirPath) => {
    if (!isRegisteredProjectRoot(rootPath)) {
      return { ok: false, error: { code: 'EACCES', message: 'rootPath is not a registered project root' } };
    }
    try {
      await createDirectory(rootPath, dirPath);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: { code: err.code || 'EUNKNOWN', message: err.message } };
    }
  });

  typedHandle('fs:renameEntry', async (_, rootPath, oldPath, newName) => {
    if (!isRegisteredProjectRoot(rootPath)) {
      return { ok: false, error: { code: 'EACCES', message: 'rootPath is not a registered project root' } };
    }
    try {
      await renameEntry(rootPath, oldPath, newName);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: { code: err.code || 'EUNKNOWN', message: err.message } };
    }
  });

  typedHandle('fs:trashEntry', async (_, rootPath, targetPath) => {
    if (!isRegisteredProjectRoot(rootPath)) {
      return { ok: false, error: { code: 'EACCES', message: 'rootPath is not a registered project root' } };
    }
    try {
      await trashEntry(rootPath, targetPath);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: { code: err.code || 'EUNKNOWN', message: err.message } };
    }
  });

  typedHandle('fs:showItemInFolder', (_, filePath) => {
    shell.showItemInFolder(filePath);
    return { ok: true };
  });

  typedHandle('fs:watchDirectory', (_, rootPath, dirPath) => {
    if (!isRegisteredProjectRoot(rootPath)) {
      return { ok: false, error: { code: 'EACCES', message: 'rootPath is not a registered project root' } };
    }
    try {
      resolveProjectFile(rootPath, dirPath);
      watchDirectory(dirPath);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: { code: err.code || 'EUNKNOWN', message: err.message } };
    }
  });

  typedHandle('fs:unwatchDirectory', (_, dirPath) => {
    unwatchDirectory(dirPath);
    return { ok: true };
  });


  // ===== Phase 08.3 Plan 01: @Mention file candidate IPC (E-01..E-05) =====
  // B-01: enum range = active project root (resolved server-side from projectId).
  // ASVS V4: cross-project enumeration mitigated by DB-validated projectId lookup.
  registerAtMentionHandlers();

  // ===== Knowledge Base IPC =====
  registerKnowledgeBaseHandlers();

  // ===== Phase 6 Plan 02: Slash Command Registry IPC (D-15 O(1) memory read) =====
  typedHandle('commands:list', async (_evt, projectId, agentId, sessionId) => {
    try {
      const project = db.prepare('SELECT path, scene FROM projects WHERE id = ?').get(projectId) as { path: string; scene?: ProjectScene } | undefined;
      if (!project) {
        return { commands: [], conflicts: [], warnings: [] };
      }
      // Lazily start project-scoped chokidar watcher on first call.
      ensureProjectWatcher(project.path);
      if (sessionId) {
        const session = db.prepare('SELECT project_id FROM sessions WHERE id = ?').get(sessionId) as { project_id?: string } | undefined;
        if (session?.project_id !== projectId) return { commands: [], conflicts: [], warnings: [] };
      }
      const skillSnapshot = sessionId
        ? getOrCaptureConversationSystemContextSnapshot(db, {
          sessionId,
          projectPath: project.path,
          sceneId: project.scene ?? 'general',
          promptSnapshot: createAgentCatalog(db, { initializeSchema: false }).resolveMaster(project.scene ?? 'general').system_prompt,
        }).skillSnapshot
        : captureConversationSystemContextSnapshot({
          projectPath: project.path,
          sceneId: project.scene ?? 'general',
          promptSnapshot: '',
        }).skillSnapshot;
      return collectAllCommands(project.path, agentId, {}, skillSnapshot);
    } catch (err) {
      console.error('[commands:list] failed:', err);
      return { commands: [], conflicts: [], warnings: [] };
    }
  });

  typedHandle('commands:readProjectCommands', async (_evt, projectId) => {
    try {
      const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as { path: string } | undefined;
      if (!project) {
        return { commands: [] };
      }
      const commands = listProjectCommands(project.path);
      return { commands };
    } catch (err) {
      console.error('[commands:readProjectCommands] failed:', err);
      return { commands: [] };
    }
  });

  // ===== Phase 08.2 Plan 01: commands:readBody — lazy body load (D-06, ASVS V5.1.3) =====
  // Renderer calls this on dispatch for any SlashCommand with bodyPath. The body
  // is the .md file content (post-frontmatter). Path-traversal guarded.
  typedHandle('commands:readBody', async (_evt, bodyPath) => {
    try {
      // ASVS V5.1.3 input validation — defensive checks, never throw
      if (typeof bodyPath !== 'string' || bodyPath.length === 0 || bodyPath.length > 1024) {
        return { body: '', mtimeMs: 0 };
      }

      // Build allowlisted prefixes: ~/.cdf/commands/ + every registered project's .cdf/commands/
      const allowedPrefixes: string[] = [
        path.join(os.homedir(), '.cdf', 'commands'),
      ];
      try {
        const rows = db.prepare('SELECT path FROM projects').all() as Array<{ path: string }>;
        for (const r of rows) {
          if (r?.path) allowedPrefixes.push(path.join(r.path, '.cdf', 'commands'));
        }
      } catch (dbErr) {
        // If project enumeration fails, fall back to homedir-only allowlist
        console.warn('[commands:readBody] project enumeration failed, using homedir only:', dbErr);
      }

      const resolved = path.resolve(bodyPath);
      if (!fs.existsSync(resolved)) {
        return { body: '', mtimeMs: 0 };
      }

      const realResolved = fs.realpathSync(resolved);
      const realAllowedPrefixes = allowedPrefixes
        .filter((p) => fs.existsSync(p))
        .map((p) => fs.realpathSync(p));
      const isAllowed = realAllowedPrefixes.some(
        (p) => realResolved === p || realResolved.startsWith(p + path.sep)
      );
      if (!isAllowed) {
        console.warn('[commands:readBody] path not under allowed dir:', bodyPath);
        return { body: '', mtimeMs: 0 };
      }

      const stat = fs.statSync(realResolved);
      const content = fs.readFileSync(realResolved, 'utf-8');
      const body = stripMarkdownFrontmatter(content);
      return { body, mtimeMs: stat.mtimeMs };
    } catch (err) {
      console.error('[commands:readBody] failed:', err);
      return { body: '', mtimeMs: 0 };
    }
  });

  typedHandle('commands:readSkillBody', async (_evt, projectId, agentId, skillPath, sessionId) => {
    try {
      if (
        typeof projectId !== 'string' ||
        typeof skillPath !== 'string' ||
        !projectId ||
        !skillPath ||
        skillPath.length > 2048
      ) {
        return { body: '', mtimeMs: 0 };
      }

      const project = db.prepare('SELECT path, scene FROM projects WHERE id = ?').get(projectId) as { path: string; scene?: ProjectScene } | undefined;
      if (!project?.path) {
        return { body: '', mtimeMs: 0 };
      }

      const resolved = path.resolve(skillPath);
      if (sessionId) {
        const session = db.prepare('SELECT project_id FROM sessions WHERE id = ?').get(sessionId) as { project_id?: string } | undefined;
        if (session?.project_id !== projectId) return { body: '', mtimeMs: 0, error: 'Conversation does not belong to this Project' };
      }
      const skillSnapshot = sessionId
        ? getOrCaptureConversationSystemContextSnapshot(db, {
          sessionId,
          projectPath: project.path,
          sceneId: project.scene ?? 'general',
          promptSnapshot: createAgentCatalog(db, { initializeSchema: false }).resolveMaster(project.scene ?? 'general').system_prompt,
        }).skillSnapshot
        : null;
      if (!fs.existsSync(resolved)) {
        return { body: '', mtimeMs: 0, error: 'Snapshotted Skill source is unavailable' };
      }

      const realResolved = fs.realpathSync(resolved);
      const authorizedSkills = skillSnapshot ?? captureConversationSystemContextSnapshot({
        projectPath: project.path,
        sceneId: project.scene ?? 'general',
        promptSnapshot: '',
      }).skillSnapshot;
      const isResolvedSkillPath = authorizedSkills.some((skill) => {
        if (skill.userInvocable !== true || !skill.skillPath) return false;
        try {
          return fs.realpathSync(skill.skillPath) === realResolved;
        } catch {
          return false;
        }
      });
      if (!isResolvedSkillPath) {
        console.warn('[commands:readSkillBody] path is not a resolved Skill:', skillPath);
        return sessionId
          ? { body: '', mtimeMs: 0, error: 'Skill is not available in this Conversation Snapshot' }
          : { body: '', mtimeMs: 0 };
      }

      const stat = fs.statSync(realResolved);
      const content = fs.readFileSync(realResolved, 'utf-8');
      return { body: stripMarkdownFrontmatter(content).replace(/^\s+/, ''), mtimeMs: stat.mtimeMs };
    } catch (err) {
      console.error('[commands:readSkillBody] failed:', err);
      return { body: '', mtimeMs: 0 };
    }
  });

  // ===== Phase 7 Plan 01: /context token breakdown (D-08) =====
  // 08.2 P4: accepts optional `contextLimit` arg so renderer can pin
  // the active provider's limit (P10 mitigation). Falls back to provider
  // lookup → 200_000 default inside the aggregator.
  typedHandle('context:currentSession', async (_evt, sessionId, contextLimit, overriddenModelName) => {
    try {
      return await aggregateCurrentSessionContext(sessionId, contextLimit, overriddenModelName);
    } catch (err) {
      console.error('[context:currentSession] failed:', err);
      return {
        breakdown: {
          conversation: 0, skills: 0, mcp: 0, workflows: 0,
          systemPrompt: 0, systemTools: 0, customAgents: 0, memoryFiles: 0,
          messages: 0, projectCommandBodies: 0, freeSpace: 0, autocompactBuffer: 0,
          mcpPerTool: [], skillsPerSkill: [], workflowsPerWorkflow: [],
          systemToolsPerTool: [], projectCommandsPerFile: [],
        },
        total: 0,
        modelName: '',
        contextLimit: 200_000,
        used: 0,
        usedPct: 0,
        freePct: 100,
        mcpPerTool: [],
      };
    }
  });
  registerWorkflowRunIpcHandlers();
}
