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

  async _generate(): Promise<ChatResult> {
    return {
      generations: [{
        text: '',
        message: new AIMessage({
          content: '',
          tool_calls: [{
            id: 'write-call-1',
            name: 'dangerous_write',
            args: { path: '/tmp/result.md', content: 'result' },
            type: 'tool_call',
          }],
        }),
      }],
    };
  }
}

const writeFileTool = tool(async () => 'written', {
  name: 'dangerous_write',
  description: 'Write a file',
  schema: z.object({ path: z.string(), content: z.string() }),
});

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));
vi.mock('../database', () => ({ default: testDb }));
vi.mock('../store', () => ({
  default: { get: vi.fn((key?: string) => key === 'skillOverrides' ? {} : 'strict') },
}));
vi.mock('../logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@langchain/langgraph-checkpoint-sqlite', () => ({
  SqliteSaver: { fromConnString: vi.fn(() => new MemorySaver()) },
}));
vi.mock('./runtime-assembly', () => ({
  assembleDeepAgentRuntime: vi.fn(async (agent: { id: string }) => ({
    model: agent.id === 'worker'
      ? new ApprovalSeekingWorkerModel({})
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
  })),
  createSpanId: vi.fn(() => 'span-1'),
  createBuiltInTools: vi.fn(() => [writeFileTool]),
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

import { initializeDelegatedAgentRunSchema } from './delegated-agent-run-repository';
import { createDeepAgentRuntime } from './runtime';

function setupDatabase(): void {
  testDb.exec(`
    DROP TABLE IF EXISTS delegated_agent_runs;
    DROP TABLE IF EXISTS messages;
    DROP TABLE IF EXISTS agent_runs;
    DROP TABLE IF EXISTS agents;
    DROP TABLE IF EXISTS llm_providers;
    DROP TABLE IF EXISTS projects;
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL);
    CREATE TABLE llm_providers (id TEXT PRIMARY KEY);
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT,
      description TEXT,
      provider_id TEXT,
      system_prompt TEXT,
      config TEXT,
      is_default INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE agent_runs (id TEXT PRIMARY KEY);
    CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, created_at INTEGER);
    INSERT INTO projects VALUES ('project-1', 'Project', '/tmp');
    INSERT INTO llm_providers VALUES ('provider-1');
    INSERT INTO agents VALUES
      ('master', 'project-1', 'Master', 'master', '', 'provider-1', '', NULL, 1, 1, 1),
      ('worker', 'project-1', 'Worker', 'worker', '', 'provider-1', '', NULL, 0, 1, 1);
    INSERT INTO agent_runs VALUES ('run-parent');
  `);
  initializeDelegatedAgentRunSchema(testDb);
}

describe('parallel delegation + production isolated runtime + real deepagents', () => {
  beforeEach(setupDatabase);

  it('uses a checkpointer at the approval boundary instead of a second uncheckpointed worker runtime', async () => {
    const runtime = await createDeepAgentRuntime(
      'project-1',
      'session-1',
      { id: 'message-1', content: 'delegate in parallel' },
      'master',
      undefined,
      ['worker'],
    );

    await runtime.agent.invoke(
      { messages: runtime.inputMessages },
      { configurable: { thread_id: 'session-1', parentAgentRunId: 'run-parent' } },
    );

    const row = testDb.prepare('SELECT * FROM delegated_agent_runs').get() as {
      launch_form: string;
      status: string;
      error_message: string;
    };
    expect(row).toMatchObject({ launch_form: 'parallel', status: 'failed' });
    expect(row.error_message).toContain('approval is not available');
    expect(row.error_message).not.toContain('No checkpointer set');
  }, 30_000);
});
