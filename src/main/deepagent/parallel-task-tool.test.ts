import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createDeepAgentMock,
  dbPrepareMock,
  storeGetMock,
  createLangChainModelMock,
  getProviderMock,
  getAgentMcpServersMock,
  getConnectedMcpServersMock,
  getAgentSkillNamesMock,
  createBuiltInToolsMock,
  loadRegistryToolsMock,
  loadMcpToolsMock,
  createSpanIdMock,
  createChildSpanMock,
  resolveInterruptOnMock,
  getRuntimeToolNamesMock,
  getScopePathMock,
  getBuiltInSkillDirsMock,
  resolveAgentSkillsConfigMock,
  resolveAgentSkillConfigOptionsMock,
  buildCdfSkillsRuntimeMock,
} = vi.hoisted(() => ({
  createDeepAgentMock: vi.fn(),
  dbPrepareMock: vi.fn(),
  storeGetMock: vi.fn((key?: string) => key === 'skillOverrides' ? {} : undefined),
  createLangChainModelMock: vi.fn(() => ({ model: 'mock-model' })),
  getProviderMock: vi.fn(() => ({
    id: 'provider-1',
    provider_type: 'minimax',
    api_key: 'decrypted-key',
    api_url: 'https://api.minimaxi.com/anthropic/v1',
    default_model: 'MiniMax-M2.7',
  })),
  getAgentMcpServersMock: vi.fn(() => []),
  getConnectedMcpServersMock: vi.fn(() => []),
  getAgentSkillNamesMock: vi.fn(() => ['project:parallel-skill']),
  createBuiltInToolsMock: vi.fn(() => []),
  loadRegistryToolsMock: vi.fn(() => []),
  loadMcpToolsMock: vi.fn(async () => ({ client: null, tools: [] })),
  createSpanIdMock: vi.fn(() => 'span-root'),
  createChildSpanMock: vi.fn((parentSpanId: string) => ({ spanId: `${parentSpanId}-child`, parentSpanId })),
  resolveInterruptOnMock: vi.fn(() => ({})),
  getRuntimeToolNamesMock: vi.fn((tools: Array<{ name?: string }>) =>
    tools.map((tool) => tool.name).filter(Boolean)
  ),
  getScopePathMock: vi.fn((_projectPath: string, scope: string) =>
    scope === 'global' ? '/tmp/global-skills' : `${_projectPath}/.cdf/skills`
  ),
  getBuiltInSkillDirsMock: vi.fn(() => ['/tmp/cdf-built-in-skills/knowledge-base']),
  resolveAgentSkillsConfigMock: vi.fn(() => ({
    skillsSources: ['/.cdf/skills'],
    permissions: [{ operations: ['read'], paths: ['/tmp/project'] }],
  })),
  resolveAgentSkillConfigOptionsMock: vi.fn((): any => ({ options: undefined, warnings: [] })),
  buildCdfSkillsRuntimeMock: vi.fn(() => ({
    skills: [],
    prompt: '## Skills System\n\nparallel skills prompt',
    warnings: [],
  })),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

vi.mock('deepagents', () => ({
  createDeepAgent: createDeepAgentMock,
  CompositeBackend: class {},
  FilesystemBackend: class {},
  StateBackend: class {},
}));

vi.mock('../database', () => ({
  default: {
    prepare: dbPrepareMock,
  },
}));

vi.mock('../store', () => ({
  default: {
    get: storeGetMock,
  },
}));

vi.mock('./llm-adapter', () => ({
  createLangChainModel: createLangChainModelMock,
}));

vi.mock('./shared-infra', () => ({
  getProvider: getProviderMock,
  getAgentMcpServers: getAgentMcpServersMock,
  getConnectedMcpServers: getConnectedMcpServersMock,
  getAgentSkillNames: getAgentSkillNamesMock,
  createBuiltInTools: createBuiltInToolsMock,
  loadRegistryTools: loadRegistryToolsMock,
  loadMcpTools: loadMcpToolsMock,
  createSpanId: createSpanIdMock,
  createChildSpan: createChildSpanMock,
  resolveInterruptOn: resolveInterruptOnMock,
  getRuntimeToolNames: getRuntimeToolNamesMock,
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

import { createParallelTaskTool } from './parallel-task-tool';

describe('createParallelTaskTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeGetMock.mockImplementation((key?: string) => key === 'skillOverrides' ? {} : undefined);
    resolveAgentSkillConfigOptionsMock.mockReturnValue({ options: undefined, warnings: [] });
    resolveAgentSkillsConfigMock.mockReturnValue({
      skillsSources: ['/.cdf/skills'],
      permissions: [{ operations: ['read'], paths: ['/tmp/project'] }],
    });
    buildCdfSkillsRuntimeMock.mockReturnValue({
      skills: [],
      prompt: '## Skills System\n\nparallel skills prompt',
      warnings: [],
    });
    createDeepAgentMock.mockReturnValue({
      invoke: vi.fn(async () => ({
        messages: [{ role: 'assistant', content: 'worker done' }],
      })),
    });
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: () => {
        if (sql.includes('SELECT path FROM projects')) return { path: '/tmp/project' };
        return undefined;
      },
      all: () => {
        if (sql.includes('SELECT * FROM agents WHERE project_id')) {
          return [{
            id: 'agent-1',
            project_id: 'project-1',
            name: 'Worker Agent',
            slug: 'worker',
            provider_id: 'provider-1',
            system_prompt: 'worker system',
            config: null,
          }];
        }
        return [];
      },
    }));
  });

  it('wires worker skills through the CDF Skills Runtime prompt', async () => {
    const parallelTool = createParallelTaskTool('project-1', 'session-1');

    await parallelTool.invoke({
      tasks: [
        {
          name: 'worker',
          description: 'Do worker task',
        },
      ],
    });

    const params = createDeepAgentMock.mock.calls[0][0];
    expect(params.systemPrompt).toContain('worker system');
    expect(params.systemPrompt).toContain('parallel skills prompt');
    expect(params.skills).toBeUndefined();
    expect(buildCdfSkillsRuntimeMock).toHaveBeenCalledWith('/tmp/project', expect.objectContaining({
      builtInSkillDirs: ['/tmp/cdf-built-in-skills/knowledge-base'],
      preloadSkillNames: ['parallel-skill'],
    }));
  });

  it('preserves qualified additional worker skill names when building preload hints', async () => {
    getAgentSkillNamesMock.mockReturnValueOnce(['project-additional:docs:review']);

    const parallelTool = createParallelTaskTool('project-1', 'session-1');

    await parallelTool.invoke({
      tasks: [
        {
          name: 'worker',
          description: 'Do worker task',
        },
      ],
    });

    expect(resolveAgentSkillsConfigMock).toHaveBeenCalledWith('/tmp/project', ['project-additional:docs:review']);
    expect(buildCdfSkillsRuntimeMock).toHaveBeenCalledWith('/tmp/project', expect.objectContaining({
      preloadSkillNames: ['docs:review'],
    }));
  });

  it('passes task path mentions into worker CDF Skills Runtime for nested Skill ranking', async () => {
    const parallelTool = createParallelTaskTool('project-1', 'session-1');

    await parallelTool.invoke({
      tasks: [
        {
          name: 'worker',
          description: 'Deploy @apps/web/src/App.tsx',
        },
      ],
    });

    expect(buildCdfSkillsRuntimeMock).toHaveBeenCalledWith('/tmp/project', expect.objectContaining({
      pathContext: ['apps/web/src/App.tsx'],
    }));
  });

  it('adds loaded MCP tools to the worker approval boundary', async () => {
    loadMcpToolsMock.mockResolvedValueOnce({
      client: null,
      tools: [{ name: 'alpha__search' }],
    });
    resolveInterruptOnMock.mockImplementation((_mode: string, toolNames: string[] = []) => {
      return Object.fromEntries(toolNames.map((name) => [name, { allowedDecisions: ['approve', 'reject'] }]));
    });

    const parallelTool = createParallelTaskTool('project-1', 'session-1', 'strict');

    await parallelTool.invoke({
      tasks: [
        {
          name: 'worker',
          description: 'Do worker task',
        },
      ],
    });

    expect(resolveInterruptOnMock).toHaveBeenCalledWith('strict', ['alpha__search']);
    const params = createDeepAgentMock.mock.calls[0][0];
    expect(params.interruptOn.alpha__search).toEqual({ allowedDecisions: ['approve', 'reject'] });
  });
});
