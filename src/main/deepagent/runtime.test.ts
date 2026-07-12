import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DELEGATED_TASK_RESULT_SCHEMA } from '../../shared/types';

const {
  createDeepAgentMock,
  fromConnStringMock,
  checkpointGetTupleMock,
  dbPrepareMock,
  storeGetMock,
  getScopePathMock,
  getBuiltInSkillDirsMock,
  resolveAgentSkillsConfigMock,
  resolveAgentSkillConfigOptionsMock,
  buildCdfSkillsRuntimeMock,
  loadMcpToolsMock,
  registerHarnessProfileMock,
  getRunBySessionIdMock,
} = vi.hoisted(() => ({
  createDeepAgentMock: vi.fn(() => ({ streamEvents: vi.fn() })),
  getRunBySessionIdMock: vi.fn(),
  fromConnStringMock: vi.fn(),
  checkpointGetTupleMock: vi.fn(),
  dbPrepareMock: vi.fn(),
  storeGetMock: vi.fn((key?: string): unknown => key === 'skillOverrides' ? {} : 'strict'),
  getScopePathMock: vi.fn((_projectPath: string, scope: string) =>
    scope === 'global' ? path.join(os.tmpdir(), 'cdf-runtime-test-global-skills') : path.join(_projectPath, '.cdf', 'skills')
  ),
  getBuiltInSkillDirsMock: vi.fn(() => [path.join(os.tmpdir(), 'cdf-built-in-skills', 'knowledge-base')]),
  loadMcpToolsMock: vi.fn(async () => ({ client: null, tools: [] as Array<{ name: string }> })),
  registerHarnessProfileMock: vi.fn(),
  resolveAgentSkillsConfigMock: vi.fn(() => ({
    skillsSources: ['/.cdf/skills'],
    permissions: [{ operations: ['read', 'write'], paths: ['/*', '/**/*'] }],
  })),
  resolveAgentSkillConfigOptionsMock: vi.fn((): any => ({
    options: undefined,
    warnings: [],
  })),
  buildCdfSkillsRuntimeMock: vi.fn(() => ({
    skills: [],
    prompt: '## Skills System\n\nCDF-owned skills prompt',
    warnings: [],
  })),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => path.join(os.tmpdir(), 'cdf-runtime-test-user-data')),
  },
}));

vi.mock('@langchain/langgraph-checkpoint-sqlite', () => ({
  SqliteSaver: {
    fromConnString: fromConnStringMock,
  },
}));

vi.mock('deepagents', () => ({
  createDeepAgent: createDeepAgentMock,
  registerHarnessProfile: registerHarnessProfileMock,
  FilesystemBackend: class FilesystemBackend {
    options: unknown;
    constructor(options: unknown) {
      this.options = options;
    }
  },
  CompositeBackend: class CompositeBackend {
    options: unknown;
    constructor(primary: unknown, secondary: unknown) {
      this.options = { primary, secondary };
    }
  },
  StateBackend: class StateBackend {},
}));

vi.mock('../database', () => ({
  default: {
    prepare: dbPrepareMock,
  },
}));

vi.mock('../store', () => ({
  default: {
    get: storeGetMock,
    set: vi.fn(),
  },
}));

vi.mock('../security', () => ({
  encryptApiKey: vi.fn((value: string) => value),
  decryptApiKey: vi.fn((value: string) => value),
}));

vi.mock('./llm-adapter', () => ({
  createLangChainModel: vi.fn((config: { defaultModel: string; model?: string; providerType: string }) => ({
    model: config.model || config.defaultModel,
    providerType: config.providerType,
  })),
}));

vi.mock('./mcp-connector', () => ({
  loadMcpTools: loadMcpToolsMock,
}));

vi.mock('./skill-manager', () => ({
  getBuiltInSkillDirs: getBuiltInSkillDirsMock,
  getScopePath: getScopePathMock,
  resolveAgentSkillsConfig: resolveAgentSkillsConfigMock,
  resolveAgentSkillConfigOptions: resolveAgentSkillConfigOptionsMock,
}));

vi.mock('./skills-runtime/cdf-skills-runtime', () => ({
  buildCdfSkillsRuntime: buildCdfSkillsRuntimeMock,
}));

// 保留真实的 workflow-run 工具工厂（createAdvanceStageTool / createTaskGraphTools），
// 只让 getRunBySessionId 可控——用于区分 workflow session 与普通对话。
vi.mock('../workflow-run', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../workflow-run')>();
  return { ...actual, getRunBySessionId: getRunBySessionIdMock };
});

import { createDeepAgentRuntime } from './runtime';
import { createLangChainModel } from './llm-adapter';
import { createStreamAccumulator, runWithStreamAccumulator } from './stream-accumulator';

