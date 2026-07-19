import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { MemorySaver } from '@langchain/langgraph';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testDb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  return { testDb: new Database(':memory:') };
});

class ParallelMasterModel extends BaseChatModel {
  _llmType(): string {
    return 'parallel-master';
  }

  override bindTools(): this {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const hasResult = messages.some((message) => (
      message instanceof ToolMessage && message.name === 'parallel_tasks'
    ));
    return {
      generations: [{
        text: hasResult ? 'parent continued' : '',
        message: hasResult
          ? new AIMessage('parent continued')
          : new AIMessage({
              content: '',
              tool_calls: [{
                id: 'parallel-call-1',
                name: 'parallel_tasks',
                args: { tasks: [{ name: 'worker', description: 'write one file' }] },
                type: 'tool_call',
              }],
            }),
      }],
    };
  }
}

class ApprovalSeekingWorkerModel extends BaseChatModel {
  _llmType(): string {
    return 'approval-seeking-worker';
  }

  override bindTools(): this {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const hasWriteResult = messages.some((message) => (
      message instanceof ToolMessage && message.name === 'dangerous_write'
    ));
    return {
      generations: [{
        text: hasWriteResult ? 'child completed' : '',
        message: hasWriteResult
          ? new AIMessage('child completed')
          : new AIMessage({
              content: '',
              tool_calls: [
                {
                  id: 'read-call-1',
                  name: 'safe_read',
                  args: { path: '/tmp/input.md' },
                  type: 'tool_call',
                },
                {
                  id: 'write-call-1',
                  name: 'dangerous_write',
                  args: { path: '/tmp/result.md', content: 'result' },
                  type: 'tool_call',
                },
                {
                  id: 'delete-call-1',
                  name: 'dangerous_delete',
                  args: { path: '/tmp/old.md' },
                  type: 'tool_call',
                },
              ],
            }),
      }],
    };
  }
}

class TwoTaskParallelMasterModel extends BaseChatModel {
  _llmType(): string {
    return 'two-task-parallel-master';
  }

  override bindTools(): this {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const hasResult = messages.some((message) => (
      message instanceof ToolMessage && message.name === 'parallel_tasks'
    ));
    return {
      generations: [{
        text: hasResult ? 'parent continued' : '',
        message: hasResult
          ? new AIMessage('parent continued')
          : new AIMessage({
              content: '',
              tool_calls: [{
                id: 'parallel-call-general',
                name: 'parallel_tasks',
                args: {
                  tasks: [
                    { name: 'general-purpose', description: 'first task' },
                    { name: 'general-purpose', description: 'second task' },
                  ],
                },
                type: 'tool_call',
              }],
            }),
      }],
    };
  }
}

class SingleGeneralMasterModel extends BaseChatModel {
  _llmType(): string {
    return 'single-general-master';
  }

  override bindTools(): this {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const hasResult = messages.some((message) => (
      message instanceof ToolMessage && message.name === 'task'
    ));
    return {
      generations: [{
        text: hasResult ? 'parent continued' : '',
        message: hasResult
          ? new AIMessage('parent continued')
          : new AIMessage({
              content: '',
              tool_calls: [{
                id: 'task-call-general',
                name: 'task',
                args: {
                  subagent_type: 'general-purpose',
                  description: 'complete one delegated task',
                },
                type: 'tool_call',
              }],
            }),
      }],
    };
  }
}

const generalPurposeModelInstances: CompletingWorkerModel[] = [];
let masterModelKind: 'parallel' | 'two-general' | 'single-general' = 'parallel';

class CompletingWorkerModel extends BaseChatModel {
  constructor(fields: Record<string, never>) {
    super(fields);
    generalPurposeModelInstances.push(this);
  }

  _llmType(): string {
    return 'completing-general-purpose-worker';
  }

  override bindTools(): this {
    return this;
  }

  async _generate(): Promise<ChatResult> {
    return {
      generations: [{
        text: 'child completed',
        message: new AIMessage('child completed'),
      }],
    };
  }
}

