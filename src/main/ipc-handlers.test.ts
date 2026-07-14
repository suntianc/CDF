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
  collectAllCommandsMock,
  ensureProjectWatcherMock,
  resolveAgentSkillConfigOptionsMock,
  listResolvedSkillViewsMock,
  savePhysicalSkillMock,
  importPhysicalSkillDirectoryMock,
  initializeScenePresetMock,
  shellOpenExternalMock,
  startAISubscriptionLoginMock,
  pollAISubscriptionLoginMock,
  deleteConversationMock,
  deleteProjectMock,
} = vi.hoisted(() => ({
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
  collectAllCommandsMock: vi.fn(async () => ({ commands: [], conflicts: [], warnings: [] })),
  ensureProjectWatcherMock: vi.fn(),
  resolveAgentSkillConfigOptionsMock: vi.fn(() => ({ options: undefined as Record<string, unknown> | undefined, warnings: [] as string[] })),
  listResolvedSkillViewsMock: vi.fn(() => [] as Array<Record<string, unknown>>),
  savePhysicalSkillMock: vi.fn(),
  importPhysicalSkillDirectoryMock: vi.fn(),
  initializeScenePresetMock: vi.fn(),
  shellOpenExternalMock: vi.fn(async () => undefined),
  startAISubscriptionLoginMock: vi.fn(),
  pollAISubscriptionLoginMock: vi.fn(),
  deleteConversationMock: vi.fn(),
  deleteProjectMock: vi.fn(),
}));

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
    set: vi.fn(),
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

vi.mock('./conversation-deletion', () => ({
  deleteConversation: deleteConversationMock,
  deleteProject: deleteProjectMock,
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
  resolveAgentSkillConfigOptions: resolveAgentSkillConfigOptionsMock,
  savePhysicalSkill: savePhysicalSkillMock,
  importPhysicalSkillDirectory: importPhysicalSkillDirectoryMock,
  deletePhysicalSkill: vi.fn(),
}));

