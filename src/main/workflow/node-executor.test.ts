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

const VALID_TASK_JSON = '{"summary":"done","status":"success"}';
const VALID_REVIEW_JSON = '{"summary":"reviewed","status":"success","verdict":"pass"}';

describe('createAgentNodeExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDeepAgentMock.mockReturnValue({
      invoke: vi.fn(async () => ({
        messages: [{ role: 'assistant', content: VALID_TASK_JSON }],
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
      position: { x: 0, y: 0 },
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
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: '{"summary":"iteration-1-output","status":"success"}' }] })
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: '{"summary":"iteration-2-output","status":"success"}' }] })
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: '{"summary":"iteration-3-output","status":"success"}' }] });
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
      result: '{"summary":"iteration-3-output","status":"success"}',
      iteration_count: 3,
      max_iterations: 3,
      iterations: [
        { iteration: 1, result: '{"summary":"iteration-1-output","status":"success"}', structuredOutput: { summary: 'iteration-1-output', status: 'success' } },
        { iteration: 2, result: '{"summary":"iteration-2-output","status":"success"}', structuredOutput: { summary: 'iteration-2-output', status: 'success' } },
        { iteration: 3, result: '{"summary":"iteration-3-output","status":"success"}', structuredOutput: { summary: 'iteration-3-output', status: 'success' } },
      ],
    });
  });

  it('should stop loop nodes early when the agent emits a completion routing signal', async () => {
    const invokeMock = vi.fn()
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: '{"summary":"iteration-1-output","status":"success"}' }] })
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: '{"summary":"done","status":"success","routing":{"loop-node":"done"}}' }] });
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
      result: '{"summary":"done","status":"success","routing":{"loop-node":"done"}}',
      iteration_count: 2,
      max_iterations: 5,
      routing: { 'loop-node': 'done' },
    });
  });

  // ---- Task 3: 输出校验场景测试 ----

  it('should include structuredOutput when task node output passes validation', async () => {
    const invokeMock = vi.fn()
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: '{"summary":"task done","status":"success","artifacts":[{"path":"/out.txt","kind":"file"}]}' }] });
    createDeepAgentMock.mockReturnValue({ invoke: invokeMock });

    const executor = createAgentNodeExecutor({
      id: 'node-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: { agentId: 'agent-1', label: 'Task', nodeKind: 'task' },
    });

    const result = await executor({ inputs: {}, nodeOutputs: {} });

    expect(result.structuredOutput).toBeDefined();
    expect(result.structuredOutput).toMatchObject({ summary: 'task done', status: 'success' });
    expect(result._degraded).toBeUndefined();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('should retry when output fails validation and succeed on second attempt', async () => {
    const invalidOutput = 'not json at all';
    const validOutput = '{"summary":"fixed","status":"success"}';
    const invokeMock = vi.fn()
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: invalidOutput }] })
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: validOutput }] });
    createDeepAgentMock.mockReturnValue({ invoke: invokeMock });

    const executor = createAgentNodeExecutor({
      id: 'node-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: { agentId: 'agent-1', label: 'Task', nodeKind: 'task' },
    });

    const result = await executor({ inputs: {}, nodeOutputs: {} });

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(result.structuredOutput).toBeDefined();
    expect(result.structuredOutput).toMatchObject({ summary: 'fixed', status: 'success' });
    expect(result._degraded).toBeUndefined();
  });

  it('should degrade after MAX_RETRIES (5) consecutive validation failures', async () => {
    const invalidOutput = 'not valid json content';
    const invokeMock = vi.fn()
      .mockResolvedValue({ messages: [{ role: 'assistant', content: invalidOutput }] });
    createDeepAgentMock.mockReturnValue({ invoke: invokeMock });

    const executor = createAgentNodeExecutor({
      id: 'node-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: { agentId: 'agent-1', label: 'Task', nodeKind: 'task' },
    });

    const result = await executor({ inputs: {}, nodeOutputs: {} });

    // 5 retries (MAX_RETRIES): first attempt + 4 retries = 5 total calls
    expect(invokeMock).toHaveBeenCalledTimes(5);
    expect(result._degraded).toBe(true);
    expect(result._validationErrors).toBeDefined();
    expect(Array.isArray(result._validationErrors)).toBe(true);
    expect(result._validationErrors.length).toBeGreaterThan(0);
    expect(result.structuredOutput).toBeUndefined();
  });

  it('should validate review node output with verdict field', async () => {
    const validReviewJson = JSON.stringify({
      summary: 'code review complete',
      status: 'success',
      verdict: 'needs_changes',
      issues: [{ severity: 'major', file: 'src/app.ts', description: 'missing error handling' }],
    });
    const invokeMock = vi.fn()
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: validReviewJson }] });
    createDeepAgentMock.mockReturnValue({ invoke: invokeMock });

    const executor = createAgentNodeExecutor({
      id: 'review-1',
      type: 'review',
      position: { x: 0, y: 0 },
      data: { agentId: 'agent-1', label: 'Review', nodeKind: 'review' },
    });

    const result = await executor({ inputs: {}, nodeOutputs: {} });

    expect(result.structuredOutput).toBeDefined();
    expect(result.structuredOutput).toMatchObject({
      summary: 'code review complete',
      status: 'success',
      verdict: 'needs_changes',
      issues: [{ severity: 'major', file: 'src/app.ts', description: 'missing error handling' }],
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('should include structuredOutput in loop iteration records on validation success', async () => {
    const invokeMock = vi.fn()
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: '{"summary":"iter-1","status":"success"}' }] })
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: '{"summary":"iter-2","status":"success"}' }] });
    createDeepAgentMock.mockReturnValue({ invoke: invokeMock });

    const executor = createAgentNodeExecutor({
      id: 'loop-node',
      type: 'loop',
      position: { x: 0, y: 0 },
      data: { agentId: 'agent-1', label: 'Loop', nodeKind: 'loop', taskDescription: 'test', loopCount: 2 },
    });

    const result = await executor({ inputs: {}, nodeOutputs: {} });

    expect(result.iterations).toHaveLength(2);
    expect(result.iterations[0].structuredOutput).toMatchObject({ summary: 'iter-1', status: 'success' });
    expect(result.iterations[1].structuredOutput).toMatchObject({ summary: 'iter-2', status: 'success' });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('should preserve routing extraction from raw output text regardless of validation', async () => {
    // 输出包含 routing 但不符合 task schema（缺少 summary），校验会失败
    const outputWithRouting = '{"routing":{"next":"step-2"},"status":"success","summary":"ok"}';
    const invokeMock = vi.fn()
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: outputWithRouting }] });
    createDeepAgentMock.mockReturnValue({ invoke: invokeMock });

    const executor = createAgentNodeExecutor({
      id: 'node-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: { agentId: 'agent-1', label: 'Task', nodeKind: 'task' },
    });

    const result = await executor({ inputs: {}, nodeOutputs: {} });

    // routing 始终从原始文本提取，校验通过时也应正常提取
    expect(result.routing).toBeDefined();
    expect(result.routing).toMatchObject({ next: 'step-2' });
    // 校验通过（summary + status 都存在）
    expect(result.structuredOutput).toBeDefined();
  });

  it('should still extract routing from raw text even when validation degrades', async () => {
    // 输出包含 routing 但解析后不符合 schema → 校验降级
    const outputWithRouting = '{"routing":{"branch":"alt"}}';
    // 缺少 summary 和 status → 校验失败 → 重试 5 次全失败 → 降级
    const invokeMock = vi.fn()
      .mockResolvedValue({ messages: [{ role: 'assistant', content: outputWithRouting }] });
    createDeepAgentMock.mockReturnValue({ invoke: invokeMock });

    const executor = createAgentNodeExecutor({
      id: 'node-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: { agentId: 'agent-1', label: 'Task', nodeKind: 'task' },
    });

    const result = await executor({ inputs: {}, nodeOutputs: {} });

    // routing 基于原始文本提取，即使校验失败也不影响
    expect(result.routing).toBeDefined();
    expect(result.routing).toMatchObject({ branch: 'alt' });
    // 校验降级
    expect(result._degraded).toBe(true);
  });
});