const writeFile = vi.fn(async () => 'written');
const readFile = vi.fn(async () => 'read');
const deleteFile = vi.fn(async () => 'deleted');
const writeFileTool = tool(writeFile, {
  name: 'dangerous_write',
  description: 'Write a file',
  schema: z.object({ path: z.string(), content: z.string() }),
});
const readFileTool = tool(readFile, {
  name: 'safe_read',
  description: 'Read a file',
  schema: z.object({ path: z.string() }),
});
const deleteFileTool = tool(deleteFile, {
  name: 'dangerous_delete',
  description: 'Delete a file',
  schema: z.object({ path: z.string() }),
});

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));
vi.mock('../database', () => ({ default: testDb }));
vi.mock('../store', () => ({
  default: { get: vi.fn(() => 'strict') },
}));
vi.mock('../logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@langchain/langgraph-checkpoint-sqlite', () => ({
  SqliteSaver: { fromConnString: vi.fn(() => new MemorySaver()) },
}));
vi.mock('./runtime-assembly', () => ({
  assembleDeepAgentRuntime: vi.fn(async (agent: { id: string; role?: string }) => ({
    model: agent.id === 'worker'
      ? new ApprovalSeekingWorkerModel({})
      : agent.role === 'general-purpose'
        ? new CompletingWorkerModel({})
        : masterModelKind === 'two-general'
          ? new TwoTaskParallelMasterModel({})
          : masterModelKind === 'single-general'
            ? new SingleGeneralMasterModel({})
            : new ParallelMasterModel({}),
    provider: { id: 'provider-1' },
    permissions: undefined,
    skillsRuntime: { attributions: [] },
    systemPrompt: '',
    assemblyWarnings: [],
  })),
  resolveRuntimeProviderModelConfig: vi.fn(),
  registerCdfHarnessProfile: vi.fn(),
  extractPathMentionContext: vi.fn(() => []),
}));
vi.mock('./shared-infra', () => ({
  getProvider: vi.fn(),
  getAgentMcpServers: vi.fn(() => []),
  getConnectedMcpServers: vi.fn(() => []),
  getAgentSkillNames: vi.fn(() => []),
  normalizeProviderId: vi.fn((value?: string | null) => value ?? null),
  resolveInterruptOn: vi.fn(() => ({
    dangerous_write: { allowedDecisions: ['approve', 'edit', 'reject'] },
    dangerous_delete: { allowedDecisions: ['approve', 'reject'] },
  })),
  createSpanId: vi.fn(() => 'span-1'),
  createBuiltInTools: vi.fn(() => [writeFileTool, readFileTool, deleteFileTool]),
  loadRegistryTools: vi.fn(() => []),
  loadMcpTools: vi.fn(async () => ({ client: null, tools: [] })),
  getRuntimeToolNames: vi.fn((tools: Array<{ name?: string }>) => tools.map((item) => item.name).filter(Boolean)),
}));
vi.mock('./agent-tools', () => ({ createAgentTools: vi.fn(() => []) }));
vi.mock('./llm-adapter', () => ({ createLangChainModel: vi.fn() }));
vi.mock('../workflow-run', () => ({
  getRunBySessionId: vi.fn(() => undefined),
  getWorkflowRun: vi.fn(),
  createAdvanceStageTool: vi.fn(),
  createTaskGraphTools: vi.fn(() => []),
}));
vi.mock('../workflow-run/db', () => ({
  getRunBySessionId: vi.fn(() => undefined),
  getCurrentStage: vi.fn(() => null),
  createTask: vi.fn(),
  setTaskDelegation: vi.fn(),
  updateTaskStatus: vi.fn(),
  getTask: vi.fn(),
}));
vi.mock('../workflow-run/notify', () => ({ pushProjectionEvent: vi.fn() }));

import { createAgentCatalog, GENERAL_PURPOSE_AGENT_ID, MASTER_AGENT_ID } from '../agent-catalog';
import { initializeDelegatedAgentRunSchema } from './delegated-agent-run-repository';
import { createDeepAgentRuntime } from './runtime';

function setupDatabase(): void {
  testDb.exec(`
    DROP TABLE IF EXISTS delegated_tool_actions;
    DROP TABLE IF EXISTS delegated_agent_runs;
    DROP TABLE IF EXISTS agent_tool_calls;
    DROP TABLE IF EXISTS messages;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS agent_runs;
    DROP TABLE IF EXISTS master_agent_prompts;
    DROP TABLE IF EXISTS agent_mcp_exclusions;
    DROP TABLE IF EXISTS agents;
    DROP TABLE IF EXISTS llm_providers;
    DROP TABLE IF EXISTS projects;
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, scene TEXT NOT NULL DEFAULT 'general');
    CREATE TABLE llm_providers (
      id TEXT PRIMARY KEY,
      is_active INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      agent_id TEXT,
      prompt_snapshot TEXT,
      skill_snapshot TEXT
    );
    CREATE TABLE agent_runs (id TEXT PRIMARY KEY);
    CREATE TABLE agent_mcp_exclusions (agent_id TEXT NOT NULL, mcp_server_id TEXT NOT NULL);
    CREATE TABLE agent_tool_calls (id TEXT PRIMARY KEY, approval_status TEXT);
    CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, created_at INTEGER);
    INSERT INTO projects VALUES ('project-1', 'Project', '/tmp', 'general');
    INSERT INTO llm_providers VALUES ('provider-1', 1, 1);
    INSERT INTO agent_runs VALUES ('run-parent');
  `);
  const catalog = createAgentCatalog(testDb, { createId: () => 'worker' });
  catalog.createCustom({ name: 'Worker', provider_id: 'provider-1' });
  testDb.prepare(`INSERT INTO sessions VALUES
    (?, 'project-1', 'Session 1', ?, NULL, NULL),
    (?, 'project-1', 'Session 2', ?, NULL, NULL),
    (?, 'project-1', 'Session 3', ?, NULL, NULL)`)
    .run('session-1', MASTER_AGENT_ID, 'session-2', MASTER_AGENT_ID, 'session-3', MASTER_AGENT_ID);
  initializeDelegatedAgentRunSchema(testDb);
}

