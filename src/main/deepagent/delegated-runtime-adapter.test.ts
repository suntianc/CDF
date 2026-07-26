import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => path.join(os.tmpdir(), 'cdf-delegated-adapter-test-user-data')),
  },
}));

vi.mock('../database', () => ({
  default: {
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(),
      run: vi.fn(),
    })),
  },
}));

vi.mock('../store', () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('./conversation-working-state', () => ({
  DEEPAGENT_CHECKPOINT_NAMESPACE: '',
}));

vi.mock('./runtime-assembly', () => ({
  assembleDeepAgentRuntime: vi.fn(),
  extractPathMentionContext: vi.fn(() => [] as string[]),
}));

import {
  createDelegatedRuntimeAdapter,
  type CreateDelegatedRuntimeAdapterOptions,
  type DelegatedParentContext,
} from './delegated-runtime-adapter';
import type { DelegatedRuntimeRequest } from './delegated-agent-run-coordinator';
import type { DelegatedAgentConfigurationSnapshot } from './delegated-agent-configuration-snapshot';
import type { CatalogAgent } from '../agent-catalog';
import type { MCPServer } from '../../shared/types';

function catalogAgent(config: Record<string, unknown> | null): CatalogAgent {
  return {
    id: 'agent-1',
    role: 'custom',
    name: 'Researcher',
    slug: 'researcher',
    description: null,
    provider_id: null,
    system_prompt: 'child prompt',
    config,
    mcpServerExclusionIds: [],
    skillNames: [],
    created_at: 0,
    updated_at: 0,
  };
}

function snapshotFor(
  config: Record<string, unknown> | null,
  overrides: Partial<DelegatedAgentConfigurationSnapshot> = {},
): DelegatedAgentConfigurationSnapshot {
  return {
    target: catalogAgent(config),
    mcpServerExclusionIds: [],
    globalSkillPreloadRefs: [],
    ...overrides,
  };
}

function mcpServer(id: string): MCPServer {
  return { id, name: id } as unknown as MCPServer;
}

describe('createDelegatedRuntimeAdapter', () => {
  const projectPath = path.join(os.tmpdir(), 'cdf-delegated-adapter-project');
  let parentContext: DelegatedParentContext;
  let invokeMock: ReturnType<typeof vi.fn>;
  let createAgentGraphMock: ReturnType<typeof vi.fn>;
  let loadMcpToolsMock: ReturnType<typeof vi.fn>;
  let assembleRuntimeMock: ReturnType<typeof vi.fn>;
  let resolveInterruptOnMock: ReturnType<typeof vi.fn>;
  let resolveApprovalCoordinatorMock: ReturnType<typeof vi.fn>;
  let options: CreateDelegatedRuntimeAdapterOptions;

  beforeEach(() => {
    invokeMock = vi.fn(async () => ({
      structuredResponse: { status: 'success', artifacts: [], summary: 'done' },
    }));
    createAgentGraphMock = vi.fn(() => ({ invoke: invokeMock }));
    loadMcpToolsMock = vi.fn(async () => ({ client: null, tools: [{ name: 'mcp_search' }] }));
    assembleRuntimeMock = vi.fn(async () => ({
      model: { id: 'child-model' },
      provider: { id: 'openai' },
      permissions: [],
      skillsRuntime: { skills: [], prompt: '', warnings: [], attributions: [] },
      systemPrompt: 'assembled child prompt',
      assemblyWarnings: [],
    }));
    resolveInterruptOnMock = vi.fn(() => ({ mcp_search: { allowedDecisions: ['approve', 'reject'] } }));
    resolveApprovalCoordinatorMock = vi.fn(() => ({
      runToolAction: vi.fn(async ({ execute }: { execute: () => Promise<unknown> }) => execute()),
    }));
    parentContext = {
      approvalMode: 'strict',
      parentBuiltInToolNames: ['bash', 'fetch'],
      parentMcpServerIds: ['mcp-a', 'mcp-b'],
      allMcpServers: [mcpServer('mcp-a'), mcpServer('mcp-b')],
      skillSnapshot: [],
      providerId: 'openai',
      parentOverrides: { allowedTools: ['bash'] },
      project: { name: 'Demo', path: projectPath, scene: 'general' },
      agentFileRoots: [projectPath],
      sessionId: 'session-1',
    } as DelegatedParentContext;
    options = {
      resolveApprovalCoordinator:
        resolveApprovalCoordinatorMock as unknown as CreateDelegatedRuntimeAdapterOptions['resolveApprovalCoordinator'],
      createResilienceMiddleware: vi.fn(() => []) as unknown as
        CreateDelegatedRuntimeAdapterOptions['createResilienceMiddleware'],
      dependencies: {
        assembleRuntime: assembleRuntimeMock as unknown as never,
        createAgentGraph: createAgentGraphMock as unknown as never,
        loadMcpTools: loadMcpToolsMock as unknown as never,
        createBuiltInTools: vi.fn(() => [
          { name: 'bash' },
          { name: 'fetch' },
          { name: 'write_file' },
        ]) as unknown as never,
        loadRegistryTools: vi.fn(() => []) as unknown as never,
        resolveInterruptOn: resolveInterruptOnMock as unknown as never,
      },
    };
  });

  function requestFor(snapshot: DelegatedAgentConfigurationSnapshot | undefined): DelegatedRuntimeRequest {
    return {
      delegatedRunId: 'delegated-1',
      parentAgentRunId: 'run-1',
      targetAgentSlug: 'researcher',
      goal: 'summarize the repo',
      input: { messages: [] },
      configurationSnapshot: snapshot,
    } as unknown as DelegatedRuntimeRequest;
  }

  it('rejects a request without a configuration snapshot', async () => {
    const adapter = createDelegatedRuntimeAdapter(parentContext, options);

    await expect(adapter.run(requestFor(undefined)))
      .rejects.toThrow('Delegated target Agent not found: researcher');
    expect(createAgentGraphMock).not.toHaveBeenCalled();
  });

  it('narrows the child tool scope to the parent baseline (ADR-0062)', async () => {
    const adapter = createDelegatedRuntimeAdapter(parentContext, options);

    await adapter.run(requestFor(snapshotFor({
      toolScope: { mode: 'narrow', builtInTools: ['bash', 'write_file'], mcpServerIds: [] },
    })));

    const graphConfig = createAgentGraphMock.mock.calls[0][0] as { tools: Array<{ name: string }> };
    const toolNames = graphConfig.tools.map((tool) => tool.name);
    // write_file 不在父基线内、fetch 未被选中——子集合只能收窄不能扩大。
    expect(toolNames).toContain('bash');
    expect(toolNames).not.toContain('write_file');
    expect(toolNames).not.toContain('fetch');
    expect(loadMcpToolsMock).toHaveBeenCalledWith('agent-1', [], parentContext.allMcpServers);
  });

  it('filters snapshot-excluded MCP servers from the inherited child scope', async () => {
    const adapter = createDelegatedRuntimeAdapter(parentContext, options);

    await adapter.run(requestFor(snapshotFor(null, { mcpServerExclusionIds: ['mcp-b'] })));

    const [, childServers] = loadMcpToolsMock.mock.calls[0] as [string, MCPServer[], MCPServer[]];
    expect(childServers.map((server) => server.id)).toEqual(['mcp-a']);
  });

  it('propagates the Conversation Skill Snapshot and preload refs into child assembly', async () => {
    const skillSnapshot = [{ name: 'paper-search' }] as unknown as
      DelegatedParentContext['skillSnapshot'];
    const adapter = createDelegatedRuntimeAdapter({ ...parentContext, skillSnapshot }, options);

    await adapter.run(requestFor(snapshotFor(null, {
      globalSkillPreloadRefs: ['built-in:paper-search'],
    })));

    const [target, providerId, project, skillNames, , , , passedSnapshot] =
      assembleRuntimeMock.mock.calls[0];
    expect(target.id).toBe('agent-1');
    expect(providerId).toBe('openai');
    expect(project.path).toBe(projectPath);
    expect(skillNames).toEqual(['built-in:paper-search']);
    expect(passedSnapshot).toBe(skillSnapshot);
  });

  it('builds an isolated graph per run and resolves the coordinator lazily (ADR-0061)', async () => {
    const adapter = createDelegatedRuntimeAdapter(parentContext, options);
    expect(resolveApprovalCoordinatorMock).not.toHaveBeenCalled();

    await adapter.run(requestFor(snapshotFor(null)));
    await adapter.run(requestFor(snapshotFor(null)));

    expect(createAgentGraphMock).toHaveBeenCalledTimes(2);
    const [firstConfig, secondConfig] = createAgentGraphMock.mock.calls.map(
      (call) => call[0] as { checkpointer: unknown; backend: unknown },
    );
    expect(firstConfig.checkpointer).not.toBe(secondConfig.checkpointer);
    expect(firstConfig.backend).not.toBe(secondConfig.backend);
    expect(resolveApprovalCoordinatorMock).toHaveBeenCalledTimes(2);
  });

  it('returns the structured child result when it matches the delegated contract', async () => {
    const adapter = createDelegatedRuntimeAdapter(parentContext, options);

    await expect(adapter.run(requestFor(snapshotFor(null)))).resolves.toEqual({
      status: 'success',
      artifacts: [],
      summary: 'done',
    });
  });

  it('falls back to a truncated last-message summary when structured output is invalid', async () => {
    invokeMock.mockResolvedValueOnce({
      structuredResponse: { nope: true },
      messages: [{ content: 'x'.repeat(3000) }],
    });
    const adapter = createDelegatedRuntimeAdapter(parentContext, options);

    const result = await adapter.run(requestFor(snapshotFor(null)));

    expect(result.status).toBe('success');
    expect(result.summary).toHaveLength(2000);
  });

  it('surfaces unresolved child interrupts as a failure instead of hanging approval', async () => {
    invokeMock.mockResolvedValueOnce({
      __interrupt__: [{ value: 'approval requested' }],
    });
    const adapter = createDelegatedRuntimeAdapter(parentContext, options);

    await expect(adapter.run(requestFor(snapshotFor(null))))
      .rejects.toThrow('Delegated tool approval is not available for this run');
  });

  it.each(['strict', 'agent_decides', 'bypass'] as const)(
    'propagates the parent approval mode into the child approval gate (ADR-0063: %s)',
    async (approvalMode) => {
      const adapter = createDelegatedRuntimeAdapter({ ...parentContext, approvalMode }, options);

      await adapter.run(requestFor(snapshotFor(null)));

      // The adapter must derive the child gate from the parent's approval mode,
      // not from a hardcoded default. ADR-0063: child inherits one mode.
      expect(resolveInterruptOnMock).toHaveBeenCalledTimes(1);
      expect(resolveInterruptOnMock).toHaveBeenCalledWith(
        approvalMode,
        expect.arrayContaining(['mcp_search']),
      );
    },
  );
});