vi.mock('./deepagent/mcp-connector', () => ({
  createMcpClient: vi.fn(),
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
    collectAllCommandsMock.mockResolvedValue({ commands: [], conflicts: [], warnings: [] });
    ensureProjectWatcherMock.mockClear();
    resolveAgentSkillConfigOptionsMock.mockReturnValue({ options: undefined, warnings: [] });
    listResolvedSkillViewsMock.mockReturnValue([]);
    savePhysicalSkillMock.mockReset();
    importPhysicalSkillDirectoryMock.mockReset();
    initializeScenePresetMock.mockReset();
    shellOpenExternalMock.mockClear();
    startAISubscriptionLoginMock.mockReset();
    pollAISubscriptionLoginMock.mockReset();
    deleteConversationMock.mockReset();
    deleteProjectMock.mockReset();
  });

  it('registers exactly the channels declared in the IPC contract — no missing, no ghosts', () => {
    // registerIpcHandlers 内部级联调用 workflow / at-mention / knowledge 注册入口，
    // 因此这里收集到的是全部 4 个注册文件的并集。
    registerIpcHandlers();
    const registered = [...new Set(ipcHandleMock.mock.calls.map(([channel]) => channel))].sort();
    const declared = [...IPC_INVOKE_CHANNELS].sort();
    expect(registered).toEqual(declared);
  });

  it('builds dynamic event channel names through the shared factories', () => {
    expect(llmChunkChannel('req-1')).toBe('llm:chunk-req-1');
    expect(parallelTaskStepChannel('session-9')).toBe('agent:parallel-task-step-session-9');
  });

  it('exposes only safe Conversation storage status through IPC', () => {
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

    const result = chatHandler({ sender: 'web-contents' }, 'request-1', { sessionId: 'session-1' });

    expect(result).toEqual({ ok: true });
    expect(runLLMChatMock).toHaveBeenCalledWith('web-contents', 'request-1', { sessionId: 'session-1' });
  });

  it('should throw an error in db:saveAgent if agent name contains non-English characters', async () => {
    registerIpcHandlers();
    const saveAgentHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:saveAgent')?.[1];
    expect(saveAgentHandler).toBeTypeOf('function');

    // Invalid names
    expect(() => saveAgentHandler({}, { name: '智能代理', id: 'agent-1' })).toThrow(
      'Agent name must contain only English characters, numbers, spaces, hyphens, or underscores.'
    );
    expect(() => saveAgentHandler({}, { name: 'Agent 代理', id: 'agent-1' })).toThrow(
      'Agent name must contain only English characters, numbers, spaces, hyphens, or underscores.'
    );

    // Valid names should not throw name validation error.
    // include `all` because ensureUniqueSlug (now called by db:saveAgent
    // for both INSERT and UPDATE branches, PR #5) does a
    // `db.prepare(...).all(...)` for the project-scoped collision check.
    dbPrepareMock.mockReturnValue({
      get: vi.fn(() => null),
      run: vi.fn(),
      all: vi.fn(() => []),
    });
    const result = saveAgentHandler({}, { 
      id: 'agent-1', 
      project_id: 'proj-1', 
      name: 'Smart Agent 123-_', 
      is_default: false 
    });
    expect(result.name).toBe('Smart Agent 123-_');
  });

  it('persists project and qualified additional Skill preload references in db:saveAgent', () => {
    const insertedSkillNames: string[] = [];
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: vi.fn(() => null),
      all: vi.fn(() => []),
      run: vi.fn((...args: unknown[]) => {
        if (sql.includes('INSERT INTO agent_skills')) {
          insertedSkillNames.push(String(args[1]));
        }
      }),
    }));

    registerIpcHandlers();
    const saveAgentHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:saveAgent')?.[1];
    expect(saveAgentHandler).toBeTypeOf('function');

    saveAgentHandler({}, {
      id: 'agent-1',
      project_id: 'proj-1',
      name: 'Preload Agent',
      is_default: false,
      skillNames: [
        'global:teach',
        'project:review',
        'project-additional:docs:review',
        'project-additional:docs:review',
      ],
    });

    expect(insertedSkillNames).toEqual([
      'global:teach',
      'project:review',
      'project-additional:docs:review',
    ]);
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

  it('creates the protected General-purpose Agent together with a Project', () => {
    const insertedAgents: unknown[][] = [];
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: vi.fn(),
      all: vi.fn(() => []),
      run: vi.fn((...args: unknown[]) => {
        if (sql.includes('INSERT INTO agents')) insertedAgents.push(args);
      }),
    }));

    registerIpcHandlers();
    const createProjectHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:createProject')?.[1];
    const project = createProjectHandler({}, 'CDF', '/tmp/cdf', 'general');

    expect(insertedAgents).toHaveLength(1);
    expect(insertedAgents[0]).toEqual(expect.arrayContaining([
      project.id,
      'General-purpose',
      'general-purpose',
    ]));
  });

  it('rejects deleting the protected General-purpose Agent through IPC', () => {
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: vi.fn(() => sql.includes('SELECT slug FROM agents')
        ? { slug: 'general-purpose' }
        : undefined),
      all: vi.fn(() => []),
      run: vi.fn(),
    }));

    registerIpcHandlers();
    const deleteAgentHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'db:deleteAgent')?.[1];

    expect(() => deleteAgentHandler({}, 'general-1')).toThrow(
      'General-purpose Agent is protected and cannot be deleted',
    );
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
      get: vi.fn(() => sql.includes('FROM projects') ? { path: tempProjectPath } : null),
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
      expect(listResolvedSkillViewsMock).toHaveBeenCalledWith(tempProjectPath, {});
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
      get: vi.fn(() => sql.includes('FROM projects') ? { path: tempProjectPath } : null),
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

  it('passes User and Agent Skill Overrides into commands:list', async () => {
    const agentConfig = JSON.stringify({
      skillOverrides: {
        'docs:review': 'user-invocable-only',
      },
    });
    storeGetMock.mockImplementation((key?: string) =>
      key === 'skillOverrides' ? { review: 'off' } : undefined
    );
    resolveAgentSkillConfigOptionsMock.mockReturnValueOnce({
      options: {
        userOverrides: {
          review: 'off',
        },
        agentOverrides: {
          'docs:review': 'user-invocable-only',
        },
      },
      warnings: [],
    });
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: vi.fn((...args: unknown[]) => {
        if (sql.includes('SELECT path FROM projects')) return { path: '/tmp/project' };
        if (sql.includes('SELECT config FROM agents')) {
          expect(args).toEqual(['agent-1', 'project-1']);
          return {
            config: agentConfig,
          };
        }
        return null;
      }),
      all: vi.fn(() => []),
      run: vi.fn(),
    }));

    registerIpcHandlers();
    const listCommandsHandler = ipcHandleMock.mock.calls.find(([channel]) => channel === 'commands:list')?.[1];
    expect(listCommandsHandler).toBeTypeOf('function');

    await listCommandsHandler({}, 'project-1', 'agent-1');

    expect(resolveAgentSkillConfigOptionsMock).toHaveBeenCalledWith(agentConfig, expect.any(Function));
    expect(collectAllCommandsMock).toHaveBeenCalledWith('/tmp/project', 'agent-1', {
      userOverrides: {
        review: 'off',
      },
      agentOverrides: {
        'docs:review': 'user-invocable-only',
      },
    });
  });
});
