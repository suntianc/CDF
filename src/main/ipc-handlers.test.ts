import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const {
  ipcHandleMock,
  runLLMChatMock,
  fetchOllamaModelsMock,
  stopLLMChatMock,
  resolveLLMApprovalMock,
  dbPrepareMock,
  storeGetMock,
  storeSetMock,
  collectAllCommandsMock,
  ensureProjectWatcherMock,
  resolveAgentSkillConfigOptionsMock,
  listResolvedSkillViewsMock,
  listGlobalSkillViewsMock,
  savePhysicalSkillMock,
  importPhysicalSkillDirectoryMock,
  initializeScenePresetMock,
  shellOpenExternalMock,
  startAISubscriptionLoginMock,
  pollAISubscriptionLoginMock,
  deleteConversationMock,
  deleteProjectMock,
  compactWorkingStateMock,
  getWorkingStateStorageStatusMock,
  captureConversationSystemContextSnapshotMock,
  createAgentCatalogMock,
  agentCatalogMock,
  conversationRunStreamsBeginMock,
  conversationRunStreamsGetActiveMock,
  conversationStreamSenderMock,
  conversationStreamCommitMock,
  conversationStreamFailMock,
} = vi.hoisted(() => {
  const agentCatalogMock = {
    list: vi.fn(),
    get: vi.fn(),
    resolveMaster: vi.fn(),
    createCustom: vi.fn(),
    updateGeneralPurpose: vi.fn(),
    updateCustom: vi.fn(),
    deleteCustom: vi.fn(),
    getMasterPrompt: vi.fn(),
    getSceneDefaultPrompt: vi.fn(),
    saveMasterPrompts: vi.fn(),
    saveMasterPrompt: vi.fn(),
    resetMasterPrompt: vi.fn(),
  };
  return {
  ipcHandleMock: vi.fn(),
  runLLMChatMock: vi.fn(),
  fetchOllamaModelsMock: vi.fn(),
  stopLLMChatMock: vi.fn(),
  resolveLLMApprovalMock: vi.fn(),
  dbPrepareMock: vi.fn((_sql: string) => ({
    all: vi.fn(() => [] as unknown[]),
    get: vi.fn(),
    run: vi.fn(),
  })),
  storeGetMock: vi.fn(),
  storeSetMock: vi.fn(),
  collectAllCommandsMock: vi.fn(async () => ({ commands: [], conflicts: [], warnings: [] })),
  ensureProjectWatcherMock: vi.fn(),
  resolveAgentSkillConfigOptionsMock: vi.fn(() => ({ options: undefined as Record<string, unknown> | undefined, warnings: [] as string[] })),
  listResolvedSkillViewsMock: vi.fn(() => [] as Array<Record<string, unknown>>),
  listGlobalSkillViewsMock: vi.fn(() => [] as Array<Record<string, unknown>>),
  savePhysicalSkillMock: vi.fn(),
  importPhysicalSkillDirectoryMock: vi.fn(),
  initializeScenePresetMock: vi.fn(),
  shellOpenExternalMock: vi.fn(async () => undefined),
  startAISubscriptionLoginMock: vi.fn(),
  pollAISubscriptionLoginMock: vi.fn(),
  deleteConversationMock: vi.fn(),
  deleteProjectMock: vi.fn(),
  compactWorkingStateMock: vi.fn(),
  getWorkingStateStorageStatusMock: vi.fn(),
  captureConversationSystemContextSnapshotMock: vi.fn(() => ({
    promptSnapshot: 'Captured Master prompt',
    skillSnapshot: listResolvedSkillViewsMock(),
  })),
  createAgentCatalogMock: vi.fn(() => agentCatalogMock),
  agentCatalogMock,
  conversationRunStreamsBeginMock: vi.fn(),
  conversationRunStreamsGetActiveMock: vi.fn(),
  conversationStreamSenderMock: { send: vi.fn() },
  conversationStreamCommitMock: vi.fn(),
  conversationStreamFailMock: vi.fn(),
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandleMock,
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/tmp/cdf-ipc-test'),
  },
  shell: {
    openExternal: shellOpenExternalMock,
  },
}));

vi.mock('./store', () => ({
  default: {
    get: storeGetMock,
    set: storeSetMock,
  },
}));

vi.mock('./ai-subscription-store', async () => {
  const actual = await vi.importActual<typeof import('./ai-subscription-store')>('./ai-subscription-store');
  return {
    ...actual,
    startAISubscriptionLogin: startAISubscriptionLoginMock,
    pollAISubscriptionLogin: pollAISubscriptionLoginMock,
  };
});

vi.mock('./database', () => ({
  default: {
    prepare: dbPrepareMock,
    transaction: vi.fn((fn) => fn),
  },
}));

vi.mock('./agent-catalog', () => ({
  createAgentCatalog: createAgentCatalogMock,
  MASTER_AGENT_ID: 'system-master-agent',
  GENERAL_PURPOSE_AGENT_ID: 'system-general-purpose-agent',
}));

