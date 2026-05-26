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
  resolveAgentSkillsConfigMock,
  loadMcpToolsMock,
  registerHarnessProfileMock,
} = vi.hoisted(() => ({
  createDeepAgentMock: vi.fn(() => ({ streamEvents: vi.fn() })),
  fromConnStringMock: vi.fn(),
  checkpointGetTupleMock: vi.fn(),
  dbPrepareMock: vi.fn(),
  loadMcpToolsMock: vi.fn(async () => ({ client: null, tools: [] })),
  registerHarnessProfileMock: vi.fn(),
  resolveAgentSkillsConfigMock: vi.fn(() => ({
    skillsSources: ['/.cdf/skills'],
    permissions: [{ operations: ['read', 'write'], paths: ['/*', '/**/*'] }],
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
}));

vi.mock('../database', () => ({
  default: {
    prepare: dbPrepareMock,
  },
}));

vi.mock('../security', () => ({
  decryptApiKey: vi.fn((value: string) => value),
}));

vi.mock('./llm-adapter', () => ({
  createLangChainModel: vi.fn(() => ({ model: 'mock-model' })),
}));

vi.mock('./mcp-connector', () => ({
  loadMcpTools: loadMcpToolsMock,
}));

vi.mock('./skill-manager', () => ({
  resolveAgentSkillsConfig: resolveAgentSkillsConfigMock,
}));

import { createDeepAgentRuntime } from './runtime';

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
        memory: ['/AGENTS.md'],
        permissions: [{ operations: ['read', 'write'], paths: ['/*', '/**/*'] }],
      })
    );
    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    expect(params.backend.options).toEqual({ rootDir: tempProjectPath, virtualMode: true });
    expect(checkpointGetTupleMock).toHaveBeenCalledWith({
      configurable: {
        thread_id: 'session-1',
        checkpoint_ns: 'cdf-master-runtime-v3',
      },
    });
    expect(registerHarnessProfileMock).toHaveBeenCalledWith('llama3', expect.objectContaining({
      generalPurposeSubagent: { enabled: false },
      excludedTools: [],  // D-15: task tool enabled
    }));
    expect(params.systemPrompt).toContain('虚拟路径 `/`');
    expect(params.systemPrompt).toContain('/src/main.ts');
    expect(params.systemPrompt).toContain('必须在当前轮次继续调用合适的文件工具');
    expect(params.systemPrompt).toContain('ls` 读取 `/`');
    expect(params.systemPrompt).not.toContain(tempProjectPath);
    expect(params.systemPrompt).not.toContain('[可委派 Agent]');
    expect(params.subagents).toBeUndefined();
    expect(params.tools.map((tool: { name: string }) => tool.name)).toContain('delete_file');
    expect(params.interruptOn.delete_file).toEqual({ allowedDecisions: ['approve', 'reject'] });
    expect(params.interruptOn.remove_file).toBeUndefined();
    expect(loadMcpToolsMock).toHaveBeenCalledWith('agent-1', []);
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

  it('should use the requested agent and filter skills by binding', async () => {
    const runtime = await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: '新问题' }, 'agent-2');

    expect(runtime.agentId).toBe('agent-2');
    expect(resolveAgentSkillsConfigMock).toHaveBeenCalledWith(tempProjectPath, ['project:sub-skill']);
    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    expect(params.systemPrompt).toContain('Agent 2 prompt');
    expect(params.subagents).toBeUndefined();
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

    await createDeepAgentRuntime('project-1', 'session-1', { id: 'message-1', content: 'test' }, 'agent-1', undefined, ['agent-2']);

    const params = (createDeepAgentMock.mock.calls as any[])[0][0];
    expect(params.subagents).toBeDefined();
    expect(Array.isArray(params.subagents)).toBe(true);
    expect(params.subagents.length).toBeGreaterThan(0);
    expect(params.subagents[0].name).toBe('code-agent');  // D-03: slug as stable key
    expect(params.subagents[0].responseFormat).toBe(DELEGATED_TASK_RESULT_SCHEMA);  // D-10
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
});
