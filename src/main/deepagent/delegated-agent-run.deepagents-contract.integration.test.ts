import Database from 'better-sqlite3';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { createDeepAgent } from 'deepagents';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DelegatedAgentRunCoordinator } from './delegated-agent-run-coordinator';
import {
  DelegatedAgentRunRepository,
  initializeDelegatedAgentRunSchema,
} from './delegated-agent-run-repository';
import { createDelegatedSubagentAdapter } from './delegated-subagent-adapter';

class ScriptedMasterModel extends BaseChatModel {
  private calls = 0;

  _llmType(): string {
    return 'scripted-delegation-master';
  }

  override bindTools(): this {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.calls += 1;
    const taskResult = messages.find((message) => (
      message instanceof ToolMessage && message.name === 'task'
    ));
    if (!taskResult) {
      return {
        generations: [{
          text: '',
          message: new AIMessage({
            content: '',
            tool_calls: [{
              id: 'task-call-contract',
              name: 'task',
              args: {
                description: 'inspect one file',
                subagent_type: 'code-agent',
              },
              type: 'tool_call',
            }],
          }),
        }],
      };
    }
    return {
      generations: [{
        text: 'parent continued after delegation',
        message: new AIMessage('parent continued after delegation'),
      }],
    };
  }
}

describe('single delegation + real deepagents contract', () => {
  const databases: Database.Database[] = [];

  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
  });

  it('completes through the production CompiledSubAgent adapter', async () => {
    const db = new Database(':memory:');
    databases.push(db);
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE agents (id TEXT PRIMARY KEY);
      CREATE TABLE agent_runs (id TEXT PRIMARY KEY);
    `);
    db.prepare('INSERT INTO agents (id) VALUES (?)').run('agent-child');
    db.prepare('INSERT INTO agent_runs (id) VALUES (?)').run('run-parent');
    initializeDelegatedAgentRunSchema(db);

    const repository = new DelegatedAgentRunRepository(db);
    const runtimeAdapter = {
      run: vi.fn(async () => ({
        status: 'success' as const,
        artifacts: ['result.md'],
        summary: 'child completed',
      })),
    };
    const coordinator = new DelegatedAgentRunCoordinator(repository, runtimeAdapter, {
      createId: () => 'delegated-contract-1',
      now: () => 100,
    });
    const subagent = createDelegatedSubagentAdapter({
      coordinator,
      target: {
        id: 'agent-child',
        slug: 'code-agent',
        name: 'Code Agent',
        description: 'Writes code',
      },
    });
    const master = createDeepAgent({
      model: new ScriptedMasterModel({}),
      subagents: [subagent],
    });

    const output = await master.invoke(
      { messages: [new HumanMessage('delegate once')] },
      { configurable: { parentAgentRunId: 'run-parent' } },
    );

    expect(runtimeAdapter.run).toHaveBeenCalledTimes(1);
    expect(runtimeAdapter.run).toHaveBeenCalledWith(expect.objectContaining({
      delegatedRunId: 'delegated-contract-1',
      parentAgentRunId: 'run-parent',
      taskToolCallId: 'task-call-contract',
      goal: 'inspect one file',
    }));
    expect(repository.get('delegated-contract-1')).toMatchObject({
      status: 'completed',
      launch_form: 'single',
      outcome: {
        status: 'success',
        artifacts: ['result.md'],
        summary: 'child completed',
      },
    });
    expect(output.messages.at(-1)?.content).toBe('parent continued after delegation');
  }, 30_000);
});
