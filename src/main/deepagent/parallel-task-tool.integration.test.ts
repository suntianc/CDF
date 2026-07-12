// Real-deepagents integration test for the parallel worker approval boundary.
//
// parallel-task-tool.test.ts mocks the entire `deepagents` package, so it
// cannot see SDK-boundary failures. This file keeps `deepagents` REAL and
// only stubs CDF-side infra (db/store/providers/skills), reproducing the
// 2026-07-11 acceptance failure: workers compiled with `interruptOn` but no
// checkpointer die with LangGraph "No checkpointer set" the moment any
// gated tool (write_file, MCP tools, ...) is called.

import path from 'path';
import fs from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';

const TMP_DIR = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const osSync = require('os') as typeof import('os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsSync = require('node:fs') as typeof import('node:fs');
  const dir = `${osSync.tmpdir()}/cdf-parallel-int-${process.pid}-${Date.now()}`;
  fsSync.mkdirSync(dir, { recursive: true });
  return dir;
});

const {
  dbPrepareMock,
  storeGetMock,
  createLangChainModelMock,
} = vi.hoisted(() => ({
  dbPrepareMock: vi.fn(),
  storeGetMock: vi.fn((key?: string) => (key === 'skillOverrides' ? {} : undefined)),
  createLangChainModelMock: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  app: { getPath: () => TMP_DIR },
}));

vi.mock('../database', () => ({
  default: { prepare: dbPrepareMock },
}));

vi.mock('../store', () => ({
  default: { get: storeGetMock },
}));

vi.mock('./llm-adapter', () => ({
  createLangChainModel: createLangChainModelMock,
}));

// Keep resolveInterruptOn faithful to production strict mode (write_file is
// gated — see DEFAULT_INTERRUPT_ON in shared-infra.ts) while stubbing the
// heavy infra lookups around it.
vi.mock('./shared-infra', () => ({
  getProvider: vi.fn(() => ({
    id: 'provider-1',
    provider_type: 'minimax',
    api_key: 'key',
    api_url: 'https://example.invalid',
    default_model: 'fake-model',
  })),
  normalizeProviderId: vi.fn((value?: string | null) => value || undefined),
  getAgentMcpServers: vi.fn(() => []),
  getConnectedMcpServers: vi.fn(() => []),
  getAgentSkillNames: vi.fn(() => []),
  createBuiltInTools: vi.fn(() => []),
  loadRegistryTools: vi.fn(() => []),
  loadMcpTools: vi.fn(async () => ({ client: null, tools: [] })),
  createSpanId: vi.fn(() => 'span-root'),
  createChildSpan: vi.fn((parentSpanId: string) => ({ spanId: `${parentSpanId}-child`, parentSpanId })),
  resolveInterruptOn: vi.fn((mode: string) => (mode === 'bypass'
    ? {}
    : { write_file: { allowedDecisions: ['approve', 'edit', 'reject'] } })),
  getRuntimeToolNames: vi.fn(() => []),
}));

vi.mock('./skill-manager', () => ({
  getBuiltInSkillDirs: vi.fn(() => []),
  getScopePath: vi.fn((_p: string, scope: string) => path.join(TMP_DIR, scope)),
  resolveAgentSkillsConfig: vi.fn(() => ({
    skillsSources: [],
    permissions: [{ operations: ['read', 'write'], paths: [TMP_DIR] }],
  })),
  resolveAgentSkillConfigOptions: vi.fn(() => ({ options: undefined, warnings: [] })),
}));

vi.mock('./skills-runtime/cdf-skills-runtime', () => ({
  buildCdfSkillsRuntime: vi.fn(() => ({ skills: [], prompt: '', warnings: [] })),
}));

import { createParallelTaskTool } from './parallel-task-tool';

const OUT_FILE = path.join(TMP_DIR, 'worker-output.md');

// Scripted chat model: first call emits a gated write_file tool call, second
// call returns plain text so the agent loop terminates.
class FakeToolCallingChatModel extends BaseChatModel {
  private calls = 0;

  _llmType(): string {
    return 'fake-tool-calling';
  }

  override bindTools(): this {
    return this;
  }

  async _generate(_messages: BaseMessage[]): Promise<ChatResult> {
    this.calls += 1;
    if (this.calls === 1) {
      return {
        generations: [{
          text: '',
          message: new AIMessage({
            content: '',
            tool_calls: [{
              id: 'call-write-1',
              name: 'write_file',
              args: { file_path: OUT_FILE, content: 'worker artifact' },
              type: 'tool_call',
            }],
          }),
        }],
      };
    }
    return {
      generations: [{
        text: 'task finished',
        message: new AIMessage('task finished'),
      }],
    };
  }
}

describe('parallel worker + real deepagents approval boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeGetMock.mockImplementation((key?: string) => (key === 'skillOverrides' ? {} : undefined));
    createLangChainModelMock.mockImplementation(() => new FakeToolCallingChatModel({}));
    dbPrepareMock.mockImplementation((sql: string) => ({
      get: () => {
        if (sql.includes('FROM projects')) return { name: 'Test Project', path: TMP_DIR };
        return undefined;
      },
      all: () => {
        if (sql.includes('FROM agents WHERE project_id')) {
          return [{
            id: 'agent-1',
            project_id: 'project-1',
            name: 'worker-agent',
            slug: 'worker-agent',
            provider_id: 'provider-1',
            system_prompt: 'you are a worker',
            config: null,
          }];
        }
        return [];
      },
    }));
    fs.rmSync(OUT_FILE, { force: true });
  });

  it('completes a worker task whose tool is approval-gated instead of dying with "No checkpointer set"', async () => {
    const parallelTool = createParallelTaskTool('project-1', 'session-1');
    const raw = await (parallelTool as any).invoke({
      tasks: [{ name: 'worker-agent', description: 'write the artifact file' }],
    });
    const result = JSON.parse(raw);

    expect(result.results).toHaveLength(1);
    expect(result.results[0].error ?? '').not.toContain('No checkpointer set');
    expect(result.results[0].status).toBe('success');
  }, 30_000);
});