vi.mock('./conversation-deletion', () => ({
  deleteConversation: deleteConversationMock,
  deleteProject: deleteProjectMock,
}));

vi.mock('./conversation-run-stream-runtime', () => ({
  conversationRunStreams: {
    begin: conversationRunStreamsBeginMock,
    getActive: conversationRunStreamsGetActiveMock,
  },
}));

vi.mock('./deepagent/conversation-working-state-maintenance', () => ({
  compactConversationWorkingState: compactWorkingStateMock,
  getConversationWorkingStateStorageStatus: getWorkingStateStorageStatusMock,
}));

vi.mock('./security', () => ({
  encryptApiKey: vi.fn((value: string) => value),
  decryptApiKey: vi.fn((value: string) => value),
}));

vi.mock('./llm', () => ({
  runLLMChat: runLLMChatMock,
  fetchOllamaModels: fetchOllamaModelsMock,
  stopLLMChat: stopLLMChatMock,
  resolveLLMApproval: resolveLLMApprovalMock,
}));

vi.mock('../shared/provider-url', () => ({
  buildAnthropicModelsUrl: vi.fn((url?: string) => url || ''),
  buildOpenAIModelsUrl: vi.fn((url?: string) => url || ''),
  normalizeProviderApiUrl: vi.fn((url?: string) => url || ''),
  shouldUseAnthropicAuthToken: vi.fn(() => false),
}));

vi.mock('./commands/command-registry', () => ({
  collectAllCommands: collectAllCommandsMock,
}));

vi.mock('./commands/chokidar-watcher', () => ({
  ensureProjectWatcher: ensureProjectWatcherMock,
}));

vi.mock('./deepagent/skill-manager', () => ({
  listPhysicalSkills: vi.fn(() => []),
  listResolvedSkillViews: listResolvedSkillViewsMock,
  listGlobalSkillViews: listGlobalSkillViewsMock,
  resolveAgentSkillConfigOptions: resolveAgentSkillConfigOptionsMock,
  savePhysicalSkill: savePhysicalSkillMock,
  importPhysicalSkillDirectory: importPhysicalSkillDirectoryMock,
  deletePhysicalSkill: vi.fn(),
  getBuiltInSkillRegistrations: vi.fn(() => []),
  getBuiltInSkillDirs: vi.fn(() => []),
  getScopePath: vi.fn(() => '/tmp/cdf-global-skills'),
}));

vi.mock('./deepagent/mcp-connector', () => ({
  createMcpClient: vi.fn(),
}));

vi.mock('./conversation-system-context-snapshot', () => ({
  captureConversationSystemContextSnapshot: captureConversationSystemContextSnapshotMock,
  getConversationSkillSnapshot: vi.fn(() => null),
}));

vi.mock('./scene-presets', () => ({
  initializeScenePreset: initializeScenePresetMock,
}));

import { registerIpcHandlers } from './ipc-handlers';
import { IPC_INVOKE_CHANNELS, llmChunkChannel, parallelTaskStepChannel } from '../shared/ipc-contract';