interface CreateDeepAgentParams {
  model?: unknown;
  systemPrompt?: string;
  tools: Array<{ name: string }>;
  subagents?: unknown;
  interruptOn?: Record<string, unknown>;
}

function firstCreateDeepAgentParams(): CreateDeepAgentParams {
  const firstCall = createDeepAgentMock.mock.calls[0] as unknown[];
  expect(firstCall).toBeTruthy();
  return firstCall[0] as CreateDeepAgentParams;
}

describe('createDeepAgentRuntime', () => {
  const tempProjectPath = path.join(os.tmpdir(), `cdf-runtime-test-${Math.random().toString(36).slice(2)}`);
  const agent = {
    id: 'agent-1',
    project_id: 'project-1',
    name: 'Master Agent',
    provider_id: 'provider-1',
    system_prompt: 'System prompt',
    config: null,
    is_default: 1,
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  const provider = {
    id: 'provider-1',
    api_key: 'encrypted-key',
    api_url: 'http://localhost:11434',
    default_model: 'llama3',
    provider_type: 'ollama',
  };
  const agent2 = {
    ...agent,
    id: 'agent-2',
    provider_id: 'provider-2',
    system_prompt: 'Agent 2 prompt',
    is_default: 0,
  };
  const provider2 = {
    ...provider,
    id: 'provider-2',
    default_model: 'llama4',
  };

  beforeEach(() => {
    fs.rmSync(tempProjectPath, { recursive: true, force: true });
    fs.mkdirSync(tempProjectPath, { recursive: true });
    fs.writeFileSync(path.join(tempProjectPath, 'AGENTS.md'), 'Must use Chinese.', 'utf-8');

    vi.clearAllMocks();
    storeGetMock.mockImplementation((key?: string) =>
      key === 'skillOverrides' ? {} : 'strict'
    );
    resolveAgentSkillConfigOptionsMock.mockReturnValue({
      options: undefined,
      warnings: [],
    });
    getRunBySessionIdMock.mockReturnValue(undefined);
    const checkpointer = { getTuple: checkpointGetTupleMock };
    fromConnStringMock.mockReturnValue(checkpointer);
    checkpointGetTupleMock.mockResolvedValue(undefined);
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: (arg?: string) => {
        if (sql.includes('FROM projects')) return { id: 'project-1', name: 'Project CDF', path: tempProjectPath };
        if (sql.includes('FROM agents WHERE id')) return arg === 'agent-2' ? agent2 : undefined;
        if (sql.includes('FROM llm_providers WHERE id')) {
          if (arg === 'provider-1') return provider;
          if (arg === 'provider-2') return provider2;
          return undefined;
        }
        return undefined;
      },
      all: (arg?: string) => {
        if (sql.includes('FROM agents') && sql.includes('is_default = 1')) return [agent];
        if (sql.includes('FROM agent_skills')) return [{ skill_name: arg === 'agent-2' ? 'project:sub-skill' : 'project:test-skill' }];
        if (sql.includes('FROM messages')) {
          return [
            { id: 'old-user', role: 'user', content: '旧问题' },
            { id: 'old-assistant', role: 'assistant', content: '旧回答' },
          ];
        }
        if (sql.includes('FROM mcp_servers')) return [];
        return [];
      },
      run: vi.fn(),
    }));
  });

  afterEach(() => {
    fs.rmSync(tempProjectPath, { recursive: true, force: true });
  });

  it('should wire checkpointer, memory, virtual backend, and permissions into deepagents', async () => {
    await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: '新问题' });

    expect(fromConnStringMock).toHaveBeenCalledWith(expect.stringContaining('deepagents-checkpoints.db'));
    expect(createDeepAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpointer: expect.objectContaining({ getTuple: checkpointGetTupleMock }),
        memory: [path.join(tempProjectPath, 'AGENTS.md')],
        permissions: [{ operations: ['read', 'write'], paths: ['/*', '/**/*'] }],
      })
    );
    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    expect(params.backend.options.secondary['/'].options).toEqual({ rootDir: '/', virtualMode: false });
    expect(checkpointGetTupleMock).toHaveBeenCalledWith({
      configurable: {
        thread_id: 'session-1',
        checkpoint_ns: '',
      },
    });
    expect(registerHarnessProfileMock).toHaveBeenCalledWith('llama3', expect.objectContaining({
      generalPurposeSubagent: { enabled: false },
      excludedTools: [],  // D-15: task tool enabled
    }));
    expect(params.systemPrompt).toContain('所有文件工具（ls、read_file、write_file、edit_file、glob、grep、delete_file）请使用绝对路径');
    expect(params.systemPrompt).toContain(tempProjectPath + '/src/main.ts');
    expect(params.systemPrompt).toContain('必须在当前轮次继续调用合适的文件工具');
    expect(params.systemPrompt).toContain(tempProjectPath);
    expect(params.systemPrompt).toContain('全局 Skill 写入 `~/.cdf/skills/{skill名称}/SKILL.md`（对所有项目默认可见）');
    expect(params.systemPrompt).toContain('Agent 选择 Skill 只表示预加载或强调，不表示访问授权');
    expect(params.systemPrompt).toContain('CDF-owned skills prompt');
    expect(params.systemPrompt).toContain(
      'Text-to-image or image-to-image via MiniMax Token Plan or Codex OAuth.'
    );
    expect(params.skills).toBeUndefined();
    expect(buildCdfSkillsRuntimeMock).toHaveBeenCalledWith(tempProjectPath, expect.objectContaining({
      builtInSkillDirs: [path.join(os.tmpdir(), 'cdf-built-in-skills', 'knowledge-base')],
      preloadSkillNames: ['test-skill'],
    }));
    expect(params.systemPrompt).not.toContain('绑定后才可见');
    expect(params.systemPrompt).not.toContain('Knowledge Base 使用规范');
    expect(params.systemPrompt).not.toContain('knowledge_search');
    expect(params.systemPrompt).not.toContain('[可委派 Agent]');
    expect(params.subagents).toBeUndefined();
    expect(params.tools.map((tool: { name: string }) => tool.name)).toContain('delete_file');
    expect(params.interruptOn.delete_file).toEqual({ allowedDecisions: ['approve', 'reject'] });
    expect(params.interruptOn.remove_file).toBeUndefined();
    expect(loadMcpToolsMock).toHaveBeenCalledWith('agent-1', [], []);
  });

  it('should omit interruptOn when global approval mode is bypass', async () => {
    storeGetMock.mockReturnValue('bypass');

    await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: '新问题' });

    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    expect(params.interruptOn).toBeUndefined();
  });

  it('adds loaded MCP tools to the approval boundary in non-bypass mode', async () => {
    loadMcpToolsMock.mockResolvedValueOnce({
      client: null,
      tools: [{ name: 'alpha__search' }],
    });

    await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: '新问题' });

    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    expect(params.interruptOn.alpha__search).toEqual({ allowedDecisions: ['approve', 'reject'] });
  });

  it('should bootstrap old messages when no checkpoint exists', async () => {
    const runtime = await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: '新问题' });

    expect(runtime.inputMessages).toEqual([
      { role: 'user', content: '旧问题' },
      { role: 'assistant', content: '旧回答' },
      { role: 'user', content: '新问题' },
    ]);
  });

  it('should only send the current user message when checkpoint exists', async () => {
    checkpointGetTupleMock.mockResolvedValue({ checkpoint: { id: 'checkpoint-1' } });

    const runtime = await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: '新问题' });

    expect(runtime.inputMessages).toEqual([{ role: 'user', content: '新问题' }]);
  });

  it('should use the requested agent and pass its skill selections as preload hints', async () => {
    const runtime = await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: '新问题' }, 'agent-2');

    expect(runtime.agentId).toBe('agent-2');
    expect(resolveAgentSkillsConfigMock).toHaveBeenCalledWith(tempProjectPath, ['project:sub-skill']);
    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    expect(params.systemPrompt).toContain('Agent 2 prompt');
    expect(params.subagents).toBeUndefined();
  });

  it('resolves MiniMax Token Plan through Anthropic/Claude-compatible MiniMax runtime', async () => {
    storeGetMock.mockImplementation((key?: string) => {
      if (key === 'skillOverrides') return {};
      if (key === 'aiSubscriptions') return { entries: { 'minimax-token-plan': { status: 'connected' } } };
      if (key === 'aiSubscriptionSecrets') return { 'minimax-token-plan': 'sk-minimax' };
      return 'strict';
    });

    await createDeepAgentRuntime(
      'project-1',
      'session-1',
      { id: 'message-1', content: '新问题' },
      'agent-1',
      { modelSource: 'ai_subscription', sourceId: 'minimax-token-plan', model: 'MiniMax-M2.7' }
    );

    expect(vi.mocked(createLangChainModel)).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'sk-minimax',
      apiUrl: 'https://api.minimaxi.com/anthropic',
      providerType: 'minimax',
      model: 'MiniMax-M2.7',
      contextLimit: 204_800,
    }));
  });

  it.each([
    [
      'logged-out',
      {
        entries: {
          'minimax-token-plan': { status: 'logged_out' },
        },
      },
      'MiniMax-M2.7',
    ],
    [
      'expired',
      {
        entries: {
          'minimax-token-plan': { status: 'expired' },
        },
      },
      'MiniMax-M2.7',
    ],
    [
      'unavailable',
      {
        entries: {
          'minimax-token-plan': { status: 'unavailable' },
        },
      },
      'MiniMax-M2.7',
    ],
    [
      'unsupported selected model',
      {
        entries: {
          'minimax-token-plan': { status: 'connected' },
        },
      },
      'Missing subscription model',
    ],
  ])('returns a recoverable error for %s AI subscription model selections', async (_caseName, persistedState, model) => {
    storeGetMock.mockImplementation((key?: string) => {
      if (key === 'skillOverrides') return {};
      if (key === 'aiSubscriptions') return persistedState;
      if (key === 'aiSubscriptionSecrets') return { 'minimax-token-plan': 'sk-minimax' };
      return 'strict';
    });

    await expect(createDeepAgentRuntime(
      'project-1',
      'session-1',
      { id: 'message-1', content: '新问题' },
      'agent-1',
      {
        modelSource: 'ai_subscription',
        sourceId: 'minimax-token-plan',
        model,
      }
    )).rejects.toMatchObject({
      code: 'AI_SUBSCRIPTION_UNAVAILABLE',
      recoverable: true,
      messageKey: expect.stringMatching(/^settings\.aiSubscriptions\.runtimeError\./),
      message: expect.stringMatching(/^settings\.aiSubscriptions\.runtimeError\./),
    });
  });

  it('preserves qualified additional skill names when building preload hints', async () => {
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: (arg?: string) => {
        if (sql.includes('FROM projects')) return { id: 'project-1', name: 'Project CDF', path: tempProjectPath };
        if (sql.includes('FROM agents WHERE id')) return arg === 'agent-2' ? agent2 : undefined;
        if (sql.includes('FROM llm_providers WHERE id')) return arg === 'provider-2' ? provider2 : undefined;
        return undefined;
      },
      all: (arg?: string) => {
        if (sql.includes('FROM agent_skills')) {
          return arg === 'agent-2' ? [{ skill_name: 'project-additional:docs:review' }] : [];
        }
        if (sql.includes('FROM messages')) return [];
        if (sql.includes('FROM mcp_servers')) return [];
        return [];
      },
      run: vi.fn(),
    }));

    await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: '新问题' }, 'agent-2');

    expect(resolveAgentSkillsConfigMock).toHaveBeenCalledWith(tempProjectPath, ['project-additional:docs:review']);
    expect(buildCdfSkillsRuntimeMock).toHaveBeenCalledWith(tempProjectPath, expect.objectContaining({
      preloadSkillNames: ['docs:review'],
    }));
  });

  it('passes current message path mentions into CDF Skills Runtime for nested Skill ranking', async () => {
    await createDeepAgentRuntime(
      'project-1',
      'session-1',
      { id: 'message-1', content: '部署 @apps/web/src/App.tsx' },
      'agent-1'
    );

    expect(buildCdfSkillsRuntimeMock).toHaveBeenCalledWith(tempProjectPath, expect.objectContaining({
      pathContext: ['apps/web/src/App.tsx'],
    }));
  });

  it('passes user and agent skill overrides into runtime skill resolution', async () => {
    const agentWithOverrides = {
      ...agent,
      config: JSON.stringify({
        skillOverrides: {
          'agent-hidden': 'off',
        },
      }),
    };
    resolveAgentSkillConfigOptionsMock.mockReturnValueOnce({
      options: {
        userOverrides: {
          'user-hidden': 'off',
        },
        agentOverrides: {
          'agent-hidden': 'off',
        },
      },
      warnings: [],
    });
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: (arg?: string) => {
        if (sql.includes('FROM projects')) return { id: 'project-1', name: 'Project CDF', path: tempProjectPath };
        if (sql.includes('FROM llm_providers WHERE id')) {
          if (arg === 'provider-1') return provider;
          return undefined;
        }
        return undefined;
      },
      all: (arg?: string) => {
        if (sql.includes('FROM agents') && sql.includes('is_default = 1')) return [agentWithOverrides];
        if (sql.includes('FROM agent_skills')) return [{ skill_name: 'project:test-skill' }];
        if (sql.includes('FROM messages')) return [];
        if (sql.includes('FROM mcp_servers')) return [];
        return [];
      },
      run: vi.fn(),
    }));

    await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: '新问题' });

    expect(resolveAgentSkillConfigOptionsMock).toHaveBeenCalledWith(
      agentWithOverrides.config,
      expect.any(Function)
    );
    expect(resolveAgentSkillsConfigMock).toHaveBeenCalledWith(tempProjectPath, ['project:test-skill'], {
      userOverrides: {
        'user-hidden': 'off',
      },
      agentOverrides: {
        'agent-hidden': 'off',
      },
    });
  });

  it('should not fail runtime creation when harness profile registration rejects', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerHarnessProfileMock.mockImplementationOnce(() => {
      throw new Error('invalid profile key');
    });

    await expect(createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: '新问题' })).resolves.toEqual(
      expect.objectContaining({ agentId: 'agent-1' })
    );
    expect(createDeepAgentMock).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('should pass subagents to createDeepAgent when subagentIds provided', async () => {
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: (arg?: string) => {
        if (sql.includes('FROM projects')) return { id: 'project-1', name: 'Project CDF', path: tempProjectPath };
        if (sql.includes('FROM agents WHERE id')) {
          if (arg === 'agent-2') return { ...agent2, slug: 'code-agent' };
          if (arg === 'agent-1') return agent;
          return undefined;
        }
        if (sql.includes('FROM llm_providers')) {
          if (arg === 'provider-1') return provider;
          if (arg === 'provider-2') return provider2;
          return undefined;
        }
        return undefined;
      },
      all: (arg?: string) => {
        if (sql.includes('FROM agents') && sql.includes('is_default = 1')) return [agent];
        if (sql.includes('FROM agent_skills')) return [];
        if (sql.includes('FROM messages')) return [];
        if (sql.includes('FROM mcp_servers')) return [];
        return [];
      },
      run: vi.fn(),
    }));

    await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: 'test @apps/web/src/App.tsx' }, 'agent-1', undefined, ['agent-2']);

    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    expect(params.subagents).toBeDefined();
    expect(Array.isArray(params.subagents)).toBe(true);
    expect(params.subagents.length).toBeGreaterThan(0);
    expect(params.subagents[0].name).toBe('code-agent');  // D-03: slug as stable key
    expect(params.subagents[0].responseFormat).toBe(DELEGATED_TASK_RESULT_SCHEMA);  // D-10
    expect(params.subagents[0].model).toEqual({ model: 'llama4', providerType: 'ollama' });
    expect(params.subagents[0].modelProvider).toBeUndefined();
    expect(params.subagents[0].middleware.map((item: { name?: string }) => item.name)).toEqual(
      expect.arrayContaining(['RecoverableToolErrorMiddleware', 'toolRetryMiddleware', 'modelRetryMiddleware'])
    );
  });

  it('should wire subagent skill selections through the CDF Skills Runtime prompt', async () => {
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: (arg?: string) => {
        if (sql.includes('FROM projects')) return { id: 'project-1', name: 'Project CDF', path: tempProjectPath };
        if (sql.includes('FROM agents WHERE id')) {
          if (arg === 'agent-2') return { ...agent2, slug: 'code-agent' };
          if (arg === 'agent-1') return agent;
          return undefined;
        }
        if (sql.includes('FROM llm_providers')) {
          if (arg === 'provider-1') return provider;
          if (arg === 'provider-2') return provider2;
          return undefined;
        }
        return undefined;
      },
      all: (arg?: string) => {
        if (sql.includes('FROM agents') && sql.includes('is_default = 1')) return [agent];
        if (sql.includes('FROM agent_skills')) return arg === 'agent-2' ? [{ skill_name: 'project:sub-skill' }] : [];
        if (sql.includes('FROM messages')) return [];
        if (sql.includes('FROM mcp_servers')) return [];
        return [];
      },
      run: vi.fn(),
    }));

    await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: 'test @apps/web/src/App.tsx' }, 'agent-1', undefined, ['agent-2']);

    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    expect(params.subagents[0].systemPrompt).toContain('Agent 2 prompt');
    expect(params.subagents[0].systemPrompt).toContain('CDF-owned skills prompt');
    expect(params.subagents[0].skills).toBeUndefined();
    expect(buildCdfSkillsRuntimeMock).toHaveBeenCalledWith(tempProjectPath, expect.objectContaining({
      preloadSkillNames: ['sub-skill'],
      pathContext: ['apps/web/src/App.tsx'],
    }));
  });

  it('should pass MiniMax subagent models as model instances instead of provider strings', async () => {
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: (arg?: string) => {
        if (sql.includes('FROM projects')) return { id: 'project-1', name: 'Project CDF', path: tempProjectPath };
        if (sql.includes('FROM agents WHERE id')) {
          if (arg === 'agent-2') return { ...agent2, slug: 'minimax-agent' };
          if (arg === 'agent-1') return agent;
          return undefined;
        }
        if (sql.includes('FROM llm_providers')) {
          if (arg === 'provider-1') return provider;
          if (arg === 'provider-2') {
            return {
              ...provider2,
              provider_type: 'minimax',
              api_url: 'https://api.minimaxi.com/anthropic/v1',
              default_model: 'MiniMax-M2.7-highspeed',
            };
          }
          return undefined;
        }
        return undefined;
      },
      all: (arg?: string) => {
        if (sql.includes('FROM agents') && sql.includes('is_default = 1')) return [agent];
        if (sql.includes('FROM agent_skills')) return [];
        if (sql.includes('FROM messages')) return [];
        if (sql.includes('FROM mcp_servers')) return [];
        return [];
      },
      run: vi.fn(),
    }));

    await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: 'test' }, 'agent-1', undefined, ['agent-2']);

    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    expect(params.subagents[0].model).toEqual({ model: 'MiniMax-M2.7-highspeed', providerType: 'minimax' });
    expect(params.subagents[0].modelProvider).toBeUndefined();
  });

  it('should convert task tool errors into failure ToolMessages for the main agent', async () => {
    await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: 'test' });

    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    const recoverableMiddleware = params.middleware.find((item: { name?: string }) => item.name === 'RecoverableToolErrorMiddleware');
    const result = await recoverableMiddleware.wrapToolCall(
      {
        toolCall: { id: 'tool-call-1', name: 'task', args: {} },
        runtime: { signal: { aborted: false } },
        state: {},
      },
      async () => {
        throw new Error('Subagent agent failed');
      }
    );

    expect(result.tool_call_id).toBe('tool-call-1');
    expect(JSON.parse(result.content)).toEqual({
      status: 'failure',
      artifacts: [],
      summary: '子代理执行失败，主 Agent 需要根据错误继续决策。',
      error: { code: 'TOOL_FAILED', message: 'Subagent agent failed' },
    });
  });

  it('blocks main-agent tool calls that are outside runtime allowedTools overrides', async () => {
    await createDeepAgentRuntime(
      'project-1',
      'session-1',
      { id: 'message-1', content: 'test' },
      'agent-1',
      { allowedTools: ['read_file'] }
    );

    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    const allowlistMiddleware = params.middleware.find((item: { name?: string }) => item.name === 'AllowedToolsMiddleware');

    const blocked = await allowlistMiddleware.wrapToolCall(
      {
        toolCall: { id: 'tool-call-1', name: 'bash', args: {} },
        runtime: { signal: { aborted: false } },
        state: {},
      },
      async () => {
        throw new Error('handler should not be called');
      }
    );

    expect(blocked.tool_call_id).toBe('tool-call-1');
    expect(blocked.content).toContain('Tool blocked by allowed-tools');
    expect(blocked.content).toContain('bash');

    await expect(
      allowlistMiddleware.wrapToolCall(
        {
          toolCall: { id: 'tool-call-2', name: 'read_file', args: {} },
          runtime: { signal: { aborted: false } },
          state: {},
        },
        async () => 'ok'
      )
    ).resolves.toBe('ok');
  });

  it('applies runtime allowedTools overrides to subagent tool calls as well', async () => {
    await createDeepAgentRuntime(
      'project-1',
      'session-1',
      { id: 'message-1', content: 'test' },
      'agent-1',
      { allowedTools: ['read_file'] },
      ['agent-2']
    );

    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    const allowlistMiddleware = params.subagents[0].middleware.find((item: { name?: string }) => item.name === 'AllowedToolsMiddleware');
    const blocked = await allowlistMiddleware.wrapToolCall(
      {
        toolCall: { id: 'sub-tool-call-1', name: 'grep', args: {} },
        runtime: { signal: { aborted: false } },
        state: {},
      },
      async () => 'should not run'
    );

    expect(blocked.tool_call_id).toBe('sub-tool-call-1');
    expect(blocked.content).toContain('grep');
  });

  it('should let subagents observe tool failures instead of crashing their graph', async () => {
    await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: 'test' }, 'agent-1', undefined, ['agent-2']);

    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    const retryMiddleware = params.subagents[0].middleware.find((item: { name?: string }) => item.name === 'toolRetryMiddleware');
    const result = await retryMiddleware.wrapToolCall(
      {
        toolCall: { id: 'sub-tool-call-1', name: 'read_file', args: {} },
        tool: { name: 'read_file' },
        runtime: { signal: { aborted: false } },
        state: {},
      },
      async () => {
        throw new Error('ENOENT: no such file or directory');
      }
    );

    expect(result.tool_call_id).toBe('sub-tool-call-1');
    expect(result.content).toContain('Tool error (NOT_FOUND)');
    expect(result.content).toContain('subagent run is still active');
  });

  it('should let subagent tool approval interrupts bubble to the approval flow', async () => {
    await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: 'test' }, 'agent-1', undefined, ['agent-2']);

    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    const recoverableMiddleware = params.subagents[0].middleware.find((item: { name?: string }) => item.name === 'RecoverableToolErrorMiddleware');
    const approvalInterrupt = Object.assign(new Error('Tool execution requires approval'), {
      name: 'GraphInterrupt',
      interrupts: [
        {
          id: 'approval-interrupt-1',
          value: {
            actionRequests: [
              {
                name: 'edit_file',
                args: { file_path: '/test.tsx', old_string: 'a', new_string: 'b' },
                description: 'Tool execution requires approval',
              },
            ],
            reviewConfigs: [
              {
                actionName: 'edit_file',
                allowedDecisions: ['approve', 'edit', 'reject'],
              },
            ],
          },
        },
      ],
    });

    await expect(
      recoverableMiddleware.wrapToolCall(
        {
          toolCall: { id: 'sub-tool-call-approval', name: 'edit_file', args: {} },
          runtime: { signal: { aborted: false } },
          state: {},
        },
        async () => {
          throw approvalInterrupt;
        }
      )
    ).rejects.toBe(approvalInterrupt);
  });

  it('should let UNKNOWN approval payload errors bubble to the approval flow', async () => {
    await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: 'test' }, 'agent-1', undefined, ['agent-2']);

    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    const recoverableMiddleware = params.subagents[0].middleware.find((item: { name?: string }) => item.name === 'RecoverableToolErrorMiddleware');
    const approvalPayload = [
      {
        id: 'approval-interrupt-1',
        value: {
          actionRequests: [
            {
              name: 'write_file',
              args: { file_path: '/test.tsx', content: 'test' },
              description: 'Tool execution requires approval',
            },
          ],
          reviewConfigs: [
            {
              actionName: 'write_file',
              allowedDecisions: ['approve', 'edit', 'reject'],
            },
          ],
        },
      },
    ];
    const approvalInterrupt = new Error(`UNKNOWN\n${JSON.stringify(approvalPayload)}`);

    await expect(
      recoverableMiddleware.wrapToolCall(
        {
          toolCall: { id: 'sub-tool-call-approval', name: 'write_file', args: {} },
          runtime: { signal: { aborted: false } },
          state: {},
        },
        async () => {
          throw approvalInterrupt;
        }
      )
    ).rejects.toBe(approvalInterrupt);
  });

  it('should emit paired span ids for subagent tool call and result steps', async () => {
    await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: 'test' }, 'agent-1', undefined, ['agent-2']);

    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    const stepMiddleware = params.subagents[0].middleware.find((item: { name?: string }) => item.name === 'SubagentStepMiddleware');
    const steps: any[] = [];

    await stepMiddleware.wrapToolCall(
      {
        toolCall: { id: 'sub-tool-call-step', name: 'read_file', args: { path: '/test.tsx' } },
        runtime: { signal: { aborted: false } },
        state: {},
      },
      async () => ({ content: 'file content' })
    );

    const context = { onStep: (step: any) => steps.push(step) };
    const { subagentStepStorage } = await import('./runtime');
    await subagentStepStorage.run(context, async () => {
      await stepMiddleware.wrapToolCall(
        {
          toolCall: { id: 'sub-tool-call-step', name: 'read_file', args: { path: '/test.tsx' } },
          runtime: { signal: { aborted: false } },
          state: {},
        },
        async () => ({ content: 'file content' })
      );
    });

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ type: 'tool_call', tool: 'read_file' });
    expect(steps[1]).toMatchObject({ type: 'tool_result', tool: 'read_file', success: true });
    expect(steps[0].spanId).toMatch(/^[0-9a-f]{8}$/);
    expect(steps[1].spanId).toBe(steps[0].spanId);
  });

  it('should emit subagent tool steps through the stream accumulator fallback', async () => {
    await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: 'test' }, 'agent-1', undefined, ['agent-2']);

    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    const stepMiddleware = params.subagents[0].middleware.find((item: { name?: string }) => item.name === 'SubagentStepMiddleware');
    const accumulator = createStreamAccumulator();
    const steps: any[] = [];
    accumulator.onSubagentStep = (step) => steps.push(step);

    await runWithStreamAccumulator(accumulator, async () => {
      await stepMiddleware.wrapToolCall(
        {
          toolCall: { id: 'sub-tool-call-fallback', name: 'grep', args: { pattern: 'hello' } },
          runtime: { signal: { aborted: false } },
          state: {},
        },
        async () => ({ content: 'match' })
      );
    });

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ type: 'tool_call', tool: 'grep', args: { pattern: 'hello' } });
    expect(steps[1]).toMatchObject({ type: 'tool_result', tool: 'grep', success: true, output: 'match' });
    expect(steps[1].spanId).toBe(steps[0].spanId);
  });

  it('should have task tool enabled when subagentIds provided (excludedTools: [])', async () => {
    await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: 'test' }, 'agent-1', undefined, ['agent-2']);

    expect(registerHarnessProfileMock).toHaveBeenCalledWith(
      'llama3',
      expect.objectContaining({
        excludedTools: [],  // D-15: task tool enabled
        generalPurposeSubagent: { enabled: false },  // D-05
      })
    );
  });

  it('should not pass subagents when subagentIds is empty', async () => {
    await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: 'test' }, 'agent-1', undefined, []);

    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    expect(params.subagents).toBeUndefined();
  });

  it('should not pass subagents when subagentIds is undefined', async () => {
    await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: 'test' }, 'agent-1', undefined);

    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    expect(params.subagents).toBeUndefined();
  });

  it('should use generated slug when agent.slug is null', async () => {
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: (arg?: string) => {
        if (sql.includes('FROM projects')) return { id: 'project-1', name: 'Project CDF', path: tempProjectPath };
        if (sql.includes('FROM agents WHERE id')) {
          if (arg === 'agent-2') return { ...agent2, slug: null, name: 'Code Agent' };  // slug is null
          if (arg === 'agent-1') return agent;
          return undefined;
        }
        if (sql.includes('FROM llm_providers')) {
          if (arg === 'provider-1') return provider;
          if (arg === 'provider-2') return provider2;
          return undefined;
        }
        return undefined;
      },
      all: (arg?: string) => {
        if (sql.includes('FROM agents') && sql.includes('is_default = 1')) return [agent];
        if (sql.includes('FROM agent_skills')) return [];
        if (sql.includes('FROM messages')) return [];
        if (sql.includes('FROM mcp_servers')) return [];
        return [];
      },
      run: vi.fn(),
    }));

    await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: 'test' }, 'agent-1', undefined, ['agent-2']);

    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    expect(params.subagents[0].name).toBe('code-agent');  // generated from 'Code Agent'
  });

  describe('workflow run session tooling', () => {
    const workflowRun = {
      id: 'run-1',
      workflow_id: 'wf-1',
      project_id: 'project-1',
      session_id: 'session-wf',
      master_agent_id: 'agent-1',
      status: 'running',
      current_stage_index: 0,
      total_stages: 1,
      stages: JSON.stringify([
        { id: 'stage-1', name: '调研', taskDescription: '调研任务', acceptanceCriteria: [], gateEnabled: true },
      ]),
      skeleton_snapshot: null,
      error: null,
      started_at: Date.now(),
      ended_at: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    it('injects advance_stage into the master Agent tools for a workflow run session', async () => {
      getRunBySessionIdMock.mockReturnValue(workflowRun);

      await createDeepAgentRuntime('project-1', 'session-wf', { id: 'message-1', content: '[系统指令] 请开始执行工作流' });

      const toolNames = firstCreateDeepAgentParams().tools.map((t) => t.name);
      expect(toolNames).toContain('advance_stage');
    });

    it('injects the Run Task Graph tools into the master Agent for a workflow run session', async () => {
      getRunBySessionIdMock.mockReturnValue(workflowRun);

      await createDeepAgentRuntime('project-1', 'session-wf', { id: 'message-1', content: '[系统指令] 请开始执行工作流' });

      const toolNames = firstCreateDeepAgentParams().tools.map((t) => t.name);
      expect(toolNames).toEqual(expect.arrayContaining([
        'create_task',
        'set_task_dependencies',
        'update_task_status',
        'list_tasks',
      ]));
    });

    it('always intercepts advance_stage even when the approval mode is bypass', async () => {
      storeGetMock.mockImplementation((key?: string) => (key === 'skillOverrides' ? {} : 'bypass'));
      getRunBySessionIdMock.mockReturnValue(workflowRun);

      await createDeepAgentRuntime('project-1', 'session-wf', { id: 'message-1', content: '[系统指令] 请开始执行工作流' });

      const interruptOn = firstCreateDeepAgentParams().interruptOn;
      expect(interruptOn).toBeDefined();
      expect(interruptOn).toHaveProperty('advance_stage');
    });

    it('does not inject workflow tools into a plain chat session', async () => {
      getRunBySessionIdMock.mockReturnValue(undefined);

      await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: '你好' });

      const params = firstCreateDeepAgentParams();
      const toolNames = params.tools.map((t) => t.name);
      expect(toolNames).not.toContain('advance_stage');
      expect(toolNames).not.toContain('create_task');
      expect(params.interruptOn ?? {}).not.toHaveProperty('advance_stage');
    });

    it('does not inject workflow tools when the session run belongs to a different master Agent', async () => {
      getRunBySessionIdMock.mockReturnValue({ ...workflowRun, master_agent_id: 'someone-else' });

      await createDeepAgentRuntime('project-1', 'session-wf', { id: 'message-1', content: '[系统指令] 请开始执行工作流' });

      const toolNames = firstCreateDeepAgentParams().tools.map((t) => t.name);
      expect(toolNames).not.toContain('advance_stage');
    });

    it('adds workflow discipline guidance referencing advance_stage to the system prompt', async () => {
      getRunBySessionIdMock.mockReturnValue(workflowRun);

      await createDeepAgentRuntime('project-1', 'session-wf', { id: 'message-1', content: '[系统指令] 请开始执行工作流' });

      const systemPrompt = firstCreateDeepAgentParams().systemPrompt ?? '';
      expect(systemPrompt).toContain('advance_stage');
    });
  });
});
