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

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => '[{"name":"item-1"},{"name":"item-2"}]'),
  },
}));

import { createAgentNodeExecutor, extractWorkflowRouting } from './node-executor';
import fs from 'fs';

const VALID_TASK_JSON = '{"summary":"done","status":"success"}';

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
        { iteration: 1, result: '{"summary":"iteration-1-output","status":"success"}' },
        { iteration: 2, result: '{"summary":"iteration-2-output","status":"success"}' },
        { iteration: 3, result: '{"summary":"iteration-3-output","status":"success"}' },
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

  // ---- Tool 日志回调测试 (TG-02) ----

  it('should trigger logging callbacks with correct tool name on LLM and tool events', async () => {
    const onStepSpy = vi.fn();
    let capturedCallbacks: any[] = [];

    createDeepAgentMock.mockReturnValue({
      invoke: vi.fn(async (_input: any, config: any) => {
        capturedCallbacks = config.callbacks;
        return {
          messages: [{ role: 'assistant', content: '{"summary":"done","status":"success"}' }],
        };
      }),
    });

    const executor = createAgentNodeExecutor({
      id: 'node-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: { agentId: 'agent-1', label: 'Node 1' },
    });

    await executor({ inputs: {}, nodeOutputs: {} }, onStepSpy);

    expect(capturedCallbacks.length).toBeGreaterThan(0);
    const callbackHandler = capturedCallbacks[0];

    // Test LLM End log: handleLLMEnd 应产出 thinking step
    callbackHandler.handleLLMEnd('我决定先调用工具');
    expect(onStepSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'thinking', content: '我决定先调用工具' }));

    // Test Tool Start log
    callbackHandler.handleToolStart({ name: 'write_file' }, 'content', 'run-1', null, [], {}, 'write_file');
    expect(onStepSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool_call', tool: 'write_file', args: 'content' }));

    // Test Tool End log
    callbackHandler.handleToolEnd('success', 'run-1');
    const lastStep = onStepSpy.mock.calls[onStepSpy.mock.calls.length - 1][0];
    expect(lastStep).toMatchObject({ type: 'tool_result', tool: 'write_file', success: true, output: 'success' });
    expect(typeof lastStep.duration_ms).toBe('number');

    // Test Tool Error log
    callbackHandler.handleToolStart({ name: 'bash' }, 'ls', 'run-2', null, [], {}, 'bash');
    callbackHandler.handleToolError(new Error('command failed'), 'run-2');
    const lastErrStep = onStepSpy.mock.calls[onStepSpy.mock.calls.length - 1][0];
    expect(lastErrStep).toMatchObject({ type: 'tool_result', tool: 'bash', success: false, error: 'command failed' });
  });

  // ---- ForEach 节点测试 (TG-01) ----

  it('should execute ForEach node with JSON data source', async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue('[{"name":"item-1"},{"name":"item-2"},{"name":"item-3"}]');

    const invokeMock = vi.fn()
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: '{"summary":"processed item-1","status":"success"}' }] })
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: '{"summary":"processed item-2","status":"success"}' }] })
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: '{"summary":"processed item-3","status":"success"}' }] });
    createDeepAgentMock.mockReturnValue({ invoke: invokeMock });

    const executor = createAgentNodeExecutor({
      id: 'foreach-node',
      type: 'foreach',
      position: { x: 0, y: 0 },
      data: {
        agentId: 'agent-1',
        label: 'ForEach',
        nodeKind: 'foreach',
        taskDescription: 'process each item',
        dataSource: 'items.json',
      },
    });

    const onStepMock = vi.fn();
    const result = await executor({ inputs: {}, nodeOutputs: {} }, onStepMock);

    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(result.results).toHaveLength(3);
    expect((result.results as any[])[0]).toMatchObject({ index: 0, success: true });
    expect((result.results as any[])[1]).toMatchObject({ index: 1, success: true });
    expect((result.results as any[])[2]).toMatchObject({ index: 2, success: true });
    expect(result.totalItems).toBe(3);
    expect(result.successCount).toBe(3);
    expect(result.failCount).toBe(0);
    expect(onStepMock).toHaveBeenCalled();
    expect(onStepMock.mock.calls.some(call => call[0].type === 'system' && String(call[0].content).includes('正在执行第 1/3 项子任务'))).toBe(true);
  });

  it('should use itemPrompt template in ForEach context', async () => {
    const invokeMock = vi.fn()
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: '{"summary":"done","status":"success"}' }] });
    createDeepAgentMock.mockReturnValue({ invoke: invokeMock });

    const executor = createAgentNodeExecutor({
      id: 'foreach-node',
      type: 'foreach',
      position: { x: 0, y: 0 },
      data: {
        agentId: 'agent-1',
        label: 'ForEach',
        nodeKind: 'foreach',
        taskDescription: 'greet each person',
        dataSource: 'people.json',
        itemPrompt: '请处理: {item}',
      },
    });

    await executor({ inputs: {}, nodeOutputs: {} });

    // 使用默认 mock 数据 [{"name":"item-1"},{"name":"item-2"}]，验证 itemPrompt 中的 {item} 被替换
    const context = invokeMock.mock.calls[0][0].messages[0].content;
    expect(context).toContain('请处理:');
    expect(context).toContain('"name"');
    expect(context).toContain('item-1');
  });

  it('should stop ForEach on failure when failureStrategy is stop', async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue('[{"id":1},{"id":2},{"id":3},{"id":4}]');

    const invokeMock = vi.fn()
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: '{"summary":"ok-1","status":"success"}' }] })
      .mockRejectedValueOnce(new Error('file not found'))
      .mockResolvedValueOnce({ messages: [{ role: 'assistant', content: 'should not reach' }] });
    createDeepAgentMock.mockReturnValue({ invoke: invokeMock });

    const executor = createAgentNodeExecutor({
      id: 'foreach-node',
      type: 'foreach',
      position: { x: 0, y: 0 },
      data: {
        agentId: 'agent-1',
        label: 'ForEach',
        nodeKind: 'foreach',
        taskDescription: 'process',
        dataSource: 'items.json',
        failureStrategy: 'stop',
      },
    });

    const result = await executor({ inputs: {}, nodeOutputs: {} });

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(2);
    expect((result.results as any[])[0]).toMatchObject({ index: 0, success: true });
    expect((result.results as any[])[1]).toMatchObject({ index: 1, success: false, error: 'file not found' });
    expect(result.totalItems).toBe(4);
    expect(result.successCount).toBe(1);
    expect(result.failCount).toBe(1);
  });

  it('should throw when ForEach data source file does not exist', async () => {
    (fs.existsSync as any).mockReturnValue(false);

    const executor = createAgentNodeExecutor({
      id: 'foreach-node',
      type: 'foreach',
      position: { x: 0, y: 0 },
      data: {
        agentId: 'agent-1',
        label: 'ForEach',
        nodeKind: 'foreach',
        taskDescription: 'process',
        dataSource: 'nonexistent.json',
      },
    });

    await expect(executor({ inputs: {}, nodeOutputs: {} })).rejects.toThrow('数据源文件不存在');
  });

  it('should throw when ForEach data source is not valid JSON', async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue('not-json');

    const executor = createAgentNodeExecutor({
      id: 'foreach-node',
      type: 'foreach',
      position: { x: 0, y: 0 },
      data: {
        agentId: 'agent-1',
        label: 'ForEach',
        nodeKind: 'foreach',
        taskDescription: 'process',
        dataSource: 'bad.json',
      },
    });

    await expect(executor({ inputs: {}, nodeOutputs: {} })).rejects.toThrow('数据源文件不是合法的 JSON');
  });

  // ---- 错误处理测试 (TG-02) ----

  it('should throw when agentId is missing from node config', () => {
    expect(() => createAgentNodeExecutor({
      id: 'node-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: { agentId: '', label: 'Bad' },
    })).toThrow('Node node-1 has no agentId configured');
  });

  it('should propagate execution errors from agent.invoke (not retried by validator)', async () => {
    const invokeMock = vi.fn().mockRejectedValue(new Error('LLM connection timeout'));
    createDeepAgentMock.mockReturnValue({ invoke: invokeMock });

    const executor = createAgentNodeExecutor({
      id: 'node-1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: { agentId: 'agent-1', label: 'Task', nodeKind: 'task' },
    });

    // 执行异常直接向上传播，不经过校验重试循环
    await expect(executor({ inputs: {}, nodeOutputs: {} }))
      .rejects.toThrow('Agent node node-1 execution failed: LLM connection timeout');
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});

