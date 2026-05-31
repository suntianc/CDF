import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createDeepAgentMock,
  dbPrepareMock,
  decryptApiKeyMock,
  createLangChainModelMock,
  loadMcpToolsMock,
  resolveAgentSkillsConfigMock,
} = vi.hoisted(() => ({
  createDeepAgentMock: vi.fn(),
  dbPrepareMock: vi.fn(),
  decryptApiKeyMock: vi.fn((value: string) => `decrypted:${value}`),
  createLangChainModelMock: vi.fn(() => ({ model: 'mock-model' })),
  loadMcpToolsMock: vi.fn(async () => ({ client: null, tools: [] })),
  resolveAgentSkillsConfigMock: vi.fn(() => ({ skillsSources: [] })),
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

vi.mock('../security', () => ({
  decryptApiKey: decryptApiKeyMock,
}));

vi.mock('../deepagent/llm-adapter', () => ({
  createLangChainModel: createLangChainModelMock,
}));

vi.mock('../deepagent/mcp-connector', () => ({
  loadMcpTools: loadMcpToolsMock,
}));

vi.mock('../deepagent/skill-manager', () => ({
  resolveAgentSkillsConfig: resolveAgentSkillsConfigMock,
}));

import { createAgentNodeExecutor, extractWorkflowRouting } from './node-executor';

describe('createAgentNodeExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDeepAgentMock.mockReturnValue({
      invoke: vi.fn(async () => ({
        messages: [{ role: 'assistant', content: 'done' }],
      })),
    });

    dbPrepareMock.mockImplementation((sql: string) => ({
      get: (arg?: string) => {
        if (sql.includes('FROM agents WHERE id')) {
          return {
            id: arg,
            project_id: 'project-1',
            name: 'Workflow Agent',
            provider_id: 'provider-1',
            description: 'does work',
            system_prompt: 'system',
          };
        }
        if (sql.includes('FROM llm_providers')) {
          return {
            id: 'provider-1',
            provider_type: 'minimax',
            api_key: 'encrypted-key',
            api_url: 'https://api.minimaxi.com/anthropic/v1',
            default_model: 'MiniMax-M2.7',
          };
        }
        if (sql.includes('FROM projects')) {
          return { id: 'project-1', name: 'Project', path: '/tmp/project' };
        }
        return undefined;
      },
      all: () => [],
    }));
  });

  it('should decrypt provider API keys before creating the LangChain model', async () => {
    const executor = createAgentNodeExecutor({
      id: 'node-1',
      type: 'agent',
      data: { agentId: 'agent-1', label: 'Node 1' },
    });

    await executor({ inputs: {}, nodeOutputs: {} });

    expect(decryptApiKeyMock).toHaveBeenCalledWith('encrypted-key');
    expect(createLangChainModelMock).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'decrypted:encrypted-key',
      apiUrl: 'https://api.minimaxi.com/anthropic/v1',
      defaultModel: 'MiniMax-M2.7',
      providerType: 'minimax',
    }));
  });

  it('should extract routing decisions from agent JSON output', () => {
    expect(extractWorkflowRouting('```json\n{"routing":{"review_result":"approved","score":9}}\n```')).toEqual({
      review_result: 'approved',
      score: '9',
    });
  });

  it('should execute loop nodes once per iteration and pass previous output forward', async () => {
    const invokeMock = vi.fn()
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: 'iteration-1-output' }] })
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: 'iteration-2-output' }] })
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: 'iteration-3-output' }] });
    createDeepAgentMock.mockReturnValue({ invoke: invokeMock });

    const executor = createAgentNodeExecutor({
      id: 'loop-node',
      type: 'loop',
      position: { x: 0, y: 0 },
      data: {
        agentId: 'agent-1',
        label: 'Loop',
        nodeKind: 'loop',
        taskDescription: 'refine result',
        loopCount: 3,
      },
    });

    const result = await executor({ inputs: { taskGoal: 'goal' }, nodeOutputs: {} });

    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(invokeMock.mock.calls[1][0].messages[0].content).toContain('iteration-1-output');
    expect(invokeMock.mock.calls[2][0].messages[0].content).toContain('iteration-2-output');
    expect(result).toMatchObject({
      result: 'iteration-3-output',
      iteration_count: 3,
      max_iterations: 3,
      iterations: [
        { iteration: 1, result: 'iteration-1-output' },
        { iteration: 2, result: 'iteration-2-output' },
        { iteration: 3, result: 'iteration-3-output' },
      ],
    });
  });

  it('should stop loop nodes early when the agent emits a completion routing signal', async () => {
    const invokeMock = vi.fn()
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: 'iteration-1-output' }] })
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: '{"routing":{"loop-node":"done"}}' }] });
    createDeepAgentMock.mockReturnValue({ invoke: invokeMock });

    const executor = createAgentNodeExecutor({
      id: 'loop-node',
      type: 'loop',
      position: { x: 0, y: 0 },
      data: {
        agentId: 'agent-1',
        label: 'Loop',
        nodeKind: 'loop',
        taskDescription: 'refine result',
        loopCount: 5,
      },
    });

    const result = await executor({ inputs: {}, nodeOutputs: {} });

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      result: '{"routing":{"loop-node":"done"}}',
      iteration_count: 2,
      max_iterations: 5,
      routing: { 'loop-node': 'done' },
    });
  });
});