describe('IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeGetMock.mockReturnValue(undefined);
    storeSetMock.mockReset();
    collectAllCommandsMock.mockResolvedValue({ commands: [], conflicts: [], warnings: [] });
    ensureProjectWatcherMock.mockClear();
    resolveAgentSkillConfigOptionsMock.mockReturnValue({ options: undefined, warnings: [] });
    listResolvedSkillViewsMock.mockReturnValue([]);
    listGlobalSkillViewsMock.mockReturnValue([]);
    captureConversationSystemContextSnapshotMock.mockClear();
    createAgentCatalogMock.mockClear();
    agentCatalogMock.list.mockReset();
    agentCatalogMock.get.mockReset();
    agentCatalogMock.resolveMaster.mockReset();
    agentCatalogMock.createCustom.mockReset();
    agentCatalogMock.updateGeneralPurpose.mockReset();
    agentCatalogMock.updateCustom.mockReset();
    agentCatalogMock.deleteCustom.mockReset();
    agentCatalogMock.getMasterPrompt.mockReset();
    agentCatalogMock.getSceneDefaultPrompt.mockReset();
    agentCatalogMock.saveMasterPrompts.mockReset();
    agentCatalogMock.saveMasterPrompt.mockReset();
    agentCatalogMock.resetMasterPrompt.mockReset();
    savePhysicalSkillMock.mockReset();
    importPhysicalSkillDirectoryMock.mockReset();
    initializeScenePresetMock.mockReset();
    shellOpenExternalMock.mockClear();
    startAISubscriptionLoginMock.mockReset();
    pollAISubscriptionLoginMock.mockReset();
    conversationStreamSenderMock.send.mockReset();
    conversationStreamCommitMock.mockReset();
    conversationStreamFailMock.mockReset();
    conversationRunStreamsBeginMock.mockReset().mockReturnValue({
      sender: conversationStreamSenderMock,
      commit: conversationStreamCommitMock,
      fail: conversationStreamFailMock,
    });
    conversationRunStreamsGetActiveMock.mockReset().mockReturnValue(null);
    deleteConversationMock.mockReset();
    deleteProjectMock.mockReset();
    compactWorkingStateMock.mockReset();
    getWorkingStateStorageStatusMock.mockReset();
    getWorkingStateStorageStatusMock.mockReturnValue({
      phase: 'normal',
      maintenancePhase: null,
      physicalBytes: 0,
      estimatedReclaimableBytes: 0,
      blockedReason: null,
      failureReason: null,
    });
  });

  it('registers exactly the channels declared in the IPC contract — no missing, no ghosts', () => {
    // registerIpcHandlers 内部级联调用 workflow / at-mention / knowledge 注册入口，
    // 因此这里收集到的是全部 4 个注册文件的并集。
    registerIpcHandlers();
    const registered = [...new Set(ipcHandleMock.mock.calls.map(([channel]) => channel))].sort();
    const declared = [...IPC_INVOKE_CHANNELS].sort();
    expect(registered).toEqual(declared);
  });

  it('lists Built-in and user-global Skills without Project resolution', () => {
    const globalSkills = [{ id: 'built-in:review', sourceKind: 'built-in' }];
    listGlobalSkillViewsMock.mockReturnValue(globalSkills);
    registerIpcHandlers();
    const handler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:getGlobalSkills')?.[1];

    expect(handler).toBeTypeOf('function');
    expect(handler!({})).toEqual(globalSkills);
    expect(listGlobalSkillViewsMock).toHaveBeenCalledWith();
    expect(listResolvedSkillViewsMock).not.toHaveBeenCalled();
  });

  it('builds dynamic event channel names through the shared factories', () => {
    expect(llmChunkChannel('req-1')).toBe('llm:chunk-req-1');
    expect(parallelTaskStepChannel('session-9')).toBe('agent:parallel-task-step-session-9');
  });

  it('exposes only safe Conversation storage status through IPC', () => {
    getWorkingStateStorageStatusMock.mockReturnValue({
      phase: 'normal',
      maintenancePhase: null,
      physicalBytes: 4096,
      estimatedReclaimableBytes: 1024,
      blockedReason: null,
      failureReason: null,
    });
    registerIpcHandlers();
    const handler = ipcHandleMock.mock.calls.find(
      ([channel]) => channel === 'working-state:get-storage-status'
    )?.[1];
    expect(handler).toBeTypeOf('function');

    const result = handler({});

    expect(Object.keys(result).sort()).toEqual([
      'blockedReason',
      'estimatedReclaimableBytes',
      'failureReason',
      'maintenancePhase',
      'phase',
      'physicalBytes',
    ]);
    expect(result.physicalBytes).toBeTypeOf('number');
    expect(result.estimatedReclaimableBytes).toBeLessThanOrEqual(result.physicalBytes);
    expect(JSON.stringify(result)).not.toMatch(/path|sql|table|checkpoint|thread|database/i);
    expect(getWorkingStateStorageStatusMock).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: 'success',
      outcome: { ok: true, physicalBytesBefore: 4096, physicalBytesAfter: 2048 },
      status: {
        phase: 'normal',
        maintenancePhase: null,
        physicalBytes: 2048,
        estimatedReclaimableBytes: 0,
        blockedReason: null,
        failureReason: null,
      },
    },
    {
      name: 'failure',
      outcome: { ok: false, failureReason: 'COMPACTION_FAILED', error: new Error('/private/cdf.db') },
      status: {
        phase: 'failed',
        maintenancePhase: null,
        physicalBytes: 4096,
        estimatedReclaimableBytes: 1024,
        blockedReason: null,
        failureReason: 'COMPACTION_FAILED',
      },
    },
  ])('starts guarded storage optimization and returns safe $name status', async ({ outcome, status }) => {
    compactWorkingStateMock.mockResolvedValue(outcome);
    getWorkingStateStorageStatusMock.mockReturnValue(status);
    registerIpcHandlers();
    const handler = ipcHandleMock.mock.calls.find(
      ([channel]) => channel === 'working-state:optimize-storage'
    )?.[1];
    expect(handler).toBeTypeOf('function');

    const result = await handler({}, { skipIdleChecks: true, databasePath: '/private/cdf.db' });

    expect(compactWorkingStateMock).toHaveBeenCalledWith();
    expect(getWorkingStateStorageStatusMock).toHaveBeenCalledOnce();
    expect(result).toEqual(status);
    expect(JSON.stringify(result)).not.toMatch(/path|sql|table|checkpoint|thread|database/i);
  });

  it('opens external http urls through the system browser shell', async () => {
    registerIpcHandlers();
    const openExternalHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'shell:openExternalUrl')?.[1];
    expect(openExternalHandler).toBeTypeOf('function');

    await expect(openExternalHandler({}, 'https://www.easyscholar.cc/console/user/open')).resolves.toEqual({ ok: true });

    expect(shellOpenExternalMock).toHaveBeenCalledWith('https://www.easyscholar.cc/console/user/open');
  });

  it('rejects non-http external urls', async () => {
    registerIpcHandlers();
    const openExternalHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'shell:openExternalUrl')?.[1];
    expect(openExternalHandler).toBeTypeOf('function');

    await expect(openExternalHandler({}, 'file:///tmp/secret')).rejects.toThrow('External URL must use http or https');
    expect(shellOpenExternalMock).not.toHaveBeenCalled();
  });

  it('does not expose AI subscription credentials through the renderer store bridge', () => {
    registerIpcHandlers();
    const storeGetHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'store:get')?.[1];
    expect(storeGetHandler).toBeTypeOf('function');

    expect(() => storeGetHandler({}, 'aiSubscriptionSecrets')).toThrow(
      'Store key is not renderer-accessible'
    );
    expect(storeGetMock).not.toHaveBeenCalled();
  });

  it('starts Codex login through the AI subscription IPC with a safe descriptor', async () => {
    const result = {
      entries: [],
      descriptor: {
        attemptId: 'attempt-1',
        flow: 'device_code',
        verificationUrl: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-1234',
        expiresAt: 1_800_000_900_000,
        pollIntervalMs: 5_000,
      },
    };
    startAISubscriptionLoginMock.mockResolvedValue(result);
    registerIpcHandlers();
    const startLoginHandler = ipcHandleMock.mock.calls.find(
      ([channel]) => channel === 'aiSubscriptions:startLogin'
    )?.[1];
    expect(startLoginHandler).toBeTypeOf('function');

    await expect(startLoginHandler({}, 'codex-oauth')).resolves.toEqual(result);
    expect(startAISubscriptionLoginMock).toHaveBeenCalledWith('codex-oauth');
    expect(JSON.stringify(result)).not.toMatch(/device_auth_id|access.?token|refresh.?token|code.?verifier/i);
  });

  it('returns the device descriptor when the system browser cannot be opened', async () => {
    const result = {
      entries: [],
      descriptor: {
        attemptId: 'attempt-1',
        flow: 'device_code',
        verificationUrl: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-1234',
        expiresAt: 1_800_000_900_000,
        pollIntervalMs: 5_000,
      },
    };
    startAISubscriptionLoginMock.mockResolvedValue(result);
    shellOpenExternalMock.mockRejectedValueOnce(new Error('no browser'));
    registerIpcHandlers();
    const startLoginHandler = ipcHandleMock.mock.calls.find(
      ([channel]) => channel === 'aiSubscriptions:startLogin'
    )?.[1];

    await expect(startLoginHandler({}, 'codex-oauth')).resolves.toEqual(result);
  });

  it('polls Codex login completion through the AI subscription IPC', async () => {
    const result = { entries: [], status: 'connected' };
    pollAISubscriptionLoginMock.mockResolvedValue(result);
    registerIpcHandlers();
    const pollLoginHandler = ipcHandleMock.mock.calls.find(
      ([channel]) => channel === 'aiSubscriptions:pollLogin'
    )?.[1];
    expect(pollLoginHandler).toBeTypeOf('function');

    await expect(pollLoginHandler({}, 'codex-oauth', 'attempt-1')).resolves.toEqual(result);
    expect(pollAISubscriptionLoginMock).toHaveBeenCalledWith('codex-oauth', 'attempt-1');
  });

  it('routes db:deleteProject through the authoritative Project deletion seam', async () => {
    registerIpcHandlers();
    const deleteProjectHandler = ipcHandleMock.mock.calls.find(
      ([channel]) => channel === 'db:deleteProject'
    )?.[1];
    expect(deleteProjectHandler).toBeTypeOf('function');
    dbPrepareMock.mockClear();

    await expect(Promise.resolve(deleteProjectHandler({}, 'project-1'))).resolves.toBeUndefined();

    expect(deleteProjectMock).toHaveBeenCalledWith(expect.any(Object), 'project-1', expect.any(Object));
    expect(dbPrepareMock).not.toHaveBeenCalled();
  });

  it('routes db:deleteSession through the authoritative Conversation deletion seam', async () => {
    registerIpcHandlers();
    const deleteSessionHandler = ipcHandleMock.mock.calls.find(
      ([channel]) => channel === 'db:deleteSession'
    )?.[1];
    expect(deleteSessionHandler).toBeTypeOf('function');
    dbPrepareMock.mockClear();

    await expect(Promise.resolve(deleteSessionHandler({}, 'conversation-1'))).resolves.toBeUndefined();

    expect(deleteConversationMock).toHaveBeenCalledWith(expect.any(Object), 'conversation-1', expect.any(Object));
    expect(dbPrepareMock).not.toHaveBeenCalled();
  });

  it('passes Conversation deletion rejection errors through db:deleteSession', async () => {
    const rejection = new Error('[CONVERSATION_DELETE_BLOCKED_ACTIVE_AGENT_RUN] Conversation is busy');
    deleteConversationMock.mockRejectedValueOnce(rejection);
    registerIpcHandlers();
    const deleteSessionHandler = ipcHandleMock.mock.calls.find(
      ([channel]) => channel === 'db:deleteSession'
    )?.[1];

    await expect(deleteSessionHandler({}, 'conversation-1')).rejects.toBe(rejection);
  });

  it('should acknowledge llm:chat immediately and stream asynchronously', () => {
    const neverSettles = new Promise<void>(() => {});
    runLLMChatMock.mockReturnValue(neverSettles);

    registerIpcHandlers();
    const chatHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'llm:chat')?.[1];
    expect(chatHandler).toBeTypeOf('function');

    const sender = { send: vi.fn() };
    const result = chatHandler({ sender }, 'request-1', { sessionId: 'session-1' });

    expect(result).toEqual({ ok: true });
    expect(runLLMChatMock).toHaveBeenCalledWith(expect.any(Object), 'request-1', { sessionId: 'session-1' });
  });

  it('keeps a foreground llm:chat resumable across renderer reloads without duplicating non-LLM events', async () => {
    let resolveChat!: () => void;
    runLLMChatMock.mockReturnValue(new Promise<void>((resolve) => {
      resolveChat = resolve;
    }));
    conversationRunStreamsGetActiveMock.mockReturnValue({
      content: 'before toolafter tool',
      events: [
        { type: 'message_chunk', text: 'before tool' },
        { type: 'tool_start', id: 'tool-1', name: 'read_file' },
        { type: 'message_chunk', text: 'after tool' },
      ],
    });
    const rendererSender = { send: vi.fn() };

    registerIpcHandlers();
    const chatHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'llm:chat')?.[1];
    expect(chatHandler).toBeTypeOf('function');
    const persistMessage = vi.fn();
    dbPrepareMock.mockClear();
    dbPrepareMock.mockImplementation((_sql: string) => ({
      all: vi.fn(() => []),
      get: vi.fn(),
      run: persistMessage,
    }));

    expect(chatHandler({ sender: rendererSender }, 'request-1', {
      projectId: 'project-1',
      sessionId: 'session-1',
      message: { id: 'user-1', content: 'research' },
    })).toEqual({ ok: true });

    expect(conversationRunStreamsBeginMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      requestId: 'request-1',
      messageId: 'request-1',
      origin: 'foreground-message',
    });

    const durableSender = runLLMChatMock.mock.calls[0][0];
    const chunk = { type: 'message_chunk', text: 'before tool' };
    durableSender.send(llmChunkChannel('request-1'), chunk);
    expect(rendererSender.send).toHaveBeenCalledWith(llmChunkChannel('request-1'), chunk);
    expect(conversationStreamSenderMock.send).toHaveBeenCalledWith(llmChunkChannel('request-1'), chunk);

    durableSender.send('workflow-run:projection-event', { type: 'run', status: 'running' });
    expect(rendererSender.send).toHaveBeenCalledWith(
      'workflow-run:projection-event',
      { type: 'run', status: 'running' },
    );
    expect(conversationStreamSenderMock.send).toHaveBeenCalledTimes(1);

    resolveChat();
    await vi.waitFor(() => expect(conversationStreamCommitMock).toHaveBeenCalledOnce());
    expect(dbPrepareMock.mock.calls.some(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO messages')
    )).toBe(true);
    expect(persistMessage).toHaveBeenNthCalledWith(
      1,
      'request-1',
      'session-1',
      'before tool',
      expect.any(Number),
    );
    expect(persistMessage).toHaveBeenNthCalledWith(
      2,
      'request-1:assistant:1',
      'session-1',
      'after tool',
      expect.any(Number),
    );
    expect(conversationStreamFailMock).not.toHaveBeenCalled();
  });

  it('creates Custom Agents through a Project-free typed IPC seam', () => {
    const created = {
      id: 'agent-1', role: 'custom', name: 'Smart Agent 123-_', slug: 'smart-agent-123',
      description: null, provider_id: null, system_prompt: null, config: null,
      mcpServerExclusionIds: [], skillNames: [], created_at: 1, updated_at: 1,
    };
    dbPrepareMock.mockImplementation(() => ({ get: vi.fn(), all: vi.fn(() => []), run: vi.fn() }));
    agentCatalogMock.createCustom.mockReturnValue(created);
    registerIpcHandlers();
    const createHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:createCustomAgent')?.[1];

    expect(createHandler({}, { id: 'agent-1', name: created.name }))
      .toEqual(expect.objectContaining({ id: 'agent-1', role: 'custom', name: created.name }));
    expect(agentCatalogMock.createCustom).toHaveBeenCalledWith(expect.objectContaining({ name: created.name }));
    expect(agentCatalogMock.createCustom.mock.calls[0][0]).not.toHaveProperty('project_id');
  });

  it('forwards Skill preload references to the Agent Catalog validation seam', () => {
    const created = {
      id: 'agent-1', role: 'custom', name: 'Preload Agent', slug: 'preload-agent',
      description: null, provider_id: null, system_prompt: null, config: null,
      mcpServerExclusionIds: [], skillNames: ['global:teach'], created_at: 1, updated_at: 1,
    };
    listGlobalSkillViewsMock.mockReturnValue([{ id: 'global:teach' }]);
    agentCatalogMock.createCustom.mockReturnValue(created);
    registerIpcHandlers();
    const createHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:createCustomAgent')?.[1];

    createHandler({}, { id: 'agent-1', name: 'Preload Agent', skillNames: ['global:teach'] });
    expect(agentCatalogMock.createCustom).toHaveBeenCalledWith(expect.objectContaining({
      skillNames: ['global:teach'],
    }));
  });

  it('persists the selected Scene when creating a project', () => {
    const insertRunMock = vi.fn();
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: vi.fn(),
      all: vi.fn(() => []),
      run: vi.fn((...args: unknown[]) => {
        if (sql.includes('INSERT INTO projects')) {
          insertRunMock(...args);
        }
      }),
    }));

    registerIpcHandlers();
    const createProjectHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:createProject')?.[1];
    expect(createProjectHandler).toBeTypeOf('function');

    const project = createProjectHandler({}, 'AI Papers', '/tmp/ai-papers', 'research');

    expect(insertRunMock).toHaveBeenCalledWith(
      expect.any(String),
      'AI Papers',
      '/tmp/ai-papers',
      'research',
      expect.any(Number),
      expect.any(Number),
    );
    expect(project).toEqual(expect.objectContaining({
      name: 'AI Papers',
      path: '/tmp/ai-papers',
      scene: 'research',
    }));
  });

  it('calls the Scene preset initialization seam when creating a project', () => {
    dbPrepareMock.mockImplementation(() => ({
      get: vi.fn(),
      all: vi.fn(() => []),
      run: vi.fn(),
    }));

    registerIpcHandlers();
    const createProjectHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:createProject')?.[1];
    expect(createProjectHandler).toBeTypeOf('function');

    const project = createProjectHandler({}, 'AI Papers', '/tmp/ai-papers', 'research');

    expect(initializeScenePresetMock).toHaveBeenCalledWith({
      projectId: project.id,
      projectPath: '/tmp/ai-papers',
      scene: 'research',
    });
  });

  it('does not create Agents with a new Project because the Catalog is global', () => {
    const agentDefinitionWrites: unknown[][] = [];
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: vi.fn(),
      all: vi.fn(() => []),
      run: vi.fn((...args: unknown[]) => {
        if (sql.includes('agents')) agentDefinitionWrites.push(args);
      }),
    }));

    registerIpcHandlers();
    const createProjectHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:createProject')?.[1];
    createProjectHandler({}, 'CDF', '/tmp/cdf', 'general');

    expect(agentDefinitionWrites).toEqual([]);
    expect(createAgentCatalogMock).not.toHaveBeenCalled();
  });

  it('binds every ordinary Conversation to the global Master and captures its Project Scene prompt', () => {
    const sessionInsert = vi.fn();
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: vi.fn(() => sql.includes('SELECT path, scene FROM projects')
        ? { path: '/tmp/project', scene: 'research' }
        : sql.includes('SELECT id FROM projects') ? { id: 'project-1' } : undefined),
      all: vi.fn(() => []),
      run: vi.fn((...args: unknown[]) => {
        if (sql.includes('INSERT INTO sessions')) sessionInsert(...args);
      }),
    }));
    agentCatalogMock.resolveMaster.mockReturnValue({
      agent: { id: 'system-master-agent', role: 'master' },
      system_prompt: 'Research Master prompt',
    });

    registerIpcHandlers();
    const createSessionHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:createSession')?.[1];
    const session = createSessionHandler({}, 'project-1', 'Conversation', undefined, undefined);

    expect(session.agent_id).toBe('system-master-agent');
    expect(agentCatalogMock.resolveMaster).toHaveBeenCalledWith('research');
    expect(captureConversationSystemContextSnapshotMock).toHaveBeenCalledWith({
      projectPath: '/tmp/project', sceneId: 'research', promptSnapshot: 'Research Master prompt',
    });
    expect(sessionInsert).toHaveBeenCalledWith(
      expect.any(String), 'project-1', 'Conversation', 'system-master-agent', null, null, 'Captured Master prompt', '[]', expect.any(Number), expect.any(Number),
    );
  });

  it('persists Workflow Skeleton CRUD without a master identity field', () => {
    const workflowWrites: string[] = [];
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: vi.fn(() => sql.includes('SELECT created_at FROM workflows') ? undefined : undefined),
      all: vi.fn(() => sql.includes('FROM workflows WHERE project_id') ? [{
        id: 'workflow-1', project_id: 'project-1', name: 'Saved', description: null,
        stages: '[]', status: 'draft', created_at: 1, updated_at: 2,
      }] : []),
      run: vi.fn(() => { if (sql.includes('workflows')) workflowWrites.push(sql); }),
    }));
    registerIpcHandlers();
    const listHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:getWorkflows')?.[1];
    const saveHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:saveWorkflow')?.[1];

    expect(listHandler({}, 'project-1')).toEqual([{
      id: 'workflow-1', project_id: 'project-1', name: 'Saved', description: null,
      stages: [], status: 'draft', created_at: 1, updated_at: 2,
    }]);
    const stages = [{
      id: 'stage-1', name: 'Only Stage', taskDescription: '', acceptanceCriteria: '',
      gateEnabled: false, terminal: true, routes: [],
    }];
    expect(saveHandler({}, {
      id: 'workflow-1', project_id: 'project-1', name: 'Saved', description: '', stages, status: 'draft',
    })).toEqual(expect.objectContaining({
      id: 'workflow-1', project_id: 'project-1', stages, status: 'draft',
    }));
    expect(workflowWrites.join('\n')).not.toContain('master_agent_id');
  });

  it('saves all Master Scene prompts through one atomic Project-free IPC call', () => {
    agentCatalogMock.getMasterPrompt.mockImplementation((scene: string) => `Saved ${scene}`);
    agentCatalogMock.getSceneDefaultPrompt.mockImplementation((scene: string) => `Default ${scene}`);
    registerIpcHandlers();
    const saveHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:saveMasterScenePrompts')?.[1];

    expect(saveHandler({}, [
      { scene: 'general', systemPrompt: 'Edited general' },
      { scene: 'research', systemPrompt: 'Edited research' },
    ])).toEqual([
      { scene: 'general', systemPrompt: 'Saved general', defaultSystemPrompt: 'Default general' },
      { scene: 'research', systemPrompt: 'Saved research', defaultSystemPrompt: 'Default research' },
    ]);
    expect(agentCatalogMock.saveMasterPrompts).toHaveBeenCalledWith([
      { scene: 'general', systemPrompt: 'Edited general' },
      { scene: 'research', systemPrompt: 'Edited research' },
    ]);
  });

  it('rejects deleting the protected global Master through the Custom-only seam', () => {
    agentCatalogMock.deleteCustom.mockImplementation(() => { throw new Error('Only Custom Agents can be deleted'); });
    registerIpcHandlers();
    const deleteHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:deleteCustomAgent')?.[1];

    expect(() => deleteHandler({}, 'system-master-agent')).toThrow('Only Custom Agents can be deleted');
    expect(agentCatalogMock.deleteCustom).toHaveBeenCalledWith('system-master-agent');
  });



  it('lists the global Master, General-purpose, and Custom Catalog roles without a Project id', () => {
    const agents = [
      { id: 'system-master-agent', role: 'master', name: 'Master Agent', slug: 'master-agent', description: null, provider_id: null, system_prompt: null, config: null, created_at: 1, updated_at: 1 },
      { id: 'system-general-purpose-agent', role: 'general-purpose', name: 'General-purpose', slug: 'general-purpose', description: null, provider_id: null, system_prompt: 'Delegate', config: null, created_at: 1, updated_at: 1 },
      { id: 'custom-1', role: 'custom', name: 'Reviewer', slug: 'reviewer', description: null, provider_id: null, system_prompt: null, config: null, created_at: 1, updated_at: 1 },
    ];
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: vi.fn(() => sql.includes('SELECT scene FROM projects') ? { scene: 'research' } : undefined),
      all: vi.fn(() => []),
      run: vi.fn(),
    }));
    agentCatalogMock.list.mockReturnValue(agents);
    agentCatalogMock.getMasterPrompt.mockReturnValue('Research Master prompt');

    registerIpcHandlers();
    const getAgentsHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:getAgents')?.[1];
    const listed = getAgentsHandler({});

    expect(listed).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'system-master-agent', role: 'master' }),
      expect.objectContaining({ id: 'system-general-purpose-agent', role: 'general-purpose' }),
      expect.objectContaining({ id: 'custom-1', role: 'custom' }),
    ]));
    expect(JSON.stringify(listed)).not.toMatch(/project_id|is_default|is_protected/);
  });

  it('rejects deleting the protected global General-purpose Agent through the Custom-only seam', () => {
    agentCatalogMock.deleteCustom.mockImplementation(() => { throw new Error('Only Custom Agents can be deleted'); });
    registerIpcHandlers();
    const deleteHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:deleteCustomAgent')?.[1];

    expect(() => deleteHandler({}, 'system-general-purpose-agent')).toThrow('Only Custom Agents can be deleted');
    expect(agentCatalogMock.deleteCustom).toHaveBeenCalledWith('system-general-purpose-agent');
  });

  it('reads and writes Global Skill Scene Exposure through the product IPC API', () => {
    registerIpcHandlers();
    const getExposureHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'skills:getGlobalSceneExposure')?.[1];
    const setExposureHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'skills:setGlobalSceneExposure')?.[1];
    const skill = { sourceKind: 'user' as const, name: 'personal-review' };

    expect(getExposureHandler({}, skill)).toEqual({
      skill,
      exposures: { general: true, research: true },
    });
    expect(setExposureHandler({}, skill, 'research', false)).toEqual({
      skill,
      exposures: { general: true, research: false },
    });
    expect(storeSetMock).toHaveBeenCalledWith('sceneSkillExposures', {
      'user:personal-review': { research: false },
    });
  });

  it('passes Skill create validation errors through db:saveSkill', () => {
    savePhysicalSkillMock.mockImplementationOnce(() => {
      throw new Error('Skill 描述不能为空');
    });
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: vi.fn(() => sql.includes('FROM projects') ? { path: '/tmp/project' } : null),
      all: vi.fn(() => []),
      run: vi.fn(),
    }));

    registerIpcHandlers();
    const saveSkillHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:saveSkill')?.[1];
    expect(saveSkillHandler).toBeTypeOf('function');

    expect(() =>
      saveSkillHandler({}, 'project-1', {
        scope: 'project',
        name: 'missing-description',
      })
    ).toThrow('Skill 描述不能为空');
    expect(savePhysicalSkillMock).toHaveBeenCalledWith('/tmp/project', 'project', expect.objectContaining({
      name: 'missing-description',
    }));
  });

  it('passes Skill import validation errors through db:importSkillDirectory', () => {
    importPhysicalSkillDirectoryMock.mockImplementationOnce(() => {
      throw new Error('Skill 元数据无效：Skill 元数据 name 不能为空');
    });

    registerIpcHandlers();
    const importSkillHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:importSkillDirectory')?.[1];
    expect(importSkillHandler).toBeTypeOf('function');

    expect(() =>
      importSkillHandler({}, '/tmp/source-skill')
    ).toThrow('Skill 元数据无效：Skill 元数据 name 不能为空');
    expect(importPhysicalSkillDirectoryMock).toHaveBeenCalledWith('/tmp/source-skill');
  });

  it('reads explicit Skill invocation body only for resolved Skill paths', async () => {
    const tempProjectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-skill-body-test-'));
    const skillDir = path.join(tempProjectPath, '.cdf', 'skills', 'review');
    const skillPath = path.join(skillDir, 'SKILL.md');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      skillPath,
      [
        '---',
        'name: review',
        'description: Review workflow',
        '---',
        '',
        '# Review',
        '',
        'Use the review checklist.',
      ].join('\n'),
      'utf-8'
    );
    listResolvedSkillViewsMock.mockReturnValue([{ skillPath, userInvocable: true }]);
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: vi.fn(() => sql.includes('FROM projects') ? { path: tempProjectPath, scene: 'general' } : null),
      all: vi.fn(() => []),
      run: vi.fn(),
    }));

    try {
      registerIpcHandlers();
      const readSkillBodyHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'commands:readSkillBody')?.[1];
      expect(readSkillBodyHandler).toBeTypeOf('function');

      const result = await readSkillBodyHandler({}, 'project-1', 'agent-1', skillPath);

      expect(result).toEqual({
        body: '# Review\n\nUse the review checklist.',
        mtimeMs: expect.any(Number),
      });
      expect(captureConversationSystemContextSnapshotMock).toHaveBeenCalledWith({
        projectPath: tempProjectPath,
        sceneId: 'general',
        promptSnapshot: '',
      });
    } finally {
      fs.rmSync(tempProjectPath, { recursive: true, force: true });
    }
  });

  it('does not read Skill body when effective visibility is not user-invocable', async () => {
    const tempProjectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-skill-body-deny-test-'));
    const skillDir = path.join(tempProjectPath, '.cdf', 'skills', 'blocked');
    const skillPath = path.join(skillDir, 'SKILL.md');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      skillPath,
      [
        '---',
        'name: blocked',
        'description: Blocked workflow',
        '---',
        '',
        '# Blocked',
        '',
        'Do not expose this.',
      ].join('\n'),
      'utf-8'
    );
    listResolvedSkillViewsMock.mockReturnValue([{ skillPath, userInvocable: false }]);
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: vi.fn(() => sql.includes('FROM projects') ? { path: tempProjectPath, scene: 'general' } : null),
      all: vi.fn(() => []),
      run: vi.fn(),
    }));

    try {
      registerIpcHandlers();
      const readSkillBodyHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'commands:readSkillBody')?.[1];
      expect(readSkillBodyHandler).toBeTypeOf('function');

      const result = await readSkillBodyHandler({}, 'project-1', 'agent-1', skillPath);

      expect(result).toEqual({ body: '', mtimeMs: 0 });
    } finally {
      fs.rmSync(tempProjectPath, { recursive: true, force: true });
    }
  });

  it('uses the Scene Skill Set for commands:list', async () => {
    const sceneSkillSet = [{ name: 'review', userInvocable: true }];
    captureConversationSystemContextSnapshotMock.mockReturnValueOnce({
      promptSnapshot: '',
      skillSnapshot: sceneSkillSet,
    });
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: vi.fn(() => sql.includes('FROM projects') ? { path: '/tmp/project', scene: 'research' } : null),
      all: vi.fn(() => []),
      run: vi.fn(),
    }));

    registerIpcHandlers();
    const listCommandsHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'commands:list')?.[1];
    await listCommandsHandler({}, 'project-1', 'agent-1');

    expect(resolveAgentSkillConfigOptionsMock).not.toHaveBeenCalled();
    expect(captureConversationSystemContextSnapshotMock).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      sceneId: 'research',
      promptSnapshot: '',
    });
    expect(collectAllCommandsMock).toHaveBeenCalledWith('/tmp/project', 'agent-1', {}, sceneSkillSet);
  });
});
