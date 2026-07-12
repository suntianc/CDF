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
  getRunBySessionIdMock,
  getCurrentStageMock,
  createTaskMock,
  setTaskDelegationMock,
  updateTaskStatusMock,
  getTaskMock,
  normalizeProviderIdMock,
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
  loadMcpToolsMock: vi.fn(async () => ({ client: null, tools: [] as Array<{ name: string }> })),
  createSpanIdMock: vi.fn(() => 'span-root'),
  createChildSpanMock: vi.fn((parentSpanId: string) => ({ spanId: `${parentSpanId}-child`, parentSpanId })),
  resolveInterruptOnMock: vi.fn((_mode: string, _toolNames?: string[]) => ({} as Record<string, { allowedDecisions: string[] }>)),
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
  getRunBySessionIdMock: vi.fn(),
  getCurrentStageMock: vi.fn(),
  createTaskMock: vi.fn(),
  setTaskDelegationMock: vi.fn(),
  updateTaskStatusMock: vi.fn(),
  getTaskMock: vi.fn(),
  normalizeProviderIdMock: vi.fn((v: string | null | undefined) => v ?? null),
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
  registerHarnessProfile: vi.fn(),
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

vi.mock('../workflow-run/db', () => ({
  getRunBySessionId: getRunBySessionIdMock,
  getCurrentStage: getCurrentStageMock,
  createTask: createTaskMock,
  setTaskDelegation: setTaskDelegationMock,
  updateTaskStatus: updateTaskStatusMock,
  getTask: getTaskMock,
}));

vi.mock('./llm-adapter', () => ({
  createLangChainModel: createLangChainModelMock,
}));

