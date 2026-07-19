import fs from 'node:fs';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { MemorySaver } from '@langchain/langgraph';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { modelRef, tmpDir } = vi.hoisted(() => {
  const fsSync = require('node:fs') as typeof import('node:fs');
  const osSync = require('node:os') as typeof import('node:os');
  const pathSync = require('node:path') as typeof import('node:path');
  const tmpDir = pathSync.join(osSync.tmpdir(), `cdf-workflow-model-failure-${process.pid}-${Date.now()}`);
  fsSync.mkdirSync(tmpDir, { recursive: true });
  return {
    modelRef: { current: null as unknown },
    tmpDir,
  };
});

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpDir) },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: vi.fn() },
}));

vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('./store', () => ({
  default: { get: vi.fn(() => 'strict'), set: vi.fn() },
}));

vi.mock('./security', () => ({
  encryptApiKey: vi.fn((value: string) => value),
  decryptApiKey: vi.fn((value: string) => value),
}));

vi.mock('@langchain/langgraph-checkpoint-sqlite', () => ({
  SqliteSaver: { fromConnString: vi.fn(() => new MemorySaver()) },
}));

vi.mock('./deepagent/llm-adapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./deepagent/llm-adapter')>();
  return {
    ...actual,
    createLangChainModel: vi.fn(() => modelRef.current),
  };
});

import db, { agentCatalog } from './database';
import { runLLMChat } from './llm';
import { getWorkflowRun, startRun } from './workflow-run/runtime';

const PROJECT_ID = 'workflow-model-failure-project';
const PROVIDER_ID = 'workflow-model-failure-provider';
const PROVIDER_ERROR = '400 Error from provider (Console Go): Upstream request failed';

class FailingProviderModel extends BaseChatModel {
  _llmType(): string {
    return 'failing-provider';
  }

  override bindTools(): this {
    return this;
  }

  async _generate(_messages: BaseMessage[]): Promise<ChatResult> {
    throw new Error(PROVIDER_ERROR);
  }
}

function seedWorkflow(): string {
  const now = Date.now();
  db.prepare(`
    INSERT INTO projects (id, name, path, scene, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(PROJECT_ID, 'Workflow failure project', tmpDir, 'general', now, now);
  db.prepare(`
    INSERT INTO llm_providers (
      id, name, provider_type, api_key, api_url, default_model,
      context_limit, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    PROVIDER_ID,
    'Failing provider',
    'openai',
    'test-key',
    'https://provider.invalid/v1',
    'failing-model',
    128_000,
    1,
    now,
    now,
  );
  agentCatalog.saveMasterPrompt('general', 'Execute the Workflow Run.');

  const stages = [{
    id: 'stage-1',
    name: 'Research',
    taskDescription: 'Research the requested topic',
    acceptanceCriteria: ['Return a source-grounded summary'],
    gateEnabled: false,
    terminal: true,
    routes: [],
  }];
  const workflowId = 'workflow-model-failure';
  db.prepare(`
    INSERT INTO workflows (id, project_id, name, stages, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(workflowId, PROJECT_ID, 'Model failure workflow', JSON.stringify(stages), 'active', now, now);
  return workflowId;
}

describe('Workflow Run root model failure', () => {
  beforeEach(() => {
    db.exec('PRAGMA foreign_keys = OFF');
    for (const table of [
      'workflow_run_tasks',
      'workflow_stage_gates',
      'workflow_runs',
      'workflows',
      'agent_tool_calls',
      'agent_runs',
      'messages',
      'sessions',
      'agent_skills',
      'agent_mcp_exclusions',
      'llm_providers',
      'projects',
    ]) {
      db.exec(`DELETE FROM ${table}`);
    }
    db.exec('PRAGMA foreign_keys = ON');
    modelRef.current = new FailingProviderModel({});
  });

  afterAll(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails visibly instead of leaving the Workflow Run active when the root model call fails', async () => {
    const workflowId = seedWorkflow();
    const { run, sessionId } = startRun(workflowId, PROJECT_ID);
    const send = vi.fn();

    await expect(runLLMChat({ send }, 'request-model-failure', {
      projectId: PROJECT_ID,
      sessionId,
      message: {
        id: 'message-model-failure',
        content: 'Start the Workflow Run.',
      },
      overrides: {
        modelSource: 'llm_provider',
        sourceId: PROVIDER_ID,
        providerId: PROVIDER_ID,
        model: 'failing-model',
      },
    })).rejects.toThrow(PROVIDER_ERROR);

    expect(send).toHaveBeenCalledWith(
      'llm:chunk-request-model-failure',
      expect.objectContaining({ type: 'runtime_error', error: PROVIDER_ERROR }),
    );
    expect(send).toHaveBeenCalledWith(
      'workflow-run:projection-event',
      expect.objectContaining({ type: 'run', runId: run.id, status: 'failed', error: PROVIDER_ERROR }),
    );
    expect(send).not.toHaveBeenCalledWith(
      'llm:chunk-request-model-failure',
      expect.objectContaining({ type: 'run_updated', status: 'completed' }),
    );
    expect(getWorkflowRun(run.id)).toMatchObject({
      id: run.id,
      status: 'failed',
      error: PROVIDER_ERROR,
    });
  });
});