describe('parallel delegation + production isolated runtime + real deepagents', () => {
  beforeEach(() => {
    generalPurposeModelInstances.length = 0;
    masterModelKind = 'parallel';
    writeFile.mockClear();
    readFile.mockClear();
    deleteFile.mockClear();
    setupDatabase();
  });

  it('pauses and resumes one delegated tool action without a second uncheckpointed worker runtime', async () => {
    const runtime = await createDeepAgentRuntime(
      'project-1',
      'session-1',
      { id: 'message-1', content: 'delegate in parallel' },
      undefined,
      ['worker'],
    );

    type Approval = Parameters<Parameters<typeof runtime.subscribeDelegatedToolApprovals>[0]>[0];
    const approvals: Approval[] = [];
    const waiters: Array<(approval: Approval) => void> = [];
    const unsubscribe = runtime.subscribeDelegatedToolApprovals((approval: Approval) => {
      const waiter = waiters.shift();
      if (waiter) waiter(approval);
      else approvals.push(approval);
    });
    const nextApproval = () => approvals.shift()
      ?? new Promise<Approval>((resolve) => waiters.push(resolve));
    const invocation = runtime.agent.invoke(
      { messages: runtime.inputMessages },
      { configurable: { thread_id: 'session-1', parentAgentRunId: 'run-parent' } },
    );

    const approval = await nextApproval();
    const waitingRow = testDb.prepare('SELECT * FROM delegated_agent_runs').get() as {
      status: string;
    };
    expect(waitingRow.status).toBe('waiting_approval');
    expect(approval).toMatchObject({
      targetAgentSlug: 'worker',
      action: { id: 'write-call-1', name: 'dangerous_write' },
    });
    await vi.waitFor(() => expect(readFile).toHaveBeenCalledTimes(1));
    expect(writeFile).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
    runtime.resolveDelegatedToolApproval(approval.id, 'approve');
    const secondApproval = await nextApproval();
    expect(secondApproval.action).toMatchObject({
      id: 'delete-call-1',
      name: 'dangerous_delete',
    });
    runtime.resolveDelegatedToolApproval(secondApproval.id, 'reject');
    await invocation;
    unsubscribe();

    const row = testDb.prepare('SELECT * FROM delegated_agent_runs').get() as {
      launch_form: string;
      status: string;
    };
    expect(row).toMatchObject({ launch_form: 'parallel', status: 'completed' });
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).not.toHaveBeenCalled();
    expect(runtime.listDelegatedToolApprovalHistory(approval.delegatedRunId)).toEqual([
      expect.objectContaining({
        action_id: 'write-call-1',
        decision: 'approve',
        execution_status: 'success',
      }),
      expect.objectContaining({
        action_id: 'delete-call-1',
        decision: 'reject',
        execution_status: 'rejected',
      }),
    ]);
  }, 30_000);

  it('runs the CDF-owned General-purpose Agent twice with isolated model instances', async () => {
    masterModelKind = 'two-general';
    const runtime = await createDeepAgentRuntime(
      'project-1',
      'session-2',
      { id: 'message-2', content: 'delegate twice' },
      { modelSource: 'llm_provider', sourceId: 'provider-1', model: 'parent-model' },
      [GENERAL_PURPOSE_AGENT_ID],
    );

    await runtime.agent.invoke(
      { messages: runtime.inputMessages },
      { configurable: { thread_id: 'session-2', parentAgentRunId: 'run-parent' } },
    );

    const rows = testDb.prepare(
      'SELECT target_agent_slug, status FROM delegated_agent_runs ORDER BY created_at, id',
    ).all() as Array<{ target_agent_slug: string; status: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.target_agent_slug === 'general-purpose')).toBe(true);
    expect(rows.every((row) => row.status === 'completed')).toBe(true);
    expect(generalPurposeModelInstances).toHaveLength(2);
    expect(generalPurposeModelInstances[0]).not.toBe(generalPurposeModelInstances[1]);
  }, 30_000);

  it('completes one single Delegated Agent Run through the CDF-owned General-purpose Agent', async () => {
    masterModelKind = 'single-general';
    const runtime = await createDeepAgentRuntime(
      'project-1',
      'session-3',
      { id: 'message-3', content: 'delegate once' },
      { modelSource: 'llm_provider', sourceId: 'provider-1', model: 'parent-model' },
      [GENERAL_PURPOSE_AGENT_ID],
    );

    await runtime.agent.invoke(
      { messages: runtime.inputMessages },
      { configurable: { thread_id: 'session-3', parentAgentRunId: 'run-parent' } },
    );

    const row = testDb.prepare(
      'SELECT launch_form, target_agent_slug, status FROM delegated_agent_runs',
    ).get() as { launch_form: string; target_agent_slug: string; status: string };
    expect(row).toEqual({
      launch_form: 'single',
      target_agent_slug: 'general-purpose',
      status: 'completed',
    });
    expect(generalPurposeModelInstances).toHaveLength(1);
  }, 30_000);
});