vi.mock('./shared-infra', () => ({
  getProvider: getProviderMock,
  normalizeProviderId: normalizeProviderIdMock,
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
    getRunBySessionIdMock.mockReturnValue(undefined);
    getCurrentStageMock.mockReturnValue(null);
    createTaskMock.mockReturnValue({ id: 'fallback-task' });
    getTaskMock.mockReturnValue(undefined);
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: () => {
        if (sql.includes('FROM projects')) return { name: 'Test Project', path: '/tmp/project' };
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
    expect(createBuiltInToolsMock).toHaveBeenCalledWith('/tmp/project', 'session-1');
  });

  // Skill descriptors are prompt metadata, not LangChain tools. Putting them in
  // createDeepAgent({ tools }) makes ChatAnthropic throw
  // "Unknown tool type passed to ChatAnthropic: knowledge-base".
  it('does not pass Skill descriptors into createDeepAgent tools', async () => {
    const skillDescriptor = {
      name: 'knowledge-base',
      qualifiedName: 'knowledge-base',
      description: 'Enable and use the project Knowledge Base',
      allowedTools: [] as string[],
      whenToUse: 'when remembering project knowledge',
      arguments: [] as unknown[],
      sourceKind: 'built-in',
    };
    buildCdfSkillsRuntimeMock.mockReturnValue({
      skills: [skillDescriptor],
      prompt: '## Skills System\n\nparallel skills prompt',
      warnings: [],
    });
    createBuiltInToolsMock.mockReturnValueOnce([{ name: 'bash' }]);
    loadMcpToolsMock.mockResolvedValueOnce({
      client: null,
      tools: [{ name: 'alpha__search' }],
    });

    const parallelTool = createParallelTaskTool('project-1', 'session-1');
    await parallelTool.invoke({
      tasks: [{ name: 'worker', description: 'Do worker task' }],
    });

    const params = createDeepAgentMock.mock.calls[0][0];
    const toolNames = (params.tools as Array<{ name?: string }>).map((t) => t.name);
    expect(toolNames).not.toContain('knowledge-base');
    expect(params.tools).not.toContainEqual(skillDescriptor);
    expect(toolNames).toEqual(expect.arrayContaining(['bash', 'alpha__search']));
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

  it('compiles workers without an approval boundary (no checkpointer → interrupt would kill the task)', async () => {
    loadMcpToolsMock.mockResolvedValueOnce({
      client: null,
      tools: [{ name: 'alpha__search' }],
    });

    const parallelTool = createParallelTaskTool('project-1', 'session-1');

    await parallelTool.invoke({
      tasks: [
        {
          name: 'worker',
          description: 'Do worker task',
        },
      ],
    });

    expect(resolveInterruptOnMock).not.toHaveBeenCalled();
    const params = createDeepAgentMock.mock.calls[0][0];
    expect(params.interruptOn).toBeUndefined();
  });

  it('links a Workflow Run task using runTaskId and advances it when the worker completes', async () => {
    getRunBySessionIdMock.mockReturnValue({
      id: 'run-1',
      current_stage_index: 0,
      stages: JSON.stringify([{ id: 'stage-1' }]),
    });
    getCurrentStageMock.mockReturnValue({ id: 'stage-1' });
    getTaskMock.mockReturnValue({ id: 'task-1', run_id: 'run-1', stage_id: 'stage-1' });
    const parallelTool = createParallelTaskTool('project-1', 'session-1');

    await parallelTool.invoke({
      tasks: [{
        name: 'worker',
        description: 'Do linked work',
        runTaskId: 'task-1',
      }],
    });

    expect(setTaskDelegationMock).toHaveBeenCalledWith(
      'task-1',
      expect.any(String),
      expect.any(String),
      'worker',
    );
    expect(updateTaskStatusMock).toHaveBeenCalledWith('task-1', 'completed');
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it('persists an unowned Workflow Run dispatch under the current Stage', async () => {
    getRunBySessionIdMock.mockReturnValue({
      id: 'run-1',
      current_stage_index: 0,
      stages: JSON.stringify([{ id: 'stage-1' }]),
    });
    getCurrentStageMock.mockReturnValue({ id: 'stage-1' });
    createTaskMock.mockReturnValue({ id: 'fallback-task' });
    const parallelTool = createParallelTaskTool('project-1', 'session-1');

    await parallelTool.invoke({
      tasks: [{
        name: 'worker',
        description: 'Unplanned delegated work',
      }],
    });

    expect(createTaskMock).toHaveBeenCalledWith(
      'run-1',
      'stage-1',
      'worker',
      'Unplanned delegated work',
    );
    expect(setTaskDelegationMock).toHaveBeenCalledWith(
      'fallback-task',
      expect.any(String),
      expect.any(String),
      'worker',
    );
    expect(updateTaskStatusMock).toHaveBeenCalledWith('fallback-task', 'completed');
  });

  it('marks the linked Workflow Run task failed when the worker fails', async () => {
    getRunBySessionIdMock.mockReturnValue({
      id: 'run-1',
      current_stage_index: 0,
      stages: JSON.stringify([{ id: 'stage-1' }]),
    });
    getCurrentStageMock.mockReturnValue({ id: 'stage-1' });
    getTaskMock.mockReturnValue({ id: 'task-failed', run_id: 'run-1', stage_id: 'stage-1' });
    createDeepAgentMock.mockReturnValueOnce({
      invoke: vi.fn(async () => {
        throw new Error('worker failed');
      }),
    });
    const parallelTool = createParallelTaskTool('project-1', 'session-1');

    const result = JSON.parse(String(await parallelTool.invoke({
      tasks: [{
        name: 'worker',
        description: 'Failing linked work',
        runTaskId: 'task-failed',
      }],
    }))) as { results: Array<{ status: string }> };

    expect(result.results[0].status).toBe('failure');
    expect(updateTaskStatusMock).toHaveBeenCalledWith('task-failed', 'failed');
  });

  it('rejects runTaskId when there is no Workflow Run context (normal chat)', async () => {
    // No getRunBySessionIdMock set — defaults to undefined from beforeEach
    const parallelTool = createParallelTaskTool('project-1', 'session-1');

    await parallelTool.invoke({
      tasks: [{
        name: 'worker',
        description: 'Chat-dispatched task',
        runTaskId: 'task-in-run',
      }],
    });

    // Normal chat: no Workflow Run, so runTaskId is ignored
    expect(createTaskMock).not.toHaveBeenCalled();
    expect(setTaskDelegationMock).not.toHaveBeenCalled();
    expect(updateTaskStatusMock).not.toHaveBeenCalled();
  });

  it('rejects runTaskId when the task does not exist', async () => {
    getRunBySessionIdMock.mockReturnValue({
      id: 'run-1',
      current_stage_index: 0,
      stages: JSON.stringify([{ id: 'stage-1' }]),
    });
    getCurrentStageMock.mockReturnValue({ id: 'stage-1' });
    getTaskMock.mockReturnValue(undefined); // task doesn't exist
    const parallelTool = createParallelTaskTool('project-1', 'session-1');

    await parallelTool.invoke({
      tasks: [{
        name: 'worker',
        description: 'Task with bogus id',
        runTaskId: 'non-existent-task',
      }],
    });

    // Non-existent task should be ignored; fallback created instead
    expect(createTaskMock).toHaveBeenCalledTimes(1);
    expect(setTaskDelegationMock).toHaveBeenCalledWith(
      'fallback-task',
      expect.any(String),
      expect.any(String),
      'worker',
    );
  });

  it('rejects runTaskId belonging to a different run', async () => {
    getRunBySessionIdMock.mockReturnValue({
      id: 'run-1',
      current_stage_index: 0,
      stages: JSON.stringify([{ id: 'stage-1' }]),
    });
    getCurrentStageMock.mockReturnValue({ id: 'stage-1' });
    getTaskMock.mockReturnValue({ id: 'other-run-task', run_id: 'run-2', stage_id: 'stage-1' });
    const parallelTool = createParallelTaskTool('project-1', 'session-1');

    await parallelTool.invoke({
      tasks: [{
        name: 'worker',
        description: 'Cross-run task',
        runTaskId: 'other-run-task',
      }],
    });

    expect(createTaskMock).toHaveBeenCalledTimes(1);
    expect(updateTaskStatusMock).toHaveBeenCalledWith('fallback-task', 'completed');
  });

  it('rejects runTaskId belonging to a different stage', async () => {
    getRunBySessionIdMock.mockReturnValue({
      id: 'run-1',
      current_stage_index: 0,
      stages: JSON.stringify([{ id: 'stage-1' }, { id: 'stage-2' }]),
    });
    getCurrentStageMock.mockReturnValue({ id: 'stage-1' });
    getTaskMock.mockReturnValue({ id: 'other-stage-task', run_id: 'run-1', stage_id: 'stage-2' });
    const parallelTool = createParallelTaskTool('project-1', 'session-1');

    await parallelTool.invoke({
      tasks: [{
        name: 'worker',
        description: 'Cross-stage task',
        runTaskId: 'other-stage-task',
      }],
    });

    expect(createTaskMock).toHaveBeenCalledWith('run-1', 'stage-1', 'worker', 'Cross-stage task');
    expect(updateTaskStatusMock).toHaveBeenCalledWith('fallback-task', 'completed');
  });

  it('rejects duplicate runTaskId within the same batch, using only the first occurrence', async () => {
    getRunBySessionIdMock.mockReturnValue({
      id: 'run-1',
      current_stage_index: 0,
      stages: JSON.stringify([{ id: 'stage-1' }]),
    });
    getCurrentStageMock.mockReturnValue({ id: 'stage-1' });
    getTaskMock.mockReturnValue({ id: 'shared-task', run_id: 'run-1', stage_id: 'stage-1' });
    const parallelTool = createParallelTaskTool('project-1', 'session-1');

    await parallelTool.invoke({
      tasks: [
        { name: 'worker', description: 'First use', runTaskId: 'shared-task' },
        { name: 'worker', description: 'Duplicate use', runTaskId: 'shared-task' },
      ],
    });

    expect(setTaskDelegationMock).toHaveBeenCalledTimes(2);
    expect(setTaskDelegationMock).toHaveBeenCalledWith(
      'shared-task',
      expect.any(String),
      expect.any(String),
      'worker',
    );
    expect(createTaskMock).toHaveBeenCalledWith('run-1', 'stage-1', 'worker', 'Duplicate use');
  });
});
