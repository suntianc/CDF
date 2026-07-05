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
} = vi.hoisted(() => ({
  ipcHandleMock: vi.fn(),
  runLLMChatMock: vi.fn(),
  fetchOllamaModelsMock: vi.fn(),
  stopLLMChatMock: vi.fn(),
  resolveLLMApprovalMock: vi.fn(),
  dbPrepareMock: vi.fn(() => ({
    all: vi.fn(() => []),
    get: vi.fn(),
    run: vi.fn(),
  })),
  storeGetMock: vi.fn(),
  collectAllCommandsMock: vi.fn(async () => ({ commands: [], conflicts: [], warnings: [] })),
  ensureProjectWatcherMock: vi.fn(),
  resolveAgentSkillConfigOptionsMock: vi.fn(() => ({ options: undefined, warnings: [] })),
  listResolvedSkillViewsMock: vi.fn(() => []),
  savePhysicalSkillMock: vi.fn(),
  importPhysicalSkillDirectoryMock: vi.fn(),
  initializeScenePresetMock: vi.fn(),
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
}));

vi.mock('./store', () => ({
  default: {
    get: storeGetMock,
    set: vi.fn(),
  },
}));

vi.mock('./database', () => ({
  default: {
    prepare: dbPrepareMock,
    transaction: vi.fn((fn) => fn),
  },
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
